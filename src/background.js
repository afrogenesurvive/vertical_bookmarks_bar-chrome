// Background service worker for Vertical Bookmarks Bar
// Handles Chrome Bookmarks API requests and toolbar icon clicks

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
  if (changeInfo.status === "complete" && tab.url && tab.url.startsWith("http")) {
    ensureContentScript(tabId);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  ensureContentScript(activeInfo.tabId);
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

    case "getBookmarkById":
      chrome.bookmarks.get(request.bookmarkId, (items) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ item: items[0] });
        }
      });
      return true;
  }
});
