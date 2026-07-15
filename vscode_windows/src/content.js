// Content script for VS Code Windows
// Handles the window overview overlay

(function () {
  "use strict";

  // ─── State ───────────────────────────────────────────────────────────────
  let overlay = null;

  // ─── Listen for messages ────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((request) => {
    switch (request.action) {
      case "showOverview":
        showOverview(request.tabs);
        break;
      case "hideOverview":
        hideOverview();
        break;
    }
  });

  // ─── Create and show overview overlay ──────────────────────────────────
  function showOverview(tabs) {
    if (overlay) hideOverview();

    overlay = document.createElement("div");
    overlay.id = "vscw-overlay";
    overlay.innerHTML = `
      <div class="vscw-overlay-backdrop"></div>
      <div class="vscw-overlay-panel">
        <div class="vscw-overlay-header">
          <h2>&#x2301; Window Overview</h2>
          <button class="vscw-close-btn" id="vscw-close-overview">&times;</button>
        </div>
        <div class="vscw-tab-grid">
          ${tabs
            .map(
              (tab) => `
            <div class="vscw-tab-card" data-window-id="${tab.windowId}" data-tab-id="${tab.tabId}">
              <img class="vscw-tab-favicon" src="${tab.favIconUrl || ""}" alt="" onerror="this.style.display='none'" />
              <span class="vscw-tab-title">${escapeHtml(tab.title)}</span>
              <span class="vscw-tab-domain">${escapeHtml(tab.url ? new URL(tab.url).hostname : "")}</span>
              <span class="vscw-tab-window">${escapeHtml(tab.windowName)}</span>
            </div>`,
            )
            .join("")}
        </div>
      </div>
    `;

    // Styles
    const style = document.createElement("style");
    style.id = "vscw-overlay-styles";
    style.textContent = `
      #vscw-overlay {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .vscw-overlay-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
      }
      .vscw-overlay-panel {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #1e1e2e;
        border: 1px solid #313244;
        border-radius: 12px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        width: 80%;
        max-width: 720px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        color: #cdd6f4;
      }
      .vscw-overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid #313244;
      }
      .vscw-overlay-header h2 {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
        color: #89b4fa;
      }
      .vscw-close-btn {
        all: unset;
        font-size: 22px;
        cursor: pointer;
        color: #6c7086;
        padding: 2px 8px;
        border-radius: 6px;
        transition: background 0.1s, color 0.1s;
      }
      .vscw-close-btn:hover {
        background: #313244;
        color: #cdd6f4;
      }
      .vscw-tab-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 8px;
        padding: 14px 18px;
        overflow-y: auto;
        max-height: calc(80vh - 60px);
      }
      .vscw-tab-card {
        background: #181825;
        border: 1px solid #313244;
        border-radius: 8px;
        padding: 10px 12px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .vscw-tab-card:hover {
        border-color: #89b4fa;
        background: rgba(137, 180, 250, 0.08);
      }
      .vscw-tab-favicon {
        width: 20px;
        height: 20px;
        border-radius: 3px;
        margin-bottom: 4px;
      }
      .vscw-tab-title {
        font-size: 12px;
        font-weight: 500;
        color: #cdd6f4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vscw-tab-domain {
        font-size: 11px;
        color: #6c7086;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vscw-tab-window {
        font-size: 10px;
        color: #89b4fa;
        opacity: 0.7;
      }
    `;

    document.documentElement.appendChild(style);
    document.documentElement.appendChild(overlay);

    // Event: close
    document.getElementById("vscw-close-overview").addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "toggleOverview" });
    });

    // Event: click backdrop to close
    overlay.querySelector(".vscw-overlay-backdrop").addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "toggleOverview" });
    });

    // Event: tab card click to switch
    overlay.querySelectorAll(".vscw-tab-card").forEach((card) => {
      card.addEventListener("click", () => {
        const tabId = parseInt(card.dataset.tabId);
        const windowId = parseInt(card.dataset.windowId);
        chrome.tabs.update(tabId, { active: true });
        chrome.windows.update(windowId, { focused: true });
        chrome.runtime.sendMessage({ action: "toggleOverview" });
      });
    });

    // Event: Escape
    const keyHandler = (e) => {
      if (e.key === "Escape") {
        chrome.runtime.sendMessage({ action: "toggleOverview" });
        document.removeEventListener("keydown", keyHandler);
      }
    };
    document.addEventListener("keydown", keyHandler);
  }

  function hideOverview() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    const style = document.getElementById("vscw-overlay-styles");
    if (style) style.remove();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
