// Popup script for VS Code Windows
// Quick-launch dashboard for the layout panel

// ─── Initialise ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadWindows();

  // Open layout panel (side panel or tab)
  document.getElementById("openPanelBtn").addEventListener("click", async () => {
    // Try side panel first
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }
    } catch {
      // Fallback: open as tab
      const url = chrome.runtime.getURL("src/panel.html");
      chrome.tabs.create({ url });
    }
    window.close();
  });

  // New window
  document.getElementById("newWinBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "newWindow" });
    window.close();
  });

  // Layout preset buttons
  document.querySelectorAll(".preset-btn[data-layout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "arrangeLayout", style: btn.dataset.layout });
      window.close();
    });
  });
});

// ─── Load and render windows ──────────────────────────────────────────────
async function loadWindows() {
  const listEl = document.getElementById("windowList");
  listEl.innerHTML = '<div class="loading">Loading windows...</div>';

  chrome.runtime.sendMessage({ action: "getLayout" }, (response) => {
    if (!response || !response.areas) {
      listEl.innerHTML = '<div class="empty-state"><p>Could not load windows.</p></div>';
      return;
    }

    const windows = response.areas;

    if (windows.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">&#x1F4BB;</div>
          <p>No open windows found.</p>
        </div>`;
      return;
    }

    listEl.innerHTML = "";
    windows.forEach((win) => {
      const card = createWindowCard(win);
      listEl.appendChild(card);
    });
  });
}

// ─── Create a window card element ─────────────────────────────────────────
function createWindowCard(win) {
  const card = document.createElement("div");
  card.className = `window-card${win.focused ? " focused" : ""}`;
  card.dataset.windowId = win.id;

  // ── Header ──
  const header = document.createElement("div");
  header.className = "window-header";

  const info = document.createElement("div");
  info.className = "window-info";

  info.innerHTML = `
    <div class="window-label">
      <span class="window-title">${escapeHtml(win.title)}</span>
      ${win.focused ? '<span class="focus-badge">&#9679;</span>' : ""}
    </div>
    <span class="tab-count">${win.tabsCount} tab${win.tabsCount !== 1 ? "s" : ""} (${win.state})</span>
  `;

  info.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "focusWindow", windowId: win.id });
  });

  const actions = document.createElement("div");
  actions.className = "window-actions";

  const minBtn = createActionBtn("_", "Minimize");
  minBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: "minimizeWindow", windowId: win.id });
  });
  actions.appendChild(minBtn);

  if (win.state === "maximized") {
    const restoreBtn = createActionBtn("&#x25A2;", "Restore");
    restoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "restoreWindow", windowId: win.id });
    });
    actions.appendChild(restoreBtn);
  } else {
    const maxBtn = createActionBtn("&#x25A1;", "Maximize");
    maxBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "maximizeWindow", windowId: win.id });
    });
    actions.appendChild(maxBtn);
  }

  const closeBtn = createActionBtn("&#x2715;", "Close window");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: "closeWindow", windowId: win.id });
    card.remove();
  });
  actions.appendChild(closeBtn);

  header.appendChild(info);
  header.appendChild(actions);
  card.appendChild(header);

  // ── Tab list ──
  const tabList = document.createElement("div");
  tabList.className = "tab-list";

  win.tabs.forEach((tab) => {
    const tabEl = document.createElement("div");
    tabEl.className = `tab-item${tab.active ? " active-tab" : ""}`;

    const favicon = tab.favIconUrl
      ? `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="" />`
      : '<span class="tab-favicon" style="background:#313244;border-radius:3px;"></span>';

    let domain = "";
    try {
      domain = new URL(tab.url).hostname;
    } catch {
      domain = "";
    }

    tabEl.innerHTML = `
      ${favicon}
      <span class="tab-title">${escapeHtml(tab.title || "Untitled")}</span>
      <span class="tab-domain">${escapeHtml(domain)}</span>
    `;

    tabEl.addEventListener("click", () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(win.id, { focused: true });
    });

    tabList.appendChild(tabEl);
  });

  card.appendChild(tabList);
  return card;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function createActionBtn(text, title) {
  const btn = document.createElement("button");
  btn.className = "btn btn-sm btn-icon";
  btn.innerHTML = text;
  btn.title = title;
  return btn;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
