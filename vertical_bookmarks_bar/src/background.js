// Background service worker for Vertical Bookmarks Bar
// Handles Chrome Bookmarks API requests and toolbar icon clicks

// ─── Theme-based toolbar icon ─────────────────────────────────────────────
// Dark icon (for light Chrome toolbar) — dark Material bookmark ribbon
const ICON_DARK = "src/icons/icon.svg";
// Light icon (for dark Chrome toolbar) — white Material bookmark ribbon
const ICON_LIGHT = "src/icons/icon-light.svg";

let currentTheme = null;

function setThemeIcon(theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  const path = theme === "light" ? ICON_LIGHT : ICON_DARK;
  chrome.action.setIcon({ path }).catch(() => {
    // Silently ignore if the icon file doesn't exist yet
  });
}

// Restore icon from storage on startup
chrome.storage.local.get("vbbIconTheme", (result) => {
  if (result.vbbIconTheme) {
    setThemeIcon(result.vbbIconTheme);
  } else {
    // Default to dark icon (matches existing behaviour)
    setThemeIcon("dark");
  }
});

// ─── Ensure content script is loaded in a tab ─────────────────────────────
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true; // Already loaded
  } catch {
    // Not loaded — inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["src/styles.css"],
      });
      return true;
    } catch {
      return false; // Can't inject (e.g., chrome:// pages)
    }
  }
}

// ─── Inject into every tab when it loads or is activated ──────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    ensureContentScript(tabId);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  ensureContentScript(activeInfo.tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) ensureContentScript(tab.id);
});

// Toggle the drawer when the extension toolbar icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  const loaded = await ensureContentScript(tab.id);
  if (loaded) {
    chrome.tabs.sendMessage(tab.id, { action: "toggleDrawer" });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "themeChanged":
      setThemeIcon(request.theme);
      chrome.storage.local.set({ vbbIconTheme: request.theme });
      sendResponse({ ok: true });
      return false;

    case "getBookmarksBar":
      // '1' is the fixed ID for the Bookmarks Bar folder
      chrome.bookmarks.getChildren("1", (items) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ items });
        }
      });
      return true; // Keep message channel open for async response

    case "getFolderContents":
      chrome.bookmarks.getChildren(request.folderId, (items) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ items });
        }
      });
      return true; // Keep message channel open for async response
  }
});
