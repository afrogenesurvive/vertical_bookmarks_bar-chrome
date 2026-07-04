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
    barPosition: "right",
    theme: "dark",
    showTitle: false,
  };

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
      } else {
        // ── Folder (no URL) ──
        el.classList.add("vbb-folder");
        const folderIcon = document.createElement("i");
        folderIcon.className = "fa-solid fa-folder vbb-folder-icon";
        el.appendChild(folderIcon);

        const label = document.createElement("span");
        label.className = "vbb-item-label";
        label.textContent = item.title || "Folder";
        el.appendChild(label);
        el.title = label.textContent;

        if (item.children && item.children.length > 0) {
          // Already have cached children – render immediately
          setupFolderClick(el, item.id, item.children);
        } else {
          // Need to fetch
          setupFolderClick(el, item.id, null);
        }
      }

      container.appendChild(el);
    });
  }

  // ─── Folder sub-drawer (click to open, opens to the left) ────────────────
  function setupFolderClick(folderEl, folderId, cachedChildren) {
    folderEl.addEventListener("click", (e) => {
      e.stopPropagation();
      // Toggle: if this folder already has a sub-drawer anywhere in the stack, close from there
      const existingIdx = subDrawerStack.findIndex((sd) => sd.dataset.folderId === folderId);
      if (existingIdx !== -1) {
        closeSubDrawersFrom(existingIdx);
        return;
      }
      showSubDrawer(folderEl, folderId, cachedChildren);
    });
  }

  function showSubDrawer(folderEl, folderId, cachedChildren) {
    // Find the parent container (main drawer or a sub-drawer) that holds this folder
    const parentContainer = folderEl.closest(".vbb-drawer, .vbb-sub-drawer");

    // Close sub-drawers at this depth or deeper
    if (parentContainer && parentContainer.classList.contains("vbb-sub-drawer")) {
      const parentIdx = subDrawerStack.indexOf(parentContainer);
      if (parentIdx !== -1) {
        closeSubDrawersFrom(parentIdx + 1);
      }
    } else {
      // Parent is the main drawer — close all sub-drawers
      closeSubDrawersFrom(0);
    }

    // Highlight this folder
    folderEl.classList.add("vbb-folder-open");

    const subDrawer = document.createElement("div");
    subDrawer.className = "vbb-sub-drawer";
    subDrawer.dataset.folderId = folderId;
    subDrawer.id = `vbb-sub-${folderId}`;

    // Position sub-drawer to the side of its parent container based on bar position
    const parentRect = parentContainer.getBoundingClientRect();
    const folderRect = folderEl.getBoundingClientRect();

    const subWidth = 42;
    const gap = 4;
    let subLeft;
    if (settings.barPosition === "right") {
      // Bar on the right — sub-drawer opens to the left
      subLeft = parentRect.left - gap - subWidth;
    } else {
      // Bar on the left — sub-drawer opens to the right
      subLeft = parentRect.right + gap;
    }

    // Height based on content, capped to viewport
    const subTop = folderRect.top;
    const viewportBottom = window.innerHeight - 8;
    const subMaxHeight = Math.max(36, viewportBottom - subTop);

    subDrawer.style.left = subLeft + "px";
    subDrawer.style.top = subTop + "px";
    subDrawer.style.maxHeight = subMaxHeight + "px";

    document.body.appendChild(subDrawer);
    // Force reflow then add open class for transition
    void subDrawer.offsetWidth;
    subDrawer.classList.add("open");
    subDrawerStack.push(subDrawer);

    // Load & render contents
    if (cachedChildren) {
      renderItems(cachedChildren, subDrawer);
    } else {
      subDrawer.innerHTML = '<div class="vbb-loading">Loading</div>';
      chrome.runtime.sendMessage({ action: "getFolderContents", folderId }, (response) => {
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
    }
  }

  function closeSubDrawersFrom(index) {
    while (subDrawerStack.length > index) {
      const sd = subDrawerStack.pop();
      // Un-highlight the folder that owns this sub-drawer
      const folderId = sd.dataset.folderId;
      const folderEl = document.querySelector(`.vbb-item[data-id="${CSS.escape(folderId)}"]`);
      if (folderEl) {
        folderEl.classList.remove("vbb-folder-open");
      }
      sd.classList.remove("open");
      setTimeout(() => sd.remove(), 150);
    }
  }

  function closeAllSubDrawers() {
    closeSubDrawersFrom(0);
  }

  function applyBarPosition() {
    container.classList.toggle("vbb-left", settings.barPosition === "left");
    container.classList.toggle("vbb-right", settings.barPosition === "right");
    closeAllSubDrawers();
  }

  function applyTheme() {
    container.classList.toggle("vbb-light", settings.theme === "light");
    container.classList.toggle("vbb-dark", settings.theme === "dark");
  }

  function applyShowTitle() {
    container.classList.toggle("vbb-show-titles", settings.showTitle);
  }

  function openSettingsPanel() {
    closeAllSubDrawers();

    const panel = document.createElement("div");
    panel.className = "vbb-sub-drawer vbb-settings-drawer";
    panel.dataset.folderId = "__settings__";

    // Position to the side of the main drawer
    const drawerRect = drawer.getBoundingClientRect();

    const panelWidth = 42;
    const gap = 4;
    let panelLeft;
    if (settings.barPosition === "right") {
      panelLeft = drawerRect.left - gap - panelWidth;
    } else {
      panelLeft = drawerRect.right + gap;
    }

    panel.style.left = panelLeft + "px";
    panel.style.top = drawerRect.top + "px";
    panel.style.maxHeight = Math.min(drawerRect.height, window.innerHeight - 16) + "px";

    document.body.appendChild(panel);
    void panel.offsetWidth;
    panel.classList.add("open");
    subDrawerStack.push(panel);

    renderSettings(panel);
  }

  function renderSettings(container) {
    container.innerHTML = "";

    // Bar position
    const posItem = document.createElement("div");
    posItem.className = "vbb-item vbb-settings-item";
    posItem.innerHTML =
      '<span class="vbb-settings-icon"><i class="fa-solid fa-arrows-left-right"></i></span>' +
      '<span class="vbb-settings-label">Bar position</span>' +
      '<span class="vbb-settings-value">' +
      (settings.barPosition === "right" ? "Right" : "Left") +
      "</span>";
    posItem.addEventListener("click", (e) => {
      e.stopPropagation();
      settings.barPosition = settings.barPosition === "right" ? "left" : "right";
      applyBarPosition();
      renderSettings(container);
      // Reposition the settings panel to the new side
      const drawerRect = drawer.getBoundingClientRect();
      const panelWidth = 42;
      const gap = 4;
      if (settings.barPosition === "right") {
        panel.style.left = drawerRect.left - gap - panelWidth + "px";
      } else {
        panel.style.left = drawerRect.right + gap + "px";
      }
    });
    container.appendChild(posItem);

    // Theme
    const themeItem = document.createElement("div");
    themeItem.className = "vbb-item vbb-settings-item";
    themeItem.innerHTML =
      '<span class="vbb-settings-icon"><i class="fa-solid fa-palette"></i></span>' +
      '<span class="vbb-settings-label">Theme</span>' +
      '<span class="vbb-settings-value">' +
      (settings.theme === "dark" ? "Dark" : "Light") +
      "</span>";
    themeItem.addEventListener("click", (e) => {
      e.stopPropagation();
      settings.theme = settings.theme === "dark" ? "light" : "dark";
      applyTheme();
      renderSettings(container);
    });
    container.appendChild(themeItem);

    // Show titles
    const titleItem = document.createElement("div");
    titleItem.className = "vbb-item vbb-settings-item";
    titleItem.innerHTML =
      '<span class="vbb-settings-icon"><i class="fa-solid fa-font"></i></span>' +
      '<span class="vbb-settings-label">Show titles</span>' +
      '<span class="vbb-settings-value">' +
      (settings.showTitle ? "On" : "Off") +
      "</span>";
    titleItem.addEventListener("click", (e) => {
      e.stopPropagation();
      settings.showTitle = !settings.showTitle;
      applyShowTitle();
      renderSettings(container);
    });
    container.appendChild(titleItem);
  }
})();
