// Background service worker for VS Code Windows
// Window layout manager — arrange, resize, and reposition Chrome windows like VS Code editor groups

// ─── State ────────────────────────────────────────────────────────────────
let layoutState = {
  areas: [], // { id, left, top, width, height } — each area = one Chrome window
  gap: 4, // px gap between areas
  layoutName: "custom",
};

// ─── Initialise: load saved layout on startup ─────────────────────────────
chrome.runtime.onStartup.addListener(() => {
  loadLayout();
});

// Configure side panel behaviour
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Load layout from storage
async function loadLayout() {
  try {
    const result = await chrome.storage.local.get("vscwLayout");
    if (result.vscwLayout) {
      layoutState.gap = result.vscwLayout.gap ?? 4;
    }
  } catch {
    /* ignore */
  }
}

function saveLayout() {
  chrome.storage.local.set({ vscwLayout: { gap: layoutState.gap } });
}

// ─── Command handlers ─────────────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  switch (command) {
    case "tile-windows":
      arrangeLayout("grid");
      break;
    case "snap-left":
      snapFocusedWindow("left");
      break;
    case "snap-right":
      snapFocusedWindow("right");
      break;
    case "toggle-window-overview":
      toggleOverview();
      break;
  }
});

// ─── Get display work area ────────────────────────────────────────────────
async function getWorkArea() {
  const displays = await chrome.system.display.getInfo();
  const primary = displays.find((d) => d.isPrimary) || displays[0];
  return primary.workArea;
}

// ─── Arrange windows into a VS Code-like layout ──────────────────────────
async function arrangeLayout(style, customAreas) {
  const windows = await chrome.windows.getAll({ populate: true });
  const normalWins = windows.filter((w) => w.type === "normal" && w.state !== "minimized");

  if (normalWins.length === 0) return;

  const workArea = await getWorkArea();
  let areas;

  if (customAreas) {
    areas = customAreas;
  } else {
    areas = computeAreas(normalWins.length, style, workArea);
  }

  layoutState.areas = [];
  normalWins.forEach((win, i) => {
    const area = areas[i] || areas[areas.length - 1];
    layoutState.areas.push({ id: win.id, ...area });
    chrome.windows.update(win.id, {
      left: Math.round(area.left),
      top: Math.round(area.top),
      width: Math.round(area.width),
      height: Math.round(area.height),
      state: "normal",
    });
  });

  saveLayout();
  return areas;
}

// ─── Compute area rects for a given style ─────────────────────────────────
function computeAreas(count, style, workArea) {
  const g = layoutState.gap;
  const w = workArea.width;
  const h = workArea.height;

  if (count === 0) return [];

  switch (style) {
    case "grid": {
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const cellW = (w - (cols - 1) * g) / cols;
      const cellH = (h - (rows - 1) * g) / rows;
      return Array.from({ length: count }, (_, i) => ({
        left: workArea.left + (i % cols) * (cellW + g),
        top: workArea.top + Math.floor(i / cols) * (cellH + g),
        width: cellW,
        height: cellH,
      }));
    }

    case "side-by-side": {
      const perRow = Math.min(count, 3);
      const rows = Math.ceil(count / perRow);
      const cellW = (w - (perRow - 1) * g) / perRow;
      const cellH = (h - (rows - 1) * g) / rows;
      return Array.from({ length: count }, (_, i) => ({
        left: workArea.left + (i % perRow) * (cellW + g),
        top: workArea.top + Math.floor(i / perRow) * (cellH + g),
        width: cellW,
        height: cellH,
      }));
    }

    case "stacked": {
      const cellH = (h - (count - 1) * g) / count;
      return Array.from({ length: count }, (_, i) => ({
        left: workArea.left,
        top: workArea.top + i * (cellH + g),
        width: w,
        height: cellH,
      }));
    }

    case "focus+sidebar": {
      if (count === 1) {
        return [{ left: workArea.left, top: workArea.top, width: w, height: h }];
      }
      const mainW = (w - g) * 0.7;
      const sideW = (w - g) * 0.3;
      const sideH = (h - (count - 2) * g) / Math.max(count - 1, 1);
      return [
        { left: workArea.left, top: workArea.top, width: mainW, height: h },
        ...Array.from({ length: count - 1 }, (_, i) => ({
          left: workArea.left + mainW + g,
          top: workArea.top + i * (sideH + g),
          width: sideW,
          height: sideH,
        })),
      ];
    }

    default:
      return [];
  }
}

// ─── Resize areas: called when user drags a splitter between two areas ────
async function resizeAreas(resizeData) {
  const win1 = layoutState.areas.find((a) => a.id === resizeData.areaId1);
  const win2 = layoutState.areas.find((a) => a.id === resizeData.areaId2);
  if (!win1 || !win2) return false;

  const g = layoutState.gap;
  const d = resizeData.delta;

  switch (resizeData.edge) {
    case "right":
      win1.width = Math.max(200, win1.width + d);
      win2.left = win1.left + win1.width + g;
      win2.width = Math.max(200, win2.width - d);
      break;
    case "bottom":
      win1.height = Math.max(150, win1.height + d);
      win2.top = win1.top + win1.height + g;
      win2.height = Math.max(150, win2.height - d);
      break;
    case "left":
      win2.width = Math.max(200, win2.width + d);
      win1.left = win2.left + win2.width + g;
      win1.width = Math.max(200, win1.width - d);
      break;
    case "top":
      win2.height = Math.max(150, win2.height + d);
      win1.top = win2.top + win2.height + g;
      win1.height = Math.max(150, win1.height - d);
      break;
  }

  for (const area of [win1, win2]) {
    try {
      await chrome.windows.update(area.id, {
        left: Math.round(area.left),
        top: Math.round(area.top),
        width: Math.round(area.width),
        height: Math.round(area.height),
        state: "normal",
      });
    } catch {
      /* window may have been closed */
    }
  }

  saveLayout();
  return true;
}

// ─── Swap areas: rearrange windows in the layout ──────────────────────────
async function swapAreas(id1, id2) {
  const a1 = layoutState.areas.find((a) => a.id === id1);
  const a2 = layoutState.areas.find((a) => a.id === id2);
  if (!a1 || !a2) return false;

  [a1.left, a2.left] = [a2.left, a1.left];
  [a1.top, a2.top] = [a2.top, a1.top];
  [a1.width, a2.width] = [a2.width, a1.width];
  [a1.height, a2.height] = [a2.height, a1.height];

  for (const area of [a1, a2]) {
    try {
      await chrome.windows.update(area.id, {
        left: Math.round(area.left),
        top: Math.round(area.top),
        width: Math.round(area.width),
        height: Math.round(area.height),
        state: "normal",
      });
    } catch {
      /* ignore */
    }
  }

  saveLayout();
  return true;
}

// ─── Add a new window to the layout ───────────────────────────────────────
async function addWindowToLayout() {
  return await chrome.windows.create({});
}

// ─── Snap focused window ──────────────────────────────────────────────────
async function snapFocusedWindow(side) {
  const win = await chrome.windows.getCurrent();
  const workArea = await getWorkArea();
  const halfW = Math.floor(workArea.width / 2);
  const left = side === "left" ? workArea.left : workArea.left + halfW;

  await chrome.windows.update(win.id, {
    left,
    top: workArea.top,
    width: halfW,
    height: workArea.height,
    state: "normal",
  });

  const area = layoutState.areas.find((a) => a.id === win.id);
  if (area) {
    area.left = left;
    area.top = workArea.top;
    area.width = halfW;
    area.height = workArea.height;
    saveLayout();
  }
}

// ─── Move a window to a specific position ─────────────────────────────────
async function moveWindow(winId, left, top, width, height) {
  try {
    await chrome.windows.update(winId, {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      height: Math.round(height),
      state: "normal",
    });
    const area = layoutState.areas.find((a) => a.id === winId);
    if (area) {
      area.left = left;
      area.top = top;
      area.width = width;
      area.height = height;
      saveLayout();
    }
  } catch {
    /* ignore */
  }
}

// ─── Tab group helpers ────────────────────────────────────────────────────
const GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const GROUP_COLOR_HEX = {
  grey: "#5c6370",
  blue: "#61afef",
  red: "#e06c75",
  yellow: "#e5c07b",
  green: "#98c379",
  pink: "#c678dd",
  purple: "#c678dd",
  cyan: "#56b6c2",
  orange: "#d19a66",
};

async function getTabGroupsForWindow(windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    return groups.map((g) => ({
      id: g.id,
      title: g.title || "Group",
      color: g.color,
      collapsed: g.collapsed,
    }));
  } catch {
    return [];
  }
}

async function createTabGroup(windowId, tabIds, title) {
  if (!tabIds || tabIds.length === 0) return null;
  const groupId = await chrome.tabs.group({ tabIds, windowId });
  if (title) {
    await chrome.tabGroups.update(groupId, { title });
  }
  // Assign a color based on existing group count
  const existing = await chrome.tabGroups.query({ windowId });
  const colorIdx = (existing.length - 1) % GROUP_COLORS.length;
  await chrome.tabGroups.update(groupId, { color: GROUP_COLORS[colorIdx] });
  return groupId;
}

async function moveTabToGroup(tabId, groupId) {
  await chrome.tabs.group({ tabIds: [tabId], groupId });
}

async function ungroupTabs(groupId) {
  await chrome.tabs.ungroup(groupId);
}

async function updateTabGroup(groupId, props) {
  await chrome.tabGroups.update(groupId, props);
}

async function removeTabGroup(groupId) {
  await chrome.tabs.ungroup(groupId);
}

// ─── Get layout data for the panel ────────────────────────────────────────
async function getLayoutForPanel() {
  const windows = await chrome.windows.getAll({ populate: true });
  const normalWins = windows.filter((w) => w.type === "normal");
  const workArea = await getWorkArea();

  const areas = await Promise.all(
    normalWins.map(async (win) => {
      const existing = layoutState.areas.find((a) => a.id === win.id);
      const tabGroups = await getTabGroupsForWindow(win.id);

      // Map tabIds to groups
      const groupMap = new Map();
      tabGroups.forEach((g) => groupMap.set(g.id, []));
      const ungrouped = [];

      win.tabs.forEach((t) => {
        if (t.groupId !== undefined && groupMap.has(t.groupId)) {
          groupMap.get(t.groupId).push(t);
        } else {
          ungrouped.push(t);
        }
      });

      const groups = tabGroups.map((g) => ({
        ...g,
        tabs: groupMap.get(g.id) || [],
      }));

      return {
        id: win.id,
        left: existing?.left ?? win.left ?? 0,
        top: existing?.top ?? win.top ?? 0,
        width: existing?.width ?? win.width ?? 600,
        height: existing?.height ?? win.height ?? 400,
        title: win.title || `Window ${win.id}`,
        state: win.state,
        focused: win.focused,
        tabs: win.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          favIconUrl: t.favIconUrl,
          active: t.active,
          groupId: t.groupId,
        })),
        tabsCount: win.tabs.length,
        groups, // tab group definitions
        ungrouped, // tabs not in any group
      };
    }),
  );

  layoutState.areas = areas.map((a) => ({
    id: a.id,
    left: a.left,
    top: a.top,
    width: a.width,
    height: a.height,
  }));

  return { areas, workArea, gap: layoutState.gap };
}

// ─── Window overview toggle ───────────────────────────────────────────────
let overviewOpen = false;

async function toggleOverview() {
  overviewOpen = !overviewOpen;
  if (overviewOpen) {
    const windows = await chrome.windows.getAll({ populate: true });
    const tabs = windows.flatMap((w) =>
      w.tabs.map((t) => ({
        windowId: w.id,
        tabId: t.id,
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl,
        windowName: w.title || `Window ${w.id}`,
      })),
    );
    const allTabs = windows.flatMap((w) => w.tabs);
    for (const tab of allTabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: "showOverview", tabs });
      } catch {
        /* no content script */
      }
    }
  } else {
    const windows = await chrome.windows.getAll({ populate: true });
    for (const w of windows) {
      for (const tab of w.tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: "hideOverview" });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

// ─── Message handling ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "getLayout":
      getLayoutForPanel().then(sendResponse);
      return true;

    case "arrangeLayout":
      arrangeLayout(request.style, request.areas).then(sendResponse);
      return true;

    case "resizeAreas":
      resizeAreas(request.resizeData).then(sendResponse);
      return true;

    case "swapAreas":
      swapAreas(request.id1, request.id2).then(sendResponse);
      return true;

    case "moveWindow":
      moveWindow(request.winId, request.left, request.top, request.width, request.height).then(sendResponse);
      return true;

    case "snapWindow":
      snapFocusedWindow(request.side);
      break;

    case "focusWindow":
      chrome.windows.update(request.windowId, { focused: true });
      break;

    case "closeWindow":
      chrome.windows.remove(request.windowId);
      break;

    case "newWindow":
      addWindowToLayout();
      break;

    case "minimizeWindow":
      chrome.windows.update(request.windowId, { state: "minimized" });
      break;

    case "maximizeWindow":
      chrome.windows.update(request.windowId, { state: "maximized" });
      break;

    case "restoreWindow":
      chrome.windows.update(request.windowId, { state: "normal" });
      break;

    case "tileWindows":
      arrangeLayout("grid");
      break;

    // ── Tab group actions ──
    case "createTabGroup":
      createTabGroup(request.windowId, request.tabIds, request.title).then(sendResponse);
      return true;

    case "moveTabToGroup":
      moveTabToGroup(request.tabId, request.groupId).then(() => sendResponse({ ok: true }));
      return true;

    case "ungroupTabs":
      ungroupTabs(request.groupId).then(() => sendResponse({ ok: true }));
      return true;

    case "updateTabGroup":
      updateTabGroup(request.groupId, request.props).then(() => sendResponse({ ok: true }));
      return true;

    case "removeTabGroup":
      removeTabGroup(request.groupId).then(() => sendResponse({ ok: true }));
      return true;

    case "moveTabToWindow":
      // Move a tab from one window to another — ungroup first if needed
      (async () => {
        try {
          const tab = await chrome.tabs.get(request.tabId);
          if (tab.groupId && tab.groupId !== -1) {
            await chrome.tabs.ungroup(request.tabId);
          }
          const moved = await chrome.tabs.move(request.tabId, {
            windowId: request.targetWindowId,
            index: -1,
          });
          if (moved) {
            await chrome.tabs.update(moved.id, { active: true });
          }
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ error: e.message });
        }
      })();
      return true;

    case "moveTabsToNewGroup":
      chrome.tabs
        .group({ tabIds: request.tabIds, windowId: request.windowId })
        .then((groupId) => {
          if (request.title) {
            return chrome.tabGroups.update(groupId, { title: request.title });
          }
        })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ error: e.message }));
      return true;

    case "splitWindowToGroups":
      // Split all tabs in a window into two groups: first N tabs stay, rest go to new group
      (async () => {
        const { windowId, splitIndex, groupTitle } = request;
        const tabs = await chrome.tabs.query({ windowId });
        const splitTabs = tabs.slice(splitIndex).map((t) => t.id);
        if (splitTabs.length === 0) return sendResponse({ ok: true });
        const groupId = await chrome.tabs.group({ tabIds: splitTabs, windowId });
        await chrome.tabGroups.update(groupId, { title: groupTitle || "Split" });
        const colors = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
        const existing = await chrome.tabGroups.query({ windowId });
        const colorIdx = (existing.length - 1) % colors.length;
        await chrome.tabGroups.update(groupId, { color: colors[colorIdx] });
        sendResponse({ ok: true, groupId });
      })();
      return true;
  }
});
