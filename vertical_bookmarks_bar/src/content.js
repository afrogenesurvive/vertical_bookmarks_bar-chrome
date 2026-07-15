(function () {
  "use strict";

  console.log("VBB: Content script loaded");

  // ─── Prevent duplicate injection ─────────────────────────────────────────
  if (document.getElementById("vbb-container")) {
    console.log("VBB: Already injected, skipping");
    return;
  }

  // ─── State ───────────────────────────────────────────────────────────────
  let isDrawerOpen = false;
  let subDrawerStack = []; // stack of open sub-drawers (innermost last)
  let isLoading = false;
  let settings = {
    barPosition: "right", // 'left' | 'right' | 'top' | 'bottom'
    theme: "dark", // 'dark' | 'light' | 'system'
    showTitle: false,
    fontSize: 13, // px, base font size for all text
    movable: false, // whether the toggle can be dragged
    orientation: "vertical", // 'vertical' | 'horizontal' (only when movable)
    toggleX: null, // px, CSS left position of toggle (set by drag or default)
    toggleY: null, // px, CSS top position of toggle (set by drag or default)
  };
  let systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  // ─── Settings persistence via chrome.storage.local ───────────────────────
  function saveSettings() {
    try {
      chrome.storage.local.set({ vbbSettings: settings });
    } catch (_) {
      // Silently skip if storage is unavailable (e.g., about:blank)
    }
  }

  function loadSettings(callback) {
    try {
      chrome.storage.local.get("vbbSettings", (result) => {
        if (result && result.vbbSettings) {
          Object.assign(settings, result.vbbSettings);
        }
        if (callback) callback();
      });
    } catch (_) {
      if (callback) callback();
    }
  }

  // Listen for OS theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    systemDark = e.matches;
    if (settings.theme === "system") {
      applyTheme();
    }
  });

  // ─── Favicon helper ──────────────────────────────────────────────────────
  function getFaviconUrls(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        // chrome://favicon is NOT accessible from content scripts in MV3,
        // so use Google's favicon service as the primary source.
        return [`https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=16`];
      }
    } catch (_) {
      // Invalid URL, skip favicon
    }
    return [];
  }

  // ─── Inject Font Awesome (with fallback) ────────────────────────────────
  const faLink = document.createElement("link");
  faLink.rel = "stylesheet";
  faLink.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css";
  faLink.onerror = () => console.warn("VBB: Font Awesome failed to load");
  document.head.appendChild(faLink);

  // ─── Create UI elements ──────────────────────────────────────────────────
  const container = document.createElement("div");
  container.id = "vbb-container";

  // Toggle button – fixed top-right
  const toggle = document.createElement("button");
  toggle.id = "vbb-toggle";
  toggle.setAttribute("aria-label", "Toggle bookmarks");
  toggle.title = "Bookmarks";
  const toggleIcon = document.createElement("i");
  toggleIcon.className = "fa-solid fa-bookmark";
  toggle.prepend(toggleIcon);

  // Main drawer
  const drawer = document.createElement("div");
  drawer.id = "vbb-drawer";
  drawer.className = "vbb-drawer";

  // Items container (scrollable)
  const itemsContainer = document.createElement("div");
  itemsContainer.id = "vbb-items";
  itemsContainer.className = "vbb-items";

  // Drawer header with bookmarks title and settings gear
  const drawerHeader = document.createElement("div");
  drawerHeader.className = "vbb-drawer-header";

  const headerTitle = document.createElement("span");
  headerTitle.className = "vbb-header-title";
  headerTitle.innerHTML = '<i class="fa-solid fa-bookmark"></i> Bookmarks';
  drawerHeader.appendChild(headerTitle);

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "vbb-settings-btn";
  settingsBtn.title = "Settings";
  settingsBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openSettingsPanel();
  });
  drawerHeader.appendChild(settingsBtn);

  drawer.appendChild(drawerHeader);
  drawer.appendChild(itemsContainer);
  container.appendChild(toggle);
  container.appendChild(drawer);
  document.documentElement.appendChild(container);

  // Drag init is called after settings load (if movable) — see below

  // ─── Load persisted settings and apply them ─────────────────────────────
  loadSettings(() => {
    applyBarPosition();
    if (settings.movable) {
      applyTogglePosition();
      initToggleDrag();
      container.classList.add("vbb-movable");
      applyOrientationClass();
    }
    applyTheme();
    applyShowTitle();
    applyFontSize();
  });

  // ─── Listen for messages from background ────────────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping") {
      sendResponse({ pong: true });
      return true;
    }
    if (request.action === "toggleDrawer") {
      if (isDrawerOpen) {
        closeDrawer();
      } else {
        openDrawer();
      }
    }
  });

  // ─── Drawer toggle (ignored if just dragged) ─────────────────────────────
  let wasDrag = false;
  toggle.addEventListener("click", (e) => {
    if (wasDrag) {
      wasDrag = false;
      return;
    }
    e.stopPropagation();
    if (isDrawerOpen) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  // Close drawer on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isDrawerOpen) {
      closeDrawer();
    }
  });

  // Close drawer when clicking outside
  document.addEventListener("click", (e) => {
    if (isDrawerOpen && !container.contains(e.target)) {
      closeDrawer();
    }
  });

  // ─── Drawer management ───────────────────────────────────────────────────
  function openDrawer() {
    isDrawerOpen = true;
    positionDrawer();
    drawer.classList.add("open");
    toggle.classList.add("active");
    loadBookmarksBar();
  }

  function closeDrawer() {
    isDrawerOpen = false;
    drawer.classList.remove("open");
    toggle.classList.remove("active");
    closeAllSubDrawers();
  }

  // ─── Load & render bookmarks ─────────────────────────────────────────────
  function loadBookmarksBar() {
    isLoading = true;
    itemsContainer.innerHTML = '<div class="vbb-loading">Loading</div>';
    chrome.runtime.sendMessage({ action: "getBookmarksBar" }, (response) => {
      isLoading = false;
      if (response && response.items) {
        if (response.items.length === 0) {
          itemsContainer.innerHTML = '<div class="vbb-error">No bookmarks</div>';
        } else {
          renderItems(response.items, itemsContainer);
        }
      } else if (response && response.error) {
        itemsContainer.innerHTML = '<div class="vbb-error">Error: ' + response.error + "</div>";
        console.warn("VBB: Bookmarks error:", response.error);
      } else {
        itemsContainer.innerHTML = '<div class="vbb-error">No response from extension</div>';
        console.warn("VBB: No response from background");
      }
    });
  }

  function renderItems(items, container) {
    container.innerHTML = "";
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "vbb-item";
      el.dataset.id = item.id;

      if (item.url) {
        // ── Bookmark (has a URL) ──
        const img = document.createElement("img");
        const favUrls = getFaviconUrls(item.url);
        if (favUrls.length > 0) {
          let fallbackIndex = 1;
          img.src = favUrls[0];
          img.loading = "lazy";
          img.alt = "";
          img.onerror = () => {
            if (fallbackIndex < favUrls.length) {
              img.src = favUrls[fallbackIndex++];
            } else {
              // Fallback: show first letter of title
              img.style.display = "none";
              const fallback = document.createElement("span");
              fallback.className = "vbb-favicon-fallback";
              fallback.textContent = (item.title || "?").charAt(0).toUpperCase();
              el.prepend(fallback);
            }
          };
        } else {
          img.style.display = "none";
          const fallback = document.createElement("span");
          fallback.className = "vbb-favicon-fallback";
          fallback.textContent = (item.title || "?").charAt(0).toUpperCase();
          el.prepend(fallback);
        }
        el.appendChild(img);

        const label = document.createElement("span");
        label.className = "vbb-item-label";
        label.textContent = item.title || new URL(item.url).hostname;
        el.appendChild(label);
        el.title = label.textContent;

        el.addEventListener("click", (e) => {
          e.stopPropagation();
          if (item.url) {
            window.open(item.url, "_blank");
          }
        });
        container.appendChild(el);
      } else {
        // ── Folder (no URL) - opens a sub-drawer ──
        el.classList.add("vbb-folder");

        // Expand/collapse chevron
        const expandIcon = document.createElement("i");
        expandIcon.className = "fa-solid fa-chevron-right vbb-expand-icon";
        el.appendChild(expandIcon);

        // Folder icon
        const folderIcon = document.createElement("i");
        folderIcon.className = "fa-solid fa-folder vbb-folder-icon";
        el.appendChild(folderIcon);

        // Label
        const label = document.createElement("span");
        label.className = "vbb-item-label";
        label.textContent = item.title || "Folder";
        el.appendChild(label);
        el.title = label.textContent;

        // Click to toggle sub-drawer — only this folder's drawer
        el.addEventListener("click", (e) => {
          e.stopPropagation();

          const isOpen = el.classList.contains("vbb-folder-open");
          if (isOpen) {
            // Close ONLY this folder's sub-drawer (and any nested)
            const sdIndex = subDrawerStack.findIndex((sd) => sd.dataset.folderId === item.id);
            if (sdIndex >= 0) {
              closeSubDrawersFrom(sdIndex);
            }
          } else {
            // Open a sub-drawer for this folder
            openFolderSubDrawer(el, item);
          }
        });

        container.appendChild(el);
      }
    });
  }

  // ─── Folder sub-drawer ────────────────────────────────────────────────────
  function openFolderSubDrawer(folderEl, item) {
    const folderRect = folderEl.getBoundingClientRect();

    // Close only sub-drawers that are deeper than the one containing folderEl.
    // This keeps the parent sub-drawer intact so folderEl doesn't get removed
    // from the DOM (fixes the "disappearing folder" bug).
    let keepIndex = -1;
    for (let i = subDrawerStack.length - 1; i >= 0; i--) {
      if (subDrawerStack[i].contains(folderEl)) {
        keepIndex = i;
        break;
      }
    }
    if (keepIndex >= 0) {
      closeSubDrawersFrom(keepIndex + 1);
    } else {
      closeAllSubDrawers();
    }

    const subDrawer = document.createElement("div");
    subDrawer.className = "vbb-sub-drawer vbb-folder-drawer";
    subDrawer.dataset.folderId = item.id;
    const gap = 8;

    if (isHorizontal()) {
      // ── Horizontal orientation: horizontal sub-drawer strip ──
      subDrawer.classList.add("vbb-sub-drawer-horizontal");
      if (settings.movable ? isToggleOnTopHalf() : settings.barPosition === "top") {
        subDrawer.classList.add("vbb-sub-drawer-top");
        subDrawer.style.top = folderRect.bottom + gap + "px";
        subDrawer.style.bottom = "auto";
      } else {
        subDrawer.classList.add("vbb-sub-drawer-bottom");
        subDrawer.style.bottom = window.innerHeight - folderRect.top + gap + "px";
        subDrawer.style.top = "auto";
      }
      subDrawer.style.width = "";
      if (settings.movable && isToggleOnLeftSide()) {
        // Drawer extends right → sub-drawer opens to the RIGHT of folder
        subDrawer.style.left = folderRect.right + gap + "px";
        subDrawer.style.right = "auto";
        subDrawer.style.maxWidth = Math.max(40, window.innerWidth - folderRect.right - 30) + "px";
      } else {
        // Drawer extends left → sub-drawer opens to the LEFT of folder (existing)
        subDrawer.style.right = window.innerWidth - folderRect.left + gap + "px";
        subDrawer.style.left = "auto";
        subDrawer.style.maxWidth = Math.max(40, folderRect.left - 30) + "px";
      }
    } else {
      // ── Vertical orientation: sub-drawer to the side ──
      const opensRight = settings.movable ? isToggleOnLeftSide() : settings.barPosition !== "right";
      if (opensRight) {
        subDrawer.classList.add("vbb-sub-drawer-left");
        subDrawer.style.left = folderRect.right + gap + "px";
        subDrawer.style.right = "auto";
      } else {
        subDrawer.classList.add("vbb-sub-drawer-right");
        subDrawer.style.right = "auto";
        // left set dynamically after drawer opens (see below)
      }
      subDrawer.style.top = folderRect.top + "px";
      subDrawer.style.maxHeight = window.innerHeight - folderRect.top - 30 + "px";
    }

    container.appendChild(subDrawer);

    // Load and render contents
    subDrawer.innerHTML = '<div class="vbb-loading">Loading</div>';
    chrome.runtime.sendMessage({ action: "getFolderContents", folderId: item.id }, (response) => {
      if (response && response.items) {
        if (response.items.length === 0) {
          subDrawer.innerHTML = '<div class="vbb-error">Empty folder</div>';
        } else {
          renderItems(response.items, subDrawer);
        }
      } else {
        subDrawer.innerHTML = '<div class="vbb-error">Error loading</div>';
      }
    });

    void subDrawer.offsetWidth;
    subDrawer.classList.add("open");

    // Dynamically position right-side sub-drawers based on actual rendered width
    if (!isHorizontal()) {
      const opensRight = settings.movable ? isToggleOnLeftSide() : settings.barPosition !== "right";
      if (!opensRight) {
        subDrawer.style.left = folderRect.left - gap - subDrawer.offsetWidth + "px";
      }
    }

    folderEl.classList.add("vbb-folder-open");
    subDrawerStack.push(subDrawer);
  }

  // ─── Sub-drawer stack management ─────────────────────────────────────────
  function closeSubDrawersFrom(index) {
    while (subDrawerStack.length > index) {
      const sd = subDrawerStack.pop();
      // Un-highlight the folder that owns this sub-drawer
      const folderId = sd.dataset.folderId;
      if (folderId && folderId !== "__settings__") {
        const folderEl = document.querySelector(`.vbb-item[data-id="${CSS.escape(folderId)}"]`);
        if (folderEl) {
          folderEl.classList.remove("vbb-folder-open");
        }
      }
      sd.classList.remove("open");
      setTimeout(() => sd.remove(), 150);
    }
  }

  function closeAllSubDrawers() {
    closeSubDrawersFrom(0);
  }

  function isHorizontal() {
    if (settings.movable) return settings.orientation === "horizontal";
    return settings.barPosition === "top" || settings.barPosition === "bottom";
  }

  function isToggleOnLeftSide() {
    const tr = toggle.getBoundingClientRect();
    return tr.left + tr.width / 2 < window.innerWidth / 2;
  }

  function isToggleOnTopHalf() {
    const tr = toggle.getBoundingClientRect();
    return tr.top + tr.height / 2 < window.innerHeight / 2;
  }

  function applyOrientationClass() {
    container.classList.toggle("vbb-movable-vertical", !isHorizontal());
    container.classList.toggle("vbb-movable-horizontal", isHorizontal());
  }

  function applyBarPosition() {
    container.classList.toggle("vbb-left", settings.barPosition === "left");
    container.classList.toggle("vbb-right", settings.barPosition === "right");
    container.classList.toggle("vbb-top", settings.barPosition === "top");
    container.classList.toggle("vbb-bottom", settings.barPosition === "bottom");
    if (!settings.movable) {
      container.classList.toggle("vbb-horizontal", isHorizontal());
      const isVert = !isHorizontal();
      container.classList.toggle("vbb-vertical", isVert);
      container.classList.toggle("vbb-vertical-left", isVert && settings.barPosition === "left");
      container.classList.toggle("vbb-vertical-right", isVert && settings.barPosition === "right");
    }
    // Close folder sub-drawers but keep the settings panel open if it's already open
    const settingsSubDrawer = subDrawerStack.find((sd) => sd.dataset.folderId === "__settings__");
    const settingsIdx = subDrawerStack.indexOf(settingsSubDrawer);
    // Close from the top of the stack down. If settings is in the stack,
    // close everything above it, then everything below it, but leave settings.
    if (settingsIdx >= 0) {
      closeSubDrawersFrom(settingsIdx + 1); // close above settings
      while (subDrawerStack.length > 1) {
        closeSubDrawersFrom(0); // close below settings
      }
    } else {
      closeAllSubDrawers();
    }
  }

  function getEffectiveTheme() {
    if (settings.theme === "system") {
      return systemDark ? "dark" : "light";
    }
    return settings.theme;
  }

  function applyTheme() {
    const effective = getEffectiveTheme();
    container.classList.toggle("vbb-light", effective === "light");
    container.classList.toggle("vbb-dark", effective === "dark");
  }

  function applyShowTitle() {
    container.classList.toggle("vbb-show-titles", settings.showTitle);
  }

  function applyFontSize() {
    container.style.setProperty("--vbb-font-size", settings.fontSize + "px");
  }

  // ─── Toggle position (movable only) ────────────────────────────────────
  function applyTogglePosition() {
    if (!settings.movable) return;
    if (settings.toggleX !== null && settings.toggleY !== null) {
      toggle.style.left = settings.toggleX + "px";
      toggle.style.top = settings.toggleY + "px";
    } else {
      setDefaultTogglePosition();
    }
  }

  function setDefaultTogglePosition() {
    if (!settings.movable) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = 38;
    const th = 48;
    switch (settings.barPosition) {
      case "right":
        settings.toggleX = vw - tw - 8;
        settings.toggleY = 8;
        break;
      case "left":
        settings.toggleX = 8;
        settings.toggleY = 8;
        break;
      case "top":
        settings.toggleX = vw - tw - 8;
        settings.toggleY = 8;
        break;
      case "bottom":
        settings.toggleX = vw - tw - 8;
        settings.toggleY = vh - th - 8;
        break;
    }
    toggle.style.left = settings.toggleX + "px";
    toggle.style.top = settings.toggleY + "px";
    saveSettings();
  }

  // ─── Position drawer relative to toggle (movable only) ──────────────────
  function positionDrawer() {
    if (!settings.movable) return;
    const tr = toggle.getBoundingClientRect();
    const gap = 4;
    applyOrientationClass();

    if (isHorizontal()) {
      // Horizontal: vertically align drawer with toggle (same top edge)
      drawer.style.top = tr.top + "px";
      drawer.style.bottom = "auto";
      drawer.style.width = "";
      drawer.style.height = "";

      const onLeftSide = isToggleOnLeftSide();
      container.classList.toggle("vbb-horizontal-drawer-right", onLeftSide);

      if (onLeftSide) {
        // Toggle on left half → drawer extends RIGHT
        drawer.style.left = tr.right + gap + "px";
        drawer.style.right = "auto";
        drawer.style.maxWidth = Math.max(40, window.innerWidth - tr.right - 20) + "px";
      } else {
        // Toggle on right half → drawer extends LEFT (existing behavior)
        drawer.style.right = window.innerWidth - tr.left + gap + "px";
        drawer.style.left = "auto";
        drawer.style.maxWidth = Math.max(40, tr.left - 20) + "px";
      }
    } else {
      // Vertical: drawer to the right (or left) of toggle
      drawer.style.top = tr.top + "px";
      drawer.style.bottom = "auto";
      drawer.style.height = Math.max(40, window.innerHeight - tr.top - 20) + "px";

      if (isToggleOnLeftSide()) {
        drawer.style.left = tr.right + gap + "px";
        drawer.style.right = "auto";
      } else {
        // Anchor right edge to left of toggle — naturally handles any drawer width
        drawer.style.right = window.innerWidth - tr.left + gap + "px";
        drawer.style.left = "auto";
      }
    }
  }

  // ─── Make toggle draggable (movable only) ──────────────────────────────
  function initToggleDrag() {
    if (!settings.movable) return;
    let isDragging = false;
    let dragStartX, dragStartY;
    let origLeft, origTop;

    toggle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      isDragging = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      origLeft = toggle.offsetLeft;
      origTop = toggle.offsetTop;

      const onMouseMove = (ev) => {
        const dx = ev.clientX - dragStartX;
        const dy = ev.clientY - dragStartY;
        if (!isDragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          isDragging = true;
          wasDrag = true;
          toggle.classList.add("vbb-dragging");
          // Close all drawers when dragging starts
          if (isDrawerOpen) closeDrawer();
          closeAllSubDrawers();
        }
        if (isDragging) {
          ev.preventDefault();
          toggle.style.left = Math.max(0, origLeft + dx) + "px";
          toggle.style.top = Math.max(0, origTop + dy) + "px";
          toggle.style.right = "auto";
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        if (isDragging) {
          toggle.classList.remove("vbb-dragging");
          settings.toggleX = parseInt(toggle.style.left, 10);
          settings.toggleY = parseInt(toggle.style.top, 10);
          saveSettings();
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  function openSettingsPanel() {
    console.log("Opening settings panel");

    // Toggle: if settings panel is already open, close it
    const existingIdx = subDrawerStack.findIndex((sd) => sd.dataset.folderId === "__settings__");
    console.log("Existing settings panel index:", existingIdx);

    if (existingIdx >= 0) {
      closeSubDrawersFrom(existingIdx);
      return;
    }

    closeAllSubDrawers();

    const panel = document.createElement("div");
    panel.className = "vbb-sub-drawer vbb-settings-drawer";
    panel.dataset.folderId = "__settings__";

    const drawerRect = drawer.getBoundingClientRect();
    const panelWidth = 170;
    const gap = 8;

    console.log("a");

    if (isHorizontal()) {
      // Settings opens below (top bar) or above (bottom bar)
      if (settings.movable ? isToggleOnTopHalf() : settings.barPosition === "top") {
        panel.style.top = drawerRect.bottom + gap + "px";
        panel.style.bottom = "auto";
      } else {
        panel.style.bottom = window.innerHeight - drawerRect.top + gap + "px";
        panel.style.top = "auto";
      }
      // Horizontal position: mirror based on toggle side
      if (settings.movable && isToggleOnLeftSide()) {
        panel.style.left = drawerRect.left + "px";
        panel.style.right = "auto";
      } else {
        panel.style.left = Math.max(0, drawerRect.right - panelWidth - gap) + "px";
        panel.style.right = "auto";
      }
    } else {
      // Vertical: determine side based on actual toggle position (movable-aware)
      const opensRight = settings.movable ? isToggleOnLeftSide() : settings.barPosition !== "right";
      if (opensRight) {
        panel.style.left = drawerRect.right + gap + "px";
      } else {
        panel.style.left = drawerRect.left - panelWidth - gap + "px";
      }
      panel.style.top = drawerRect.top + "px";
      panel.style.bottom = "auto";
      panel.style.right = "auto";
    }

    // Same max-height for both modes so settings content fits regardless of bar height
    // panel.style.maxHeight = Math.min(600, window.innerHeight - 60) + "px";
    panel.style.height = "fit-content";

    let x = panel.style;
    container.appendChild(panel);
    void panel.offsetWidth;
    panel.classList.add("open");
    subDrawerStack.push(panel);
    console.log("panel", {
      a: settings,
      1: {
        display: panel.style.display,
        top: panel.style.top,
        left: panel.style.left,
        right: panel.style.right,
        bottom: panel.style.bottom,
        height: panel.style.height,
        maxHeight: panel.style.maxHeight,
      },
      2: { display: x.display, top: x.top, left: x.left, right: x.right, bottom: x.bottom, height: x.height, maxHeight: x.maxHeight },
    });

    renderSettings(panel);
  }

  function renderSettings(container) {
    container.innerHTML = "";

    let openSection = null; // tracks the currently open accordion body element

    // ── Helper: build an accordion section ──
    function addAccordionSection(label, icon, currentValue, valueLabel, options, optLabels, optIcons, onSelect) {
      // ── Accordion header (always visible) ──
      const header = document.createElement("div");
      header.className = "vbb-settings-item";
      header.innerHTML =
        '<span class="vbb-settings-icon"><i class="fa-solid ' +
        icon +
        '"></i></span>' +
        '<span class="vbb-settings-label">' +
        label +
        "</span>" +
        '<span class="vbb-settings-value">' +
        valueLabel +
        "</span>" +
        '<span class="vbb-settings-chevron"><i class="fa-solid fa-chevron-down"></i></span>';

      // ── Accordion body (hidden by default) ──
      const body = document.createElement("div");
      body.className = "vbb-settings-accordion-body";

      options.forEach((opt) => {
        const optEl = document.createElement("div");
        optEl.className = "vbb-settings-option-item";
        const isSelected = opt === currentValue;
        optEl.innerHTML =
          '<span class="vbb-settings-icon"><i class="fa-solid ' +
          (optIcons ? optIcons[opt] : "fa-circle") +
          '"></i></span>' +
          '<span class="vbb-settings-label">' +
          (optLabels ? optLabels[opt] : opt) +
          "</span>" +
          (isSelected ? '<span class="vbb-settings-value checked"><i class="fa-solid fa-check"></i></span>' : "");
        optEl.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect(opt);
        });
        body.appendChild(optEl);
      });

      // Toggle accordion on header click
      header.addEventListener("click", (e) => {
        e.stopPropagation();
        if (openSection === body) {
          // Close current
          body.classList.remove("open");
          header.classList.remove("vbb-settings-open");
          openSection = null;
        } else {
          // Close previous if open
          if (openSection) {
            openSection.classList.remove("open");
            const prevHeader = openSection._accordionHeader;
            if (prevHeader) prevHeader.classList.remove("vbb-settings-open");
          }
          // Open this one
          body.classList.add("open");
          header.classList.add("vbb-settings-open");
          openSection = body;
        }
      });

      // Store reference so we can close from header
      body._accordionHeader = header;

      container.appendChild(header);
      container.appendChild(body);
    }

    // ── Define sections ──
    const posLabels = { right: "Right", bottom: "Bottom", left: "Left", top: "Top" };
    const posIcons = { right: "fa-arrow-right", bottom: "fa-arrow-down", left: "fa-arrow-left", top: "fa-arrow-up" };

    if (settings.movable) {
      // Show bar position as read-only when movable is on
      const lockedItem = document.createElement("div");
      lockedItem.className = "vbb-settings-item";
      lockedItem.style.opacity = "0.45";
      lockedItem.style.cursor = "default";
      lockedItem.title = "Locked while Movable is on";
      lockedItem.innerHTML =
        '<span class="vbb-settings-icon"><i class="fa-solid ' +
        posIcons[settings.barPosition] +
        '"></i></span>' +
        '<span class="vbb-settings-label">Bar position</span>' +
        '<span class="vbb-settings-value">' +
        posLabels[settings.barPosition] +
        " &middot; locked</span>";
      container.appendChild(lockedItem);
    } else {
      addAccordionSection(
        "Bar position",
        posIcons[settings.barPosition],
        settings.barPosition,
        posLabels[settings.barPosition],
        ["right", "bottom", "left", "top"],
        posLabels,
        posIcons,
        (value) => {
          settings.barPosition = value;
          saveSettings();
          applyBarPosition();
          if (settings.movable) setDefaultTogglePosition();
          repositionSettingsPanel(container);
          renderSettings(container);
        },
      );
    }

    const themeLabels = { dark: "Dark", light: "Light", system: "System" };
    const themeIcons = { dark: "fa-moon", light: "fa-sun", system: "fa-desktop" };

    addAccordionSection(
      "Theme",
      themeIcons[settings.theme],
      settings.theme,
      themeLabels[settings.theme],
      ["dark", "light", "system"],
      themeLabels,
      themeIcons,
      (value) => {
        settings.theme = value;
        saveSettings();
        applyTheme();
        renderSettings(container);
      },
    );

    const titleOptLabels = { true: "On", false: "Off" };
    const titleOptIcons = { true: "fa-check-circle", false: "fa-circle" };

    addAccordionSection(
      "Show titles",
      "fa-font",
      settings.showTitle,
      titleOptLabels[settings.showTitle],
      [true, false],
      titleOptLabels,
      titleOptIcons,
      (value) => {
        console.log("Show titles:", value);

        settings.showTitle = value;
        saveSettings();
        applyShowTitle();
        repositionSettingsPanel(container);
        renderSettings(container);
      },
    );

    const movableOptLabels = { true: "On", false: "Off" };
    const movableOptIcons = { true: "fa-check-circle", false: "fa-circle" };

    addAccordionSection(
      "Movable",
      "fa-arrows",
      settings.movable,
      movableOptLabels[settings.movable],
      [true, false],
      movableOptLabels,
      movableOptIcons,
      (value) => {
        console.log("moveable:", value);

        settings.movable = value;
        saveSettings();
        if (value) {
          container.classList.add("vbb-movable");
          // Clear inline styles so JS can take over toggle position
          toggle.style.top = "";
          toggle.style.right = "";
          toggle.style.left = "";
          applyTogglePosition();
          initToggleDrag();
          applyOrientationClass();
        } else {
          // When turning movable off, set bar position to match the orientation
          settings.barPosition = settings.orientation === "horizontal" ? "top" : "right";
          saveSettings();
          applyBarPosition();
          container.classList.remove("vbb-movable");
          container.classList.remove("vbb-movable-vertical");
          container.classList.remove("vbb-movable-horizontal");
          toggle.style.top = "";
          toggle.style.right = "";
          toggle.style.left = "";
        }
        closeAllSubDrawers();
        repositionSettingsPanel(container);
        renderSettings(container);
      },
    );

    // ── Orientation (only when movable) ──
    if (settings.movable) {
      const orientLabels = { vertical: "Vertical", horizontal: "Horizontal" };
      const orientIcons = { vertical: "fa-bars", horizontal: "fa-arrows-alt-h" };
      addAccordionSection(
        "Orientation",
        orientIcons[settings.orientation],
        settings.orientation,
        orientLabels[settings.orientation],
        ["vertical", "horizontal"],
        orientLabels,
        orientIcons,
        (value) => {
          settings.orientation = value;
          saveSettings();
          applyOrientationClass();
          closeAllSubDrawers();
          repositionSettingsPanel(container);
          renderSettings(container);
        },
      );
    }

    const fontSizeOptions = [10, 11, 12, 13, 14, 15, 16, 18, 20];
    const fontSizeLabels = {};
    const fontSizeIcons = {};
    fontSizeOptions.forEach((s) => {
      fontSizeLabels[s] = s + "px";
      fontSizeIcons[s] = s === settings.fontSize ? "fa-check-circle" : "fa-circle";
    });

    addAccordionSection(
      "Font size",
      "fa-text-height",
      settings.fontSize,
      settings.fontSize + "px",
      fontSizeOptions,
      fontSizeLabels,
      fontSizeIcons,
      (value) => {
        settings.fontSize = value;
        saveSettings();
        applyFontSize();
        repositionSettingsPanel(container);
        renderSettings(container);
      },
    );
  }

  function repositionSettingsPanel(panelEl) {
    console.log("Repositioning settings panel");

    const drawerRect = drawer.getBoundingClientRect();
    const pw = 170;
    const g = 8;
    if (isHorizontal()) {
      if (settings.movable ? isToggleOnTopHalf() : settings.barPosition === "top") {
        panelEl.style.top = drawerRect.bottom + g + "px";
        panelEl.style.bottom = "auto";
        console.log("1!!", drawerRect.left, drawerRect.right);
      } else {
        panelEl.style.bottom = window.innerHeight - drawerRect.top + g + "px";
        panelEl.style.top = "auto";
        console.log("2!!", drawerRect.left, drawerRect.right);
      }
      // Horizontal position: mirror based on toggle side
      if (settings.movable && isToggleOnLeftSide()) {
        panelEl.style.left = drawerRect.left + "px";
        panelEl.style.right = "auto";
      } else {
        panelEl.style.left = Math.max(0, drawerRect.right - 40) + "px";
        panelEl.style.right = "auto";
      }
    } else {
      // Vertical: determine side based on actual toggle position (movable-aware)
      const opensRight = settings.movable ? isToggleOnLeftSide() : settings.barPosition !== "right";
      if (opensRight) {
        panelEl.style.left = drawerRect.right + g + "px";
      } else {
        panelEl.style.left = drawerRect.left - g - pw + "px";
      }
      panelEl.style.top = drawerRect.top + "px";
      panelEl.style.bottom = "auto";
      panelEl.style.right = "auto";
    }
  }
})();
