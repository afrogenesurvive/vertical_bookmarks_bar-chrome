// VS Code Windows — Panel
// Visual layout editor — each Chrome window shows its tab groups as VS Code-like editor groups

// ─── State ────────────────────────────────────────────────────────────────
let state = {
  areas: [],
  workArea: { left: 0, top: 0, width: 1920, height: 1080 },
  gap: 4,
};

let dragState = null; // { type: 'resize' | 'swap' | 'tab-drag', ... }
let pollInterval = null;

// Hex colours for Chrome tab group colours
const GROUP_COLORS = {
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

// ─── Initialise ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadLayout();

  document.querySelectorAll(".preset-btn[data-layout]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "arrangeLayout", style: btn.dataset.layout }, loadLayout);
    });
  });

  document.getElementById("snapLeftBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "snapWindow", side: "left" });
  });
  document.getElementById("snapRightBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "snapWindow", side: "right" });
  });
  document.getElementById("newWinBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "newWindow" });
    setTimeout(loadLayout, 300);
  });
  document.getElementById("openPanelBtn").addEventListener("click", openAsTab);

  pollInterval = setInterval(loadLayout, 2000);
});

// ─── Load layout from background ──────────────────────────────────────────
function loadLayout() {
  chrome.runtime.sendMessage({ action: "getLayout" }, (response) => {
    if (!response) return;
    state.areas = response.areas || [];
    state.workArea = response.workArea || state.workArea;
    state.gap = response.gap ?? 4;
    render();
  });
}

// ─── Render the layout canvas ─────────────────────────────────────────────
function render() {
  const canvas = document.getElementById("layoutCanvas");
  const winCount = document.getElementById("winCount");
  const layoutInfo = document.getElementById("layoutInfo");

  if (state.areas.length === 0) {
    canvas.innerHTML = '<div class="canvas-empty">No windows open</div>';
    winCount.textContent = "0 windows";
    layoutInfo.textContent = "—";
    return;
  }

  const totalTabs = state.areas.reduce((s, a) => s + a.tabsCount, 0);
  winCount.textContent = `${state.areas.length} win · ${totalTabs} tabs`;
  layoutInfo.textContent = `${Math.round(state.areas[0]?.width || 0)}×${Math.round(state.areas[0]?.height || 0)}`;

  // Scale
  const canvasRect = canvas.getBoundingClientRect();
  const padding = 4;
  const availW = canvasRect.width - padding * 2;
  const availH = canvasRect.height - padding * 2;

  const minX = Math.min(...state.areas.map((a) => a.left));
  const minY = Math.min(...state.areas.map((a) => a.top));
  const maxX = Math.max(...state.areas.map((a) => a.left + a.width));
  const maxY = Math.max(...state.areas.map((a) => a.top + a.height));
  const totalW = maxX - minX;
  const totalH = maxY - minY;

  const scale = Math.min(availW / totalW, availH / totalH, 1);
  const offsetX = (availW - totalW * scale) / 2 + padding - minX * scale;
  const offsetY = (availH - totalH * scale) / 2 + padding - minY * scale;

  function toCanvas(area) {
    return {
      left: area.left * scale + offsetX,
      top: area.top * scale + offsetY,
      width: area.width * scale,
      height: area.height * scale,
    };
  }

  // ── Build HTML ──
  let html = "";
  const areaMap = {};

  state.areas.forEach((area) => {
    const c = toCanvas(area);
    areaMap[area.id] = c;

    const groups = area.groups || [];
    const ungrouped = area.ungrouped || [];

    // Build per-group sections
    let groupsHtml = "";

    if (ungrouped.length > 0 && groups.length === 0) {
      // No groups - show all tabs in one section
      groupsHtml = renderTabList(ungrouped, area.id, null);
    } else {
      // Show ungrouped tabs (if any)
      if (ungrouped.length > 0) {
        groupsHtml += `<div class="grp-section" data-win-id="${area.id}">
          <div class="grp-header" style="border-left:3px solid #6c7086">
            <span class="grp-title">Other tabs</span>
            <span class="grp-count">${ungrouped.length}</span>
          </div>
          <div class="grp-tabs" data-group-id="">
            ${renderTabListItems(ungrouped, area.id, null)}
          </div>
        </div>`;
      }

      // Show each tab group
      groups.forEach((g) => {
        const colorHex = GROUP_COLORS[g.color] || "#6c7086";
        groupsHtml += `<div class="grp-section" data-win-id="${area.id}">
          <div class="grp-header" style="border-left:3px solid ${colorHex}">
            <span class="grp-dot" style="background:${colorHex}"></span>
            <span class="grp-title">${esc(g.title)}</span>
            <span class="grp-count">${g.tabs.length}</span>
            <div class="grp-actions">
              <button class="grp-btn grp-split-btn" data-win-id="${area.id}" data-group-id="${g.id}" title="Split to new group">⊕</button>
              <button class="grp-btn grp-color-btn" data-group-id="${g.id}" title="Change colour">◉</button>
              <button class="grp-btn grp-ungroup-btn" data-group-id="${g.id}" title="Ungroup">⊖</button>
            </div>
          </div>
          <div class="grp-tabs" data-group-id="${g.id}">
            ${renderTabListItems(g.tabs, area.id, g.id)}
          </div>
        </div>`;
      });
    }

    // "New group" button at the bottom
    groupsHtml += `<div class="grp-new-group">
      <button class="grp-new-btn" data-win-id="${area.id}" title="Create a new tab group">+ New group</button>
    </div>`;

    html += `
      <div class="win-area${area.focused ? " focused" : ""}"
           data-win-id="${area.id}"
           style="left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px">
        <div class="win-header" data-win-id="${area.id}">
          <span class="win-header-title">${esc(area.title)}</span>
          <span class="win-header-tabs">${area.tabsCount}</span>
          <button class="win-close-btn" data-win-id="${area.id}" title="Close window">&times;</button>
        </div>
        <div class="win-body">${groupsHtml}</div>
      </div>
    `;
  });

  // Resize handles between areas
  for (let i = 0; i < state.areas.length; i++) {
    for (let j = i + 1; j < state.areas.length; j++) {
      const a1 = state.areas[i];
      const a2 = state.areas[j];
      const c1 = areaMap[a1.id];
      const c2 = areaMap[a2.id];
      if (!c1 || !c2) continue;

      const tol = 20;
      const a1r = a1.left + a1.width;
      const a1b = a1.top + a1.height;
      const a2r = a2.left + a2.width;
      const a2b = a2.top + a2.height;

      if (Math.abs(a1r - a2.left) < tol && a1.top < a2b && a1b > a2.top) {
        const hx = c1.left + c1.width;
        const hTop = Math.max(c1.top, c2.top);
        const hBot = Math.min(c1.top + c1.height, c2.top + c2.height);
        html += `<div class="resize-handle h-vertical"
          style="left:${hx - 3}px;top:${hTop}px;height:${hBot - hTop}px"
          data-edge="right" data-id1="${a1.id}" data-id2="${a2.id}"></div>`;
      }
      if (Math.abs(a1b - a2.top) < tol && a1.left < a2r && a1r > a2.left) {
        const hy = c1.top + c1.height;
        const hLeft = Math.max(c1.left, c2.left);
        const hRight = Math.min(c1.left + c1.width, c2.left + c2.width);
        html += `<div class="resize-handle h-horizontal"
          style="left:${hLeft}px;top:${hy - 3}px;width:${hRight - hLeft}px"
          data-edge="bottom" data-id1="${a1.id}" data-id2="${a2.id}"></div>`;
      }
    }
  }

  canvas.innerHTML = html;
  attachEvents(canvas);
}

// ─── Render a tab list for a group ────────────────────────────────────────
function renderTabList(tabs, winId, groupId) {
  return `<div class="grp-section" data-win-id="${winId}">
    <div class="grp-tabs" data-group-id="${groupId || ""}">
      ${renderTabListItems(tabs, winId, groupId)}
    </div>
  </div>`;
}

function renderTabListItems(tabs, winId, groupId) {
  return tabs
    .slice(0, 30)
    .map(
      (t) => `
    <div class="win-tab${t.active ? " active" : ""}"
         draggable="true"
         data-tab-id="${t.id}"
         data-win-id="${winId}"
         data-group-id="${groupId || ""}">
      <img class="win-tab-favicon" src="${esc(t.favIconUrl || "")}" alt=""
           onerror="this.style.display='none'" />
      <span class="win-tab-title">${esc(t.title || "Untitled")}</span>
    </div>
  `,
    )
    .join("");
}

// ─── Attach event listeners ───────────────────────────────────────────────
function attachEvents(canvas) {
  // ── Close window button ──
  canvas.querySelectorAll(".win-close-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "closeWindow", windowId: parseInt(btn.dataset.winId) });
      setTimeout(loadLayout, 200);
    });
  });

  // ── Click tab → focus ──
  canvas.querySelectorAll(".win-tab").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      const tabId = parseInt(el.dataset.tabId);
      const winId = parseInt(el.dataset.winId);
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(winId, { focused: true });
    });
  });

  // ── Drag window header → swap areas ──
  canvas.querySelectorAll(".win-header").forEach((header) => {
    header.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const winId = parseInt(header.dataset.winId);
      startSwap(winId, e);
    });
    header.addEventListener("click", (e) => {
      if (dragState) return;
      chrome.runtime.sendMessage({ action: "focusWindow", windowId: parseInt(header.dataset.winId) });
    });
  });

  // ── Resize handles ──
  canvas.querySelectorAll(".resize-handle").forEach((handle) => {
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startResize(parseInt(handle.dataset.id1), parseInt(handle.dataset.id2), handle.dataset.edge, e);
    });
  });

  // ── Tab drag-and-drop ──
  let tabDragState = null;

  canvas.querySelectorAll(".win-tab[draggable]").forEach((tab) => {
    tab.addEventListener("dragstart", (e) => {
      const title = tab.querySelector(".win-tab-title")?.textContent || "tab";
      tabDragState = {
        tabId: parseInt(tab.dataset.tabId),
        sourceWinId: parseInt(tab.dataset.winId),
        sourceGroupId: tab.dataset.groupId || null,
        title,
      };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.dataset.tabId);
      // Custom drag image
      const ghost = document.createElement("div");
      ghost.textContent = title;
      Object.assign(ghost.style, {
        position: "fixed",
        top: "-999px",
        padding: "4px 10px",
        background: "#1e1e2e",
        color: "#cdd6f4",
        border: "1px solid #89b4fa",
        borderRadius: "6px",
        fontSize: "12px",
        whiteSpace: "nowrap",
      });
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 10);
      setTimeout(() => ghost.remove(), 0);
      tab.classList.add("dragging");
    });

    tab.addEventListener("dragend", () => {
      canvas.querySelectorAll(".win-tab").forEach((t) => t.classList.remove("dragging"));
      canvas.querySelectorAll(".grp-tabs").forEach((t) => t.classList.remove("drop-target"));
      document.querySelectorAll(".drop-indicator").forEach((d) => d.remove());
      tabDragState = null;
    });
  });

  // ── Helper: perform the tab move ──
  function executeTabDrop(targetWinId, targetGroupId) {
    if (!tabDragState) return;
    const sameWin = targetWinId === tabDragState.sourceWinId;
    const sameGroup = targetGroupId === tabDragState.sourceGroupId;
    if (sameWin && sameGroup) return;

    const cb = () => setTimeout(loadLayout, 200);

    if (!sameWin) {
      // Move tab to a different window
      chrome.runtime.sendMessage({ action: "moveTabToWindow", tabId: tabDragState.tabId, targetWindowId: targetWinId }, cb);
    } else if (!sameGroup) {
      // Move tab to a different group in same window
      if (targetGroupId) {
        chrome.runtime.sendMessage({ action: "moveTabToGroup", tabId: tabDragState.tabId, groupId: parseInt(targetGroupId) }, cb);
      } else {
        // Drop on ungrouped → ungroup the tab
        chrome.tabs.ungroup(tabDragState.tabId, cb);
      }
    }
  }

  // ── Drop target setup helper ──
  function makeDropTarget(el, getTarget) {
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!tabDragState) return;
      const { winId, groupId } = getTarget(e, el);
      if (winId) executeTabDrop(winId, groupId);
    });
  }

  // Drop on a group's tab list
  canvas.querySelectorAll(".grp-tabs").forEach((container) => {
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      container.classList.add("drop-target");
    });
    container.addEventListener("dragleave", () => container.classList.remove("drop-target"));
    container.addEventListener("drop", (e) => {
      e.preventDefault();
      container.classList.remove("drop-target");
      if (!tabDragState) return;
      const targetGroupId = container.dataset.groupId || null;
      const targetWinId = parseInt(container.closest("[data-win-id]")?.dataset.winId);
      if (targetWinId) executeTabDrop(targetWinId, targetGroupId);
    });
  });

  // Drop on a window header → move tab to that window (ungrouped)
  canvas.querySelectorAll(".win-header").forEach((header) => {
    header.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    header.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!tabDragState) return;
      const targetWinId = parseInt(header.dataset.winId);
      if (targetWinId) executeTabDrop(targetWinId, null);
    });
  });

  // Drop on the window body (empty area) → move tab ungrouped
  canvas.querySelectorAll(".win-body").forEach((body) => {
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    body.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!tabDragState) return;
      const targetWinId = parseInt(body.closest("[data-win-id]")?.dataset.winId);
      if (targetWinId) executeTabDrop(targetWinId, null);
    });
  });

  // ── Group action buttons ──
  canvas.querySelectorAll(".grp-split-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "ungroupTabs", groupId: parseInt(btn.dataset.groupId) }, loadLayout);
    });
  });

  canvas.querySelectorAll(".grp-ungroup-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: "ungroupTabs", groupId: parseInt(btn.dataset.groupId) }, loadLayout);
    });
  });

  canvas.querySelectorAll(".grp-color-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      cycleGroupColor(parseInt(btn.dataset.groupId));
    });
  });

  // ── New group button ──
  canvas.querySelectorAll(".grp-new-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      createNewGroup(parseInt(btn.dataset.winId));
    });
  });

  // ── Right-click context menu on tabs ──
  const ctxMenu = document.createElement("div");
  ctxMenu.id = "vscw-ctxmenu";
  Object.assign(ctxMenu.style, {
    display: "none",
    position: "fixed",
    zIndex: "2000",
    background: "#181825",
    border: "1px solid #313244",
    borderRadius: "8px",
    padding: "4px 0",
    minWidth: "180px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    fontSize: "12px",
  });
  document.body.appendChild(ctxMenu);

  let ctxTabId = null,
    ctxWinId = null;

  function showCtxMenu(e, tabId, winId) {
    e.preventDefault();
    ctxTabId = tabId;
    ctxWinId = winId;

    // Enumerate windows + groups
    chrome.runtime.sendMessage({ action: "getLayout" }, (response) => {
      if (!response) return;
      let items = [{ label: "New window", icon: "+", action: "new-window" }, { type: "separator" }];

      response.areas.forEach((win) => {
        // Window entry
        const isCurrent = win.id === winId;
        items.push({
          label: `${isCurrent ? "• " : ""}${win.title || "Window " + win.id} (${win.tabsCount})`,
          icon: "▣",
          action: "move-win",
          winId: win.id,
          disabled: isCurrent,
        });

        // Groups within that window
        (win.groups || []).forEach((g) => {
          const gHex = GROUP_COLORS[g.color] || "#6c7086";
          items.push({
            label: `  ${g.title} (${g.tabs.length})`,
            icon: "●",
            iconColor: gHex,
            action: "move-group",
            winId: win.id,
            groupId: g.id,
          });
        });

        // "Other tabs" entry for this window (move ungrouped)
        if (win.ungrouped && win.ungrouped.length >= 0) {
          items.push({
            label: `  Other tabs`,
            icon: "○",
            action: "move-ungrouped",
            winId: win.id,
          });
        }
      });

      renderCtxMenu(e, items);
    });
  }

  function renderCtxMenu(e, items) {
    ctxMenu.innerHTML = "";
    ctxMenu.style.display = "block";
    ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 200) + "px";
    ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - items.length * 28) + "px";

    items.forEach((item) => {
      if (item.type === "separator") {
        const hr = document.createElement("hr");
        Object.assign(hr.style, { border: "none", borderTop: "1px solid #313244", margin: "4px 0" });
        ctxMenu.appendChild(hr);
        return;
      }
      const el = document.createElement("div");
      Object.assign(el.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 12px",
        cursor: item.disabled ? "default" : "pointer",
        color: item.disabled ? "#6c7086" : "#cdd6f4",
        transition: "background 0.1s",
      });
      if (!item.disabled) {
        el.addEventListener("mouseenter", () => (el.style.background = "rgba(137,180,250,0.1)"));
        el.addEventListener("mouseleave", () => (el.style.background = "transparent"));
      }

      const icon = document.createElement("span");
      icon.textContent = item.icon || "";
      if (item.iconColor) icon.style.color = item.iconColor;
      icon.style.width = "16px";
      icon.style.textAlign = "center";
      icon.style.flexShrink = "0";

      const label = document.createElement("span");
      label.textContent = item.label;
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      label.style.whiteSpace = "nowrap";

      el.appendChild(icon);
      el.appendChild(label);

      if (!item.disabled) {
        el.addEventListener("click", () => {
          ctxMenu.style.display = "none";
          handleCtxAction(item, ctxTabId, ctxWinId);
        });
      }

      ctxMenu.appendChild(el);
    });
  }

  function handleCtxAction(item, tabId, sourceWinId) {
    switch (item.action) {
      case "new-window":
        chrome.runtime.sendMessage({ action: "newWindow" }, () => {
          // Move the tab to the newly created window (last window)
          chrome.windows.getAll({}, (wins) => {
            const last = wins[wins.length - 1];
            if (last) {
              chrome.runtime.sendMessage({ action: "moveTabToWindow", tabId, targetWindowId: last.id }, loadLayout);
            }
          });
        });
        break;
      case "move-win":
        chrome.runtime.sendMessage({ action: "moveTabToWindow", tabId, targetWindowId: item.winId }, loadLayout);
        break;
      case "move-group":
        chrome.runtime.sendMessage({ action: "moveTabToGroup", tabId, groupId: item.groupId }, loadLayout);
        break;
      case "move-ungrouped":
        if (item.winId !== sourceWinId) {
          chrome.runtime.sendMessage({ action: "moveTabToWindow", tabId, targetWindowId: item.winId }, () => {
            setTimeout(() => chrome.tabs.ungroup(tabId, loadLayout), 100);
          });
        } else {
          chrome.tabs.ungroup(tabId, loadLayout);
        }
        break;
    }
  }

  canvas.querySelectorAll(".win-tab").forEach((tab) => {
    tab.addEventListener("contextmenu", (e) => {
      showCtxMenu(e, parseInt(tab.dataset.tabId), parseInt(tab.dataset.winId));
    });
  });

  // Close context menu on click outside
  document.addEventListener("click", (e) => {
    if (!ctxMenu.contains(e.target)) ctxMenu.style.display = "none";
  });
  document.addEventListener("contextmenu", (e) => {
    if (!ctxMenu.contains(e.target)) ctxMenu.style.display = "none";
  });
}

// ─── Cycle group colour ───────────────────────────────────────────────────
const COLOR_CYCLE = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];

function cycleGroupColor(groupId) {
  // We need the current colour — query from Chrome
  chrome.tabGroups.get(groupId, (group) => {
    if (chrome.runtime.lastError) return;
    const idx = COLOR_CYCLE.indexOf(group.color);
    const next = COLOR_CYCLE[(idx + 1) % COLOR_CYCLE.length];
    chrome.runtime.sendMessage({ action: "updateTabGroup", groupId, props: { color: next } }, loadLayout);
  });
}

// ─── Create a new tab group ───────────────────────────────────────────────
function createNewGroup(winId) {
  // Move the active tab (or first tab) into a new group
  chrome.tabs.query({ windowId, active: true }, (tabs) => {
    const tabId = tabs.length > 0 ? tabs[0].id : null;
    if (!tabId) return;
    // First, check if the tab is already in a group
    chrome.tabs.get(tabId, (tab) => {
      if (tab.groupId && tab.groupId !== -1) {
        // Ungroup it first
        chrome.tabs.ungroup(tab.groupId, () => {
          chrome.runtime.sendMessage({ action: "createTabGroup", windowId, tabIds: [tabId], title: "Group" }, loadLayout);
        });
      } else {
        chrome.runtime.sendMessage({ action: "createTabGroup", windowId, tabIds: [tabId], title: "Group" }, loadLayout);
      }
    });
  });
}

// ─── Split a window into two groups ───────────────────────────────────────
function splitWindowAt(winId, splitIndex) {
  chrome.runtime.sendMessage({ action: "splitWindowToGroups", windowId, splitIndex, groupTitle: "Split" }, loadLayout);
}

// ─── Resize dragging ──────────────────────────────────────────────────────
function startResize(areaId1, areaId2, edge, e) {
  dragState = { type: "resize", areaId1, areaId2, edge, startX: e.clientX, startY: e.clientY };
  document.querySelectorAll(".resize-handle").forEach((h) => h.classList.add("active"));
  document.addEventListener("mousemove", onResizeMouseMove);
  document.addEventListener("mouseup", onResizeMouseUp);
}

function onResizeMouseMove(e) {
  if (!dragState || dragState.type !== "resize") return;
  const delta =
    dragState.edge === "right" || dragState.edge === "left"
      ? (e.clientX - dragState.startX) / (state.workArea.width / (state.areas[0]?.width || 1))
      : (e.clientY - dragState.startY) / (state.workArea.height / (state.areas[0]?.height || 1));

  clearTimeout(dragState._timer);
  dragState._timer = setTimeout(() => {
    chrome.runtime.sendMessage(
      {
        action: "resizeAreas",
        resizeData: { areaId1: dragState.areaId1, areaId2: dragState.areaId2, edge: dragState.edge, delta },
      },
      loadLayout,
    );
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
  }, 30);
}

function onResizeMouseUp() {
  if (dragState) clearTimeout(dragState._timer);
  dragState = null;
  document.querySelectorAll(".resize-handle").forEach((h) => h.classList.remove("active"));
  document.removeEventListener("mousemove", onResizeMouseMove);
  document.removeEventListener("mouseup", onResizeMouseUp);
  loadLayout();
}

// ─── Drag-to-swap windows ─────────────────────────────────────────────────
function startSwap(winId, e) {
  const rect = e.target.closest(".win-area")?.getBoundingClientRect();
  if (!rect) return;

  dragState = {
    type: "swap",
    sourceId: winId,
    startX: e.clientX,
    startY: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    ghost: null,
  };

  const ghost = document.createElement("div");
  ghost.className = "win-area";
  Object.assign(ghost.style, {
    position: "fixed",
    width: rect.width + "px",
    height: rect.height + "px",
    left: rect.left + "px",
    top: rect.top + "px",
    zIndex: "1000",
    opacity: "0.7",
    pointerEvents: "none",
    transform: "scale(0.95)",
  });
  ghost.innerHTML = `<div class="win-header"><span class="win-header-title">↕ Moving...</span></div>`;
  document.body.appendChild(ghost);
  dragState.ghost = ghost;

  document.addEventListener("mousemove", onSwapMouseMove);
  document.addEventListener("mouseup", onSwapMouseUp);
}

function onSwapMouseMove(e) {
  if (!dragState || dragState.type !== "swap") return;
  const g = dragState.ghost;
  if (g) {
    g.style.left = e.clientX - dragState.offsetX + "px";
    g.style.top = e.clientY - dragState.offsetY + "px";
  }
  document.querySelectorAll(".win-area").forEach((el) => el.classList.remove("drag-over"));
  const hovered = document.elementFromPoint(e.clientX, e.clientY)?.closest(".win-area");
  if (hovered) {
    const id = parseInt(hovered.dataset.winId);
    if (id !== dragState.sourceId) {
      hovered.classList.add("drag-over");
      dragState.targetId = id;
    } else dragState.targetId = null;
  } else dragState.targetId = null;
}

function onSwapMouseUp() {
  if (!dragState) return;
  if (dragState.ghost) dragState.ghost.remove();
  if (dragState.targetId && dragState.targetId !== dragState.sourceId) {
    chrome.runtime.sendMessage({ action: "swapAreas", id1: dragState.sourceId, id2: dragState.targetId }, loadLayout);
  }
  document.querySelectorAll(".win-area").forEach((el) => el.classList.remove("drag-over"));
  document.removeEventListener("mousemove", onSwapMouseMove);
  document.removeEventListener("mouseup", onSwapMouseUp);
  dragState = null;
}

// ─── Open as standalone tab ───────────────────────────────────────────────
function openAsTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/panel.html") });
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

window.addEventListener("unload", () => {
  if (pollInterval) clearInterval(pollInterval);
});
