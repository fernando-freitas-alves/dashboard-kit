/**
 * dash-kit — the draggable, collapsible sidebar.
 *
 * Width is a stored preference, not transient UI state: a viewer who narrows
 * the filter rail expects it narrow tomorrow. Dragging below the minimum snaps
 * to the collapsed rail rather than leaving an unusable sliver, and the
 * preference remembers the last expanded width so uncollapsing restores it.
 *
 * Charts read their width from the layout, so the page must re-render after a
 * resize settles — that is what `onResize` is for.
 */

import { $, $$, store } from "./dom.js";
import { REDUCED } from "./motion.js";

let STORAGE_KEY = "dash-kit-sidebar";
/** Re-render hook: charts size to the layout, so a resize must redraw them. */
let onResize = () => { };
const SB_DEFAULT = 248;
const SB_COLLAPSED = 48;
const SB_MIN = 160;
const SB_MAX = 360;
const SB_STEP = 8;
/** @type {{ width: number, lastExpanded: number, collapsed: boolean }} */
let sbPref = { width: SB_DEFAULT, lastExpanded: SB_DEFAULT, collapsed: false };
let sbResizeClickAt = 0;

function sbAsNum(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function clampSbWidth(width) {
  const n = sbAsNum(width);
  if (n == null) return SB_DEFAULT;
  return Math.min(SB_MAX, Math.max(SB_COLLAPSED, Math.round(n)));
}
function isSbCollapsed(width) { return clampSbWidth(width) < SB_MIN; }
function snapSbWidth(width) {
  const clamped = clampSbWidth(width);
  return clamped < SB_MIN ? SB_COLLAPSED : clamped;
}
function normalizeSbPref(raw) {
  const explicit = typeof raw?.collapsed === "boolean" ? raw.collapsed : null;
  let width = snapSbWidth(raw?.width ?? SB_DEFAULT);
  let lastExpanded = snapSbWidth(raw?.lastExpanded ?? SB_DEFAULT);
  if (isSbCollapsed(lastExpanded)) lastExpanded = SB_DEFAULT;
  const collapsed = explicit ?? isSbCollapsed(width);
  if (collapsed) {
    if (!isSbCollapsed(width)) lastExpanded = width;
    width = SB_COLLAPSED;
  } else {
    if (isSbCollapsed(width)) width = lastExpanded;
    lastExpanded = width;
  }
  return { width, lastExpanded, collapsed };
}
function loadSbPref() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeSbPref(null);
    return normalizeSbPref(JSON.parse(raw));
  } catch (e) { return normalizeSbPref(null); }
}
function saveSbPref(pref) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSbPref(pref))); } catch (e) { /* ignore */ }
}
/** Live drag: expanded stays in [MIN, MAX]; below MIN snaps to the rail. */
function dragSbWidth(startWidth, deltaX, prev) {
  const start = clampSbWidth(startWidth);
  const startedCollapsed = Boolean(prev.collapsed) || isSbCollapsed(start);
  const delta = sbAsNum(deltaX) ?? 0;
  const raw = start + delta;
  if (raw < SB_MIN) {
    const lastExpanded = startedCollapsed
      ? snapSbWidth(prev.lastExpanded)
      : Math.max(start, SB_MIN);
    return {
      width: SB_COLLAPSED,
      lastExpanded: isSbCollapsed(lastExpanded) ? SB_DEFAULT : lastExpanded,
      collapsed: true,
      animate: !prev.collapsed,
    };
  }
  const width = Math.min(SB_MAX, Math.max(SB_MIN, Math.round(raw)));
  return { width, lastExpanded: width, collapsed: false, animate: Boolean(prev.collapsed) };
}
function stepSbWidth(width, delta) {
  const current = clampSbWidth(width);
  if (isSbCollapsed(current) && delta > 0) return SB_MIN;
  return snapSbWidth(current + delta);
}
function toggleSbPref(pref) {
  const n = normalizeSbPref(pref);
  if (n.collapsed) {
    return normalizeSbPref({ width: n.lastExpanded, lastExpanded: n.lastExpanded, collapsed: false });
  }
  return normalizeSbPref({ width: SB_COLLAPSED, lastExpanded: n.width, collapsed: true });
}

/**
 * Replay the filter-row entrance when the rail reopens, so an expanded sidebar
 * reads as arriving rather than snapping into place.
 */
export function staggerSidebarFilters() {
  if (REDUCED) return;
  const groups = [...$$("#filterControls .f-group"), $("#fg-time"), $(".sb-foot")].filter(Boolean);
  groups.forEach((g, i) => {
    g.classList.remove("sb-enter");
    void g.offsetWidth;
    g.style.animationDelay = `${Math.min(i * 0.05, 0.35)}s`;
    g.classList.add("sb-enter");
  });
}

function syncSbToggle(collapsed) {
  const btn = $("#sbToggle");
  if (!btn) return;
  btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

/**
 * Apply sidebar width/collapsed state to the DOM.
 * @param {{ width: number, lastExpanded: number, collapsed: boolean }} pref
 * @param {{ animate?: boolean, reflow?: boolean }} [opts]
 */
function applySbPref(pref, opts = {}) {
  const sb = $("#sidebar");
  const shell = $(".shell");
  const handle = $("#sbResize");
  if (!sb || !shell) return;
  const next = normalizeSbPref(pref);
  const wasCollapsed = sb.classList.contains("collapsed");
  sbPref = next;
  sb.style.setProperty("--sb-width", `${next.width}px`);
  sb.classList.toggle("collapsed", next.collapsed);
  syncSbToggle(next.collapsed);
  if (handle) {
    handle.setAttribute("aria-valuenow", String(next.width));
    handle.setAttribute("aria-valuetext", next.collapsed ? "Collapsed" : `${next.width} pixels`);
  }
  if (opts.animate !== false) {
    shell.classList.add("sb-resizing");
    if (wasCollapsed && !next.collapsed) staggerSidebarFilters();
    setTimeout(() => {
      shell.classList.remove("sb-resizing");
      if (opts.reflow !== false) onResize();
    }, REDUCED ? 40 : 360);
  } else if (opts.reflow) {
    onResize();
  }
}

function commitSbPref(pref, opts) {
  const next = normalizeSbPref(pref);
  saveSbPref(next);
  applySbPref(next, opts);
}

function toggleSidebar() {
  commitSbPref(toggleSbPref(sbPref));
}

/** Drag the sidebar edge; live-update within [min, max], snap-collapse below min. */
export function initSidebarResize(opts0 = {}) {
  if (opts0.storageKey) STORAGE_KEY = opts0.storageKey;
  if (opts0.onResize) onResize = opts0.onResize;
  const toggle = $("#sbToggle");
  if (toggle) toggle.onclick = () => toggleSidebar();
  applySbPref(loadSbPref(), { animate: false, reflow: false });
  const handle = $("#sbResize");
  if (!handle) return;

  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    if (matchMedia("(max-width: 800px)").matches) return;
    event.preventDefault();

    const now = Date.now();
    if (now - sbResizeClickAt < 400) {
      sbResizeClickAt = 0;
      toggleSidebar();
      return;
    }
    sbResizeClickAt = now;

    const sb = $("#sidebar");
    const shell = $(".shell");
    const startX = event.clientX;
    const startWidth = sbPref.width;
    let snappedThisGesture = false;
    let live = { ...sbPref };
    handle.setPointerCapture(event.pointerId);
    sb.classList.add("is-resizing");
    shell.classList.add("is-nav-resizing");

    const onMove = (moveEvent) => {
      sbResizeClickAt = 0;
      const drag = dragSbWidth(startWidth, moveEvent.clientX - startX, live);
      if (drag.animate) snappedThisGesture = true;
      // Live drag suppresses transitions; once we snap, keep transitions for the animation.
      const suppress = !snappedThisGesture && !drag.collapsed;
      sb.classList.toggle("is-resizing", suppress);
      shell.classList.toggle("is-nav-resizing", suppress);
      live = normalizeSbPref(drag);
      sbPref = live;
      sb.style.setProperty("--sb-width", `${live.width}px`);
      sb.classList.toggle("collapsed", live.collapsed);
      syncSbToggle(live.collapsed);
      handle.setAttribute("aria-valuenow", String(live.width));
    };

    const finish = (endEvent) => {
      handle.releasePointerCapture(endEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      sb.classList.remove("is-resizing");
      shell.classList.remove("is-nav-resizing");
      const snapped = normalizeSbPref({
        width: snapSbWidth(sbPref.width),
        lastExpanded: sbPref.collapsed || isSbCollapsed(sbPref.width)
          ? sbPref.lastExpanded
          : snapSbWidth(sbPref.width),
        collapsed: isSbCollapsed(sbPref.width),
      });
      saveSbPref(snapped);
      applySbPref(snapped, { animate: snappedThisGesture || snapped.collapsed !== live.collapsed, reflow: true });
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });

  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const width = stepSbWidth(sbPref.width, -SB_STEP);
      commitSbPref({
        width,
        lastExpanded: sbPref.lastExpanded,
        collapsed: isSbCollapsed(width),
      });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (sbPref.collapsed) { toggleSidebar(); return; }
      const width = stepSbWidth(sbPref.width, SB_STEP);
      commitSbPref({ width, lastExpanded: sbPref.lastExpanded, collapsed: false });
    } else if (event.key === "Home") {
      event.preventDefault();
      commitSbPref({
        width: SB_COLLAPSED,
        lastExpanded: sbPref.collapsed ? sbPref.lastExpanded : sbPref.width,
        collapsed: true,
      });
    } else if (event.key === "End") {
      event.preventDefault();
      commitSbPref({ width: SB_MAX, lastExpanded: SB_MAX, collapsed: false });
    }
  });
}
