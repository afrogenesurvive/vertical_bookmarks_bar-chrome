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
  let activeSubDrawer = null; // current open sub-drawer element
  let isLoading = false;

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
  toggle.textContent = "★"; // Unicode fallback in case Font Awesome fails
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
    closeSubDrawer();
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
      // If this folder's sub-drawer is already open, close it
      if (activeSubDrawer && activeSubDrawer.dataset.folderId === folderId) {
        closeSubDrawer();
        return;
      }
      showSubDrawer(folderEl, folderId, cachedChildren);
    });
  }

  function showSubDrawer(folderEl, folderId, cachedChildren) {
    closeSubDrawer();

    // Highlight this folder
    folderEl.classList.add("vbb-folder-open");

    const subDrawer = document.createElement("div");
    subDrawer.className = "vbb-sub-drawer";
    subDrawer.dataset.folderId = folderId;
    subDrawer.id = `vbb-sub-${folderId}`;

    // Position sub-drawer to the LEFT of the main drawer
    const drawerRect = drawer.getBoundingClientRect();
    const folderRect = folderEl.getBoundingClientRect();

    const subWidth = 38;
    const subLeft = drawerRect.left - 4 - subWidth;
    const subTop = folderRect.top;
    const maxBottom = Math.min(drawerRect.bottom, window.innerHeight - 8);
    const subHeight = Math.max(36, maxBottom - subTop);

    subDrawer.style.left = subLeft + "px";
    subDrawer.style.top = subTop + "px";
    subDrawer.style.height = subHeight + "px";
    subDrawer.style.maxHeight = subHeight + "px";

    document.body.appendChild(subDrawer);
    // Force reflow then add open class for transition
    void subDrawer.offsetWidth;
    subDrawer.classList.add("open");
    activeSubDrawer = subDrawer;

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

    // Close sub-drawer when clicking elsewhere
    const closeHandler = (e) => {
      if (!subDrawer.contains(e.target) && !folderEl.contains(e.target)) {
        closeSubDrawer();
        document.removeEventListener("click", closeHandler);
      }
    };
    // Delay adding the listener so the current click doesn't immediately close it
    setTimeout(() => {
      document.addEventListener("click", closeHandler);
    }, 0);
  }

  function closeSubDrawer() {
    // Remove highlight from all folders
    document.querySelectorAll(".vbb-folder.vbb-folder-open").forEach((el) => {
      el.classList.remove("vbb-folder-open");
    });
    if (activeSubDrawer) {
      const el = activeSubDrawer;
      activeSubDrawer = null;
      el.classList.remove("open");
      setTimeout(() => {
        el.remove();
      }, 150);
    }
  }
})();
