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

  // ─── Load persisted settings and apply them ─────────────────────────────
  loadSettings(() => {
    applyBarPosition();
    applyTheme();
    applyShowTitle();
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

  // ─── Drawer toggle ───────────────────────────────────────────────────────
  toggle.addEventListener("click", (e) => {
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
    const gap = 4;

    if (isHorizontal()) {
      // ── Horizontal bar (top/bottom): horizontal sub-drawer strip ──
      subDrawer.classList.add("vbb-sub-drawer-horizontal");
      if (settings.barPosition === "top") {
        subDrawer.style.top = folderRect.bottom + gap + "px";
        subDrawer.style.bottom = "auto";
      } else {
        subDrawer.style.bottom = window.innerHeight - folderRect.top + gap + "px";
        subDrawer.style.top = "auto";
      }
      subDrawer.style.left = folderRect.left + "px";
      // Remove default fixed width so horizontal class applies properly
      subDrawer.style.width = "";
    } else {
      // ── Vertical bar (left/right): sub-drawer to the side ──
      if (settings.barPosition === "right") {
        subDrawer.style.left = folderRect.left - gap - 42 + "px";
      } else {
        subDrawer.style.left = folderRect.right + gap + "px";
      }
      subDrawer.style.top = folderRect.top + "px";
      subDrawer.style.maxHeight = window.innerHeight - folderRect.top - 10 + "px";
    }

    // Horizontal sub-drawer width: from its left edge to 10px from the left viewport edge
    if (isHorizontal()) {
      subDrawer.style.maxWidth = folderRect.left - 10 + "px";
    }

    document.body.appendChild(subDrawer);

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
    return settings.barPosition === "top" || settings.barPosition === "bottom";
  }

  function applyBarPosition() {
    container.classList.toggle("vbb-left", settings.barPosition === "left");
    container.classList.toggle("vbb-right", settings.barPosition === "right");
    container.classList.toggle("vbb-top", settings.barPosition === "top");
    container.classList.toggle("vbb-bottom", settings.barPosition === "bottom");
    container.classList.toggle("vbb-horizontal", isHorizontal());
    const isVert = !isHorizontal();
    container.classList.toggle("vbb-vertical", isVert);
    container.classList.toggle("vbb-vertical-left", isVert && settings.barPosition === "left");
    container.classList.toggle("vbb-vertical-right", isVert && settings.barPosition === "right");
    closeAllSubDrawers();
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

  function openSettingsPanel() {
    closeAllSubDrawers();

    const panel = document.createElement("div");
    panel.className = "vbb-sub-drawer vbb-settings-drawer";
    panel.dataset.folderId = "__settings__";

    const drawerRect = drawer.getBoundingClientRect();
    const panelWidth = 170;
    const gap = 4;

    if (isHorizontal()) {
      // Settings opens below (top bar) or above (bottom bar)
      if (settings.barPosition === "top") {
        panel.style.top = drawerRect.bottom + gap + "px";
      } else {
        panel.style.bottom = window.innerHeight - drawerRect.top + gap + "px";
      }
      panel.style.left = drawerRect.left + "px";
      panel.style.maxHeight = Math.min(300, window.innerHeight - 16) + "px";
    } else {
      // Settings opens to the side
      if (settings.barPosition === "right") {
        panel.style.left = drawerRect.left - gap - panelWidth + "px";
      } else {
        panel.style.left = drawerRect.right + gap + "px";
      }
      panel.style.top = drawerRect.top + "px";
      panel.style.maxHeight = Math.min(drawerRect.height, window.innerHeight - 16) + "px";
    }

    document.body.appendChild(panel);
    void panel.offsetWidth;
    panel.classList.add("open");
    subDrawerStack.push(panel);

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
        repositionSettingsPanel(container);
        renderSettings(container);
      },
    );

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
        settings.showTitle = value;
        saveSettings();
        applyShowTitle();
        repositionSettingsPanel(container);
        renderSettings(container);
      },
    );
  }

  function repositionSettingsPanel(panelEl) {
    const drawerRect = drawer.getBoundingClientRect();
    const pw = 170;
    const g = 4;
    if (isHorizontal()) {
      if (settings.barPosition === "top") {
        panelEl.style.top = drawerRect.bottom + g + "px";
        panelEl.style.bottom = "auto";
      } else {
        panelEl.style.bottom = window.innerHeight - drawerRect.top + g + "px";
        panelEl.style.top = "auto";
      }
      panelEl.style.left = drawerRect.left + "px";
    } else {
      if (settings.barPosition === "right") {
        panelEl.style.left = drawerRect.left - g - pw + "px";
      } else {
        panelEl.style.left = drawerRect.right + g + "px";
      }
      panelEl.style.top = drawerRect.top + "px";
      panelEl.style.bottom = "auto";
    }
  }
})();
