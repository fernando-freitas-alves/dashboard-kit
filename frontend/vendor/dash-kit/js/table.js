import * as d3 from 'd3';
/**
 * dash-kit — the data table.
 *
 * Search, sort, drag-to-reorder and drag-to-resize columns, in-cell value
 * bars, pagination, CSV export, and click-a-cell-to-cross-filter. State lives
 * on the element itself (`el.__st`) so a re-render keeps the user's sort,
 * page, query, column order and widths — a cross-filter click must not feel
 * like the card reloaded. Column order, widths, sort and page size are also
 * saved per table in localStorage (keyed by `o.persist`, else `o.csv`), so
 * they survive a reload.
 *
 * Resizing a column changes only that column (in px). The table is as wide as
 * its columns and scrolls horizontally inside the card when that exceeds it;
 * when the columns are narrower than the card, the last column takes up the
 * slack so the table still fills the width.
 *
 * Cell clicks are reported through the handler given to `configureTable`; the
 * table never touches filter state directly.
 *
 * Requires d3 on the page (CSV formatting and number helpers).
 */

import { $, $$, esc, debounce } from "./dom.js";
import { ANIM, REDUCED } from "./motion.js";
import { colorFor } from "./palette.js";
import { int } from "./format.js";
import { feedbackClick } from "./patterns.js";
import { enhanceSelect, shelvePop, closeAllDropdowns, openPortaledPop } from "./listbox.js";

/** How long a typing burst settles before the table filters. */
export const SEARCH_DEBOUNCE_MS = 450;

/** Stand-in shown (and exported) for a missing dimension value. */
let EMPTY_LABEL = "(not informed)";

/** What a click on a dimension cell does. The page owns cross-filtering. */
let onDim = () => { };

/**
 * Wire the table into a page's cross-filter model.
 *
 * @param {object} cfg
 * @param {(dim: string, value: string, ev: MouseEvent) => void} [cfg.onDimensionClick]
 * @param {string} [cfg.emptyLabel] stand-in for null/empty dimension values
 */
export function configureTable({ onDimensionClick, emptyLabel } = {}) {
  if (onDimensionClick) onDim = onDimensionClick;
  if (emptyLabel) EMPTY_LABEL = emptyLabel;
}

const nv = v => (v === null || v === undefined || v === "" ? EMPTY_LABEL : String(v));

/* o: { cols:[{k,label,get,fmt,num,dim,bar,bool,badge,help}], rows:[], key(row), sel:Set, pageSize, summary:{k:val}|fn, defaultSort:{k,dir}, csv:name, persist:string|false } */

const PREFS_PREFIX = "dk-tbl:v1:";
const PAGE_SIZES = [10, 25, 50, 100, 200, 0];
/** Narrowest a column may be resized to (px). */
const MIN_COL_PX = 56;
/** Keyboard resize steps (px): arrow, Shift+arrow. */
const KEY_STEP_PX = 8;
const KEY_STEP_BIG_PX = 32;

/** localStorage key for a table's saved layout; `null` when it opts out or has no id. */
function prefsKey(o) {
  if (o.persist === false) return null;
  const id = typeof o.persist === "string" ? o.persist : o.csv;
  return id ? `${PREFS_PREFIX}${location.pathname}:${id}` : null;
}

/** Saved column order / widths / sort / page size, validated loosely (columns are reconciled later). */
function loadPrefs(key, o) {
  if (!key) return null;
  let p;
  try { p = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; }
  if (!p || typeof p !== "object") return null;
  const out = {};
  if (Array.isArray(p.colOrder)) out.colOrder = p.colOrder.filter(k => typeof k === "string");
  // `colPx` (px widths); the older `widths` field held percentages and is ignored.
  if (p.colPx && typeof p.colPx === "object") {
    out.widths = Object.fromEntries(Object.entries(p.colPx).filter(([, w]) => typeof w === "number" && w >= MIN_COL_PX && w <= 4000));
  }
  if (p.sort === null) out.sort = null;
  else if (p.sort && (p.sort.dir === 1 || p.sort.dir === -1) && o.cols.some(c => c.k === p.sort.k)) out.sort = { k: p.sort.k, dir: p.sort.dir };
  if (PAGE_SIZES.includes(p.ps)) out.ps = p.ps;
  return out;
}

function savePrefs(key, st) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ colOrder: st.colOrder, colPx: st.widths, sort: st.sort, ps: st.ps }));
  } catch (_) { /* storage full or blocked — layout still works for this visit */ }
}

/**
 * Column widths in px in `cols` order, or `null` while the table is still
 * auto-sized. Columns without a saved width (new since the last save) get the
 * average of the saved ones.
 */
function resolveWidths(cols, st) {
  if (!st.widths) return null;
  const known = cols.filter(c => st.widths[c.k] > 0);
  if (!known.length) return null;
  const avg = known.reduce((s, c) => s + st.widths[c.k], 0) / known.length;
  return cols.map(c => (st.widths[c.k] > 0 ? st.widths[c.k] : avg));
}

/**
 * Inline styles for a resized table. Every column but the last gets its px
 * width; the last is left auto so, under `table-layout: fixed`, it absorbs
 * whatever the card has spare. The table is `max(100%, sum)` wide, so it
 * fills the card or overflows into the wrapper's horizontal scroll.
 */
function widthStyles(px) {
  const sum = px.reduce((a, b) => a + b, 0);
  return {
    table: `max(100%, ${Math.round(sum)}px)`,
    cols: px.map((w, i) => (i === px.length - 1 ? "" : `${Math.round(w)}px`)),
  };
}

/**
 * Drag (or arrow-key) the border on the right of a header to resize that
 * column only; the others keep their size and the table grows or shrinks.
 * The first resize snapshots the rendered widths and switches the table to
 * `table-layout: fixed`. Double-click resets to auto.
 */
function wireColumnResize(tbl, cols, st, redraw, save) {
  const colEls = [...tbl.querySelectorAll("colgroup col")];
  const ths = [...tbl.querySelectorAll("thead th")];
  if (!cols.length || colEls.length !== cols.length) return;
  const rendered = () => ths.map(th => th.getBoundingClientRect().width);
  const apply = px => {
    const s = widthStyles(px);
    tbl.classList.add("t--fixed");
    tbl.style.width = s.table;
    s.cols.forEach((w, i) => { colEls[i].style.width = w; });
    st.widths = Object.fromEntries(cols.map((c, i) => [c.k, Math.round(px[i])]));
  };
  const resize = (start, i, delta) => {
    const next = start.slice();
    next[i] = Math.max(MIN_COL_PX, start[i] + delta);
    return next;
  };
  ths.forEach((th, i) => {
    const h = th.querySelector(".col-rs");
    if (!h) return;
    h.addEventListener("click", e => e.stopPropagation());
    h.addEventListener("dblclick", e => {
      e.stopPropagation();
      st.widths = null;
      save();
      redraw();
    });
    h.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const start = rendered();
      apply(start);
      const x0 = e.clientX;
      tbl.classList.add("is-resizing");
      h.classList.add("on");
      try { h.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const onMove = ev => apply(resize(start, i, ev.clientX - x0));
      const onUp = () => {
        h.removeEventListener("pointermove", onMove);
        h.removeEventListener("pointerup", onUp);
        h.removeEventListener("pointercancel", onUp);
        tbl.classList.remove("is-resizing");
        h.classList.remove("on");
        save();
      };
      h.addEventListener("pointermove", onMove);
      h.addEventListener("pointerup", onUp);
      h.addEventListener("pointercancel", onUp);
    });
    h.addEventListener("keydown", e => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      const step = (e.shiftKey ? KEY_STEP_BIG_PX : KEY_STEP_PX) * (e.key === "ArrowLeft" ? -1 : 1);
      const next = resize(rendered(), i, step);
      apply(next);
      h.setAttribute("aria-valuenow", String(Math.round(next[i])));
      save();
    });
  });
}

// Person names and free-text identifiers read better as plain text than as pills.
const NO_BADGE_DIMS = new Set(["user", "manager"]);

/** True when a column should render as a pill badge (bools + categoricals, not ids/nums/names). */
function colUsesBadge(c) {
  if (c.bool) return true;
  if (c.badge === false) return false;
  if (c.badge) return true;
  if (c.num || c.bar) return false;
  if (c.dim && !NO_BADGE_DIMS.has(c.dim)) return true;
  return false;
}

/** Placeholder stand-ins ("(not informed)", "unknown", …) — never worth a colored pill. */
function isPlaceholderValue(v) {
  const s = String(v).trim().toLowerCase().replace(/^\(|\)$/g, "");
  return s === "" || s === "-" || s === "–" || s === "—" || s === "n/a" || s === "na"
    || s === "none" || s === "null" || s === "unknown" || s === "not informed";
}

/** HTML for one table cell value — badge for categoricals/bools, plain text otherwise. */
function formatTableCell(c, v) {
  if (c.bool) {
    const on = !!v;
    return `<span class="tbl-badge tbl-badge--${on ? "true" : "false"}"><span class="dot" aria-hidden="true"></span><span class="lbl">${on ? "true" : "false"}</span></span>`;
  }
  if (v == null || v === "") return `<span class="tbl-empty">—</span>`;
  const label = c.fmt ? c.fmt(v) : String(v);
  if (isPlaceholderValue(v)) return `<span class="tbl-empty">${esc(label)}</span>`;
  if (!colUsesBadge(c)) return esc(label);
  const accent = colorFor(c.dim || c.k, String(v));
  return `<span class="tbl-badge" style="--badge-accent:${accent}"><span class="dot" aria-hidden="true"></span><span class="lbl">${esc(label)}</span></span>`;
}
/** Persist + reconcile column order for drag-reorder across redraws. */
function resolveTableCols(o, st) {
  if (!Array.isArray(st.colOrder) || !st.colOrder.length) st.colOrder = o.cols.map(c => c.k);
  const byK = new Map(o.cols.map(c => [c.k, c]));
  const ordered = [];
  for (const k of st.colOrder) {
    const c = byK.get(k);
    if (c) { ordered.push(c); byK.delete(k); }
  }
  for (const c of o.cols) if (byK.has(c.k)) ordered.push(c);
  st.colOrder = ordered.map(c => c.k);
  return ordered;
}
/**
 * Column reorder via grip drag — floating ghost + drop bars + dimmed source column.
 * Sort clicks stay on the label area; only the grip starts a drag.
 */
function wireColumnReorder(tbl, cols, st, redraw, save) {
  if (cols.length < 2) return;
  const theadRow = tbl.querySelector("thead tr");
  if (!theadRow) return;
  let drag = null;
  const clearDrop = () => {
    tbl.querySelectorAll(".col-drop-before, .col-drop-after, .col-src").forEach(n => {
      n.classList.remove("col-drop-before", "col-drop-after", "col-src");
    });
  };
  const endDrag = () => {
    if (!drag) return;
    drag.ghost?.remove();
    window.removeEventListener("pointermove", drag.onMove);
    window.removeEventListener("pointerup", drag.onUp);
    window.removeEventListener("pointercancel", drag.onUp);
    tbl.classList.remove("is-reordering");
    clearDrop();
    drag = null;
  };
  theadRow.querySelectorAll("th").forEach((th, fromIdx) => {
    const grip = th.querySelector(".col-grip");
    if (!grip) return;
    grip.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const label = th.querySelector(".col-label")?.textContent || th.dataset.k || "Column";
      const ghost = document.createElement("div");
      ghost.className = "col-drag-ghost";
      ghost.innerHTML = `<span class="g-grip" aria-hidden="true">⋮⋮</span><span>${esc(label)}</span>`;
      document.body.appendChild(ghost);
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      tbl.classList.add("is-reordering");
      tbl.querySelectorAll(`[data-ci="${fromIdx}"]`).forEach(n => n.classList.add("col-src"));
      try { grip.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const onMove = ev => {
        if (!drag) return;
        ghost.style.left = ev.clientX + "px";
        ghost.style.top = ev.clientY + "px";
        clearDrop();
        tbl.querySelectorAll(`[data-ci="${fromIdx}"]`).forEach(n => n.classList.add("col-src"));
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const over = el?.closest?.("th[data-ci]");
        if (!over || over === th) { drag.toIdx = fromIdx; drag.place = "same"; return; }
        const toIdx = +over.dataset.ci;
        const mid = over.getBoundingClientRect().left + over.getBoundingClientRect().width / 2;
        const place = ev.clientX < mid ? "before" : "after";
        over.classList.add(place === "before" ? "col-drop-before" : "col-drop-after");
        drag.toIdx = toIdx;
        drag.place = place;
      };
      const onUp = () => {
        if (!drag) return;
        const { toIdx, place } = drag;
        endDrag();
        if (place === "same" || toIdx == null || toIdx === fromIdx) return;
        let insertAt = place === "before" ? toIdx : toIdx + 1;
        if (fromIdx < insertAt) insertAt--;
        if (insertAt === fromIdx) return;
        const next = st.colOrder.slice();
        const [moved] = next.splice(fromIdx, 1);
        next.splice(insertAt, 0, moved);
        st.colOrder = next;
        save();
        redraw();
      };
      drag = { fromIdx, toIdx: fromIdx, place: "same", ghost, onMove, onUp };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  });
}
export function table(el, o) {
  // Shelve only dropdowns owned by this card so a redraw doesn't flash every menu on the page
  $$(".lb.open, .split-wrap.open", el).forEach(node => {
    if (node.classList.contains("lb")) {
      node.classList.remove("open");
      const btn = node.querySelector(".lb-btn");
      if (btn) btn.setAttribute("aria-expanded", "false");
      shelvePop(node, node._pop || node.querySelector(".dd-pop, .ms-pop"));
    } else {
      node.classList.remove("open");
      const caret = node.querySelector(".split-caret");
      if (caret) caret.setAttribute("aria-expanded", "false");
      shelvePop(node, node._pop || node.querySelector(".split-menu"));
    }
  });
  const enter = ANIM.enter;
  const pkey = prefsKey(o);
  if (!el.__st || el.__st.pkey !== pkey) {
    el.__st = { q: "", page: 0, sort: o.defaultSort || null, ps: o.pageSize ?? 25, qcol: "", colOrder: null, widths: null, pkey, ...loadPrefs(pkey, o) };
  }
  const st = el.__st;
  const save = () => savePrefs(pkey, st);
  const cols = resolveTableCols(o, st);
  const widths = resolveWidths(cols, st);
  // Cross-filtering rebuilds the table in place. Keep the rows where the user left
  // them: remember the scroll offsets, and skip the row-enter stagger on a rebuild
  // so a click doesn't replay the whole card as if it just mounted.
  const prevWrap = el.querySelector(".tbl-wrap");
  const prevScroll = prevWrap ? { top: prevWrap.scrollTop, left: prevWrap.scrollLeft } : null;
  const anim = ANIM.now && (enter || !prevWrap);
  // A background refresh must not steal the caret mid-search: remember where it
  // was (and any live text not yet flushed to st.q) before the rebuild.
  const focused = document.activeElement;
  const searchFocus = focused instanceof HTMLInputElement && focused.type === "search" && el.contains(focused)
    ? { start: focused.selectionStart, end: focused.selectionEnd, value: focused.value }
    : null;
  if (searchFocus && searchFocus.value !== st.q) st.q = searchFocus.value;
  el.innerHTML = "";
  const tools = document.createElement("div"); tools.className = "tbl-tools" + (enter && !REDUCED ? " tbl-tools--enter" : "");
  const searchable = cols.filter(c => !c.num);
  const allRows = o.rows;
  tools.innerHTML = `<span>Show</span><select class="ps" aria-label="Rows per page">${PAGE_SIZES.map(n => `<option value="${n}"${n === st.ps ? " selected" : ""}>${n || "All"}</option>`).join("")}</select><span>entries</span>
<select class="qcol" aria-label="Search column"><option value="">All columns</option>${searchable.map(c => `<option value="${c.k}"${c.k === st.qcol ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
<input type="search" name="table-search" aria-label="Search table records" autocomplete="off" placeholder="Search ${int(o.rows.length)} records…" value="${esc(st.q)}"><span class="sp"></span>
<div class="split-wrap"><div class="split"><button type="button" class="split-main csv-main" title="Download CSV">CSV</button><button type="button" class="split-caret icon-motion" aria-label="CSV options" aria-haspopup="listbox" aria-expanded="false"><span class="icon-motion-target icon-motion--nudge-down" aria-hidden="true">▾</span></button></div><div class="split-menu" role="listbox"><button type="button" role="option" data-scope="view"><span class="lbl">Export this view</span><span class="desc">Rows matching the current search and sort</span></button><button type="button" role="option" data-scope="all"><span class="lbl">Export all rows</span><span class="desc">Every row in this card, ignoring search</span></button></div></div>`;
  // Enhance before mount so the native <select> never paints (avoids flicker)
  const psSel = tools.querySelector(".ps");
  const qcolSel = tools.querySelector(".qcol");
  enhanceSelect(psSel, { compact: true, minWidth: 88 });
  enhanceSelect(qcolSel, { compact: true, minWidth: 140 });
  el.appendChild(tools);
  let rows = o.rows;
  if (st.q) { const q = st.q.toLowerCase(); const cs = st.qcol ? searchable.filter(c => c.k === st.qcol) : searchable; rows = rows.filter(r => cs.some(c => String(c.get(r) ?? "").toLowerCase().includes(q))); }
  if (st.sort) { const c = cols.find(c => c.k === st.sort.k); if (c) { const dir = st.sort.dir; rows = rows.slice().sort((a, b) => { const va = c.get(a), vb = c.get(b); if (va == null) return 1; if (vb == null) return -1; return (va < vb ? -1 : va > vb ? 1 : 0) * dir; }); } }
  const ps = st.ps || rows.length || 1; const pages = Math.max(1, Math.ceil(rows.length / ps)); if (st.page >= pages) st.page = pages - 1;
  const pageRows = rows.slice(st.page * ps, st.page * ps + ps);
  const max = {}; for (const c of cols) if (c.bar) max[c.k] = d3.max(rows, r => Math.abs(c.get(r) || 0)) || 1;
  const wrap = document.createElement("div"); wrap.className = "tbl-wrap"; if (o.maxH) wrap.style.maxHeight = o.maxH + "px";
  const sel = o.sel || new Set();
  const ws = widths ? widthStyles(widths) : null;
  const colgroup = `<colgroup>${cols.map((c, i) => `<col data-k="${c.k}"${ws?.cols[i] ? ` style="width:${ws.cols[i]}"` : ""}>`).join("")}</colgroup>`;
  let h = `<table class="t${anim ? " anim" : ""}${ws ? " t--fixed" : ""}"${ws ? ` style="width:${ws.table}"` : ""}>${colgroup}<thead><tr>${cols.map((c, i) => {
    const sortMotion = st.sort?.k === c.k ? (st.sort.dir > 0 ? "icon-motion--nudge-up" : "icon-motion--nudge-down") : "icon-motion--pulse";
    const sortGlyph = st.sort?.k === c.k ? (st.sort.dir > 0 ? "▲" : "▼") : "⇅";
    const resize = `<span class="col-rs" role="separator" aria-orientation="vertical" aria-label="Resize ${esc(c.label)} column" aria-valuemin="${MIN_COL_PX}"${widths ? ` aria-valuenow="${Math.round(widths[i])}"` : ""} tabindex="0" title="Drag to resize · double-click to reset"></span>`;
    return `<th class="${c.num ? "num" : ""} icon-motion" data-k="${c.k}" data-ci="${i}"><span class="col-grip icon-motion" title="Drag to reorder columns" aria-label="Drag to reorder ${esc(c.label)}" role="button" tabindex="0"><span class="icon-motion-target icon-motion--pulse" aria-hidden="true">⋮⋮</span></span><span class="col-label">${c.help ? `<span class="label-help" title="${esc(c.help)}">${esc(c.label)}</span>` : esc(c.label)}</span><span class="ar icon-motion-target ${sortMotion}" aria-hidden="true">${sortGlyph}</span>${resize}</th>`;
  }).join("")}</tr></thead><tbody>`;
  let ri = 0;
  for (const r of pageRows) {
    const key = o.key ? o.key(r) : null; const isSel = key != null && sel.has(key);
    h += `<tr class="${isSel ? "sel" : sel.size && o.fadeUnselected !== false ? "faded" : ""}"${anim ? ` style="animation-delay:${Math.min(ri, 24) * 22}ms"` : ""}>`; ri++;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const v = c.get(r);
      // Optional external link: c.href(row) → URL; opens in a new tab and never triggers cross-filtering.
      const url = c.href ? c.href(r) : null;
      const txt = url
        ? `<a class="tbl-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"${c.hrefTitle ? ` title="${esc(c.hrefTitle(r))}"` : ""}>${formatTableCell(c, v)}<span class="tbl-link-ic" aria-hidden="true">↗</span></a>`
        : formatTableCell(c, v);
      const bar = c.bar && v ? `<span class="barbg" style="width:${Math.min(100, Math.abs(v) / max[c.k] * 100)}%"></span>` : "";
      const tip = c.bool ? (v ? "true" : "false") : (c.fmt ? c.fmt(v) : (v ?? ""));
      const filterAttrs = c.dim
        ? `data-dim="${c.dim}" data-v="${esc(nv(v))}" role="button" tabindex="0" aria-label="Filter by ${esc(c.label)}: ${esc(tip)}"`
        : "";
      const title = c.dim ? `${tip} — click to filter` : tip;
      h += `<td class="${c.num ? "num" : ""}${c.dim ? " dim" : ""}" data-ci="${i}" ${filterAttrs} title="${esc(title)}">${bar}<span class="tv">${txt}</span></td>`;
    }
    h += `</tr>`;
  }
  if (!pageRows.length) h += `<tr><td colspan="${cols.length}"><div class="card-empty" style="min-height:120px;border:0">No records for the current filters</div></td></tr>`;
  h += `</tbody>`;
  if (o.summary) {
    const sm = typeof o.summary === "function" ? o.summary(rows) : o.summary; h += `<tfoot><tr>${cols.map((c, i) => {
      const raw = sm[c.k];
      let cell = "";
      if (i === 0) cell = "Summary";
      else if (raw != null) cell = c.bool ? formatTableCell(c, raw === true || raw === "true") : (colUsesBadge(c) ? formatTableCell(c, raw) : esc(c.fmt ? c.fmt(raw) : raw));
      return `<td class="${c.num ? "num" : ""}" data-ci="${i}">${cell}</td>`;
    }).join("")}</tr></tfoot>`;
  }
  h += `</table>`;
  wrap.innerHTML = h; el.appendChild(wrap);
  if (prevScroll) { wrap.scrollTop = prevScroll.top; wrap.scrollLeft = prevScroll.left; }
  const tbl = wrap.querySelector("table.t");
  // pager — ends stay clickable (idle-action feedback)
  if (pages > 1) {
    const pg = document.createElement("div"); pg.className = "pager";
    const btn = (lbl, p, on, edge) => {
      const isPrev = edge === "first", isNext = edge === "last";
      const motion = isPrev ? "icon-motion--nudge-left" : isNext ? "icon-motion--nudge-right" : "";
      const iconed = motion ? `<span class="icon-motion-target ${motion}" aria-hidden="true">${lbl}</span>` : lbl;
      return `<button type="button" data-p="${p}" data-edge="${edge || ""}" class="${on ? "on" : ""}${motion ? " icon-motion" : ""}">${iconed}</button>`;
    };
    let ph = `<span class="dash-num">${int(rows.length ? st.page * ps + 1 : 0)}–${int(Math.min(rows.length, st.page * ps + ps))} of ${int(rows.length)}</span>` + btn("‹", st.page - 1, false, "first");
    const set = new Set([0, pages - 1, st.page - 1, st.page, st.page + 1].filter(p => p >= 0 && p < pages)); let last = -1;
    for (const p of [...set].sort((a, b) => a - b)) { if (p - last > 1) ph += `<span>…</span>`; ph += btn(p + 1, p, p === st.page); last = p; }
    ph += btn("›", st.page + 1, false, "last");
    pg.innerHTML = ph; el.appendChild(pg);
    pg.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      const edge = b.dataset.edge;
      const target = +b.dataset.p;
      if (edge === "first" && st.page === 0) {
        feedbackClick(b, { canAct: false, blockedMessage: "Already on the first page." });
        return;
      }
      if (edge === "last" && st.page >= pages - 1) {
        feedbackClick(b, { canAct: false, blockedMessage: "Already on the last page." });
        return;
      }
      if (target < 0 || target >= pages) return;
      st.page = target; table(el, o);
    };
  }
  const redraw = () => table(el, o);
  psSel.onchange = e => { st.ps = +e.target.value; st.page = 0; save(); redraw(); };
  qcolSel.onchange = e => { st.qcol = e.target.value; st.page = 0; redraw(); };
  const si = tools.querySelector("input[type=search]");
  // Commit the query on every keystroke so a refresh mid-typing keeps the text;
  // only the redraw (filter + repaint) waits for the typing to settle.
  const runSearch = debounce(() => redraw(), SEARCH_DEBOUNCE_MS);
  si.oninput = e => { st.q = e.target.value; st.page = 0; runSearch(); };
  if (searchFocus) {
    si.focus({ preventScroll: true });
    const caret = searchFocus.start == null ? si.value.length : Math.min(searchFocus.start, si.value.length);
    const caretEnd = searchFocus.end == null ? caret : Math.min(searchFocus.end, si.value.length);
    try { si.setSelectionRange(caret, caretEnd); } catch (e) { /* unsupported */ }
  }
  // Split CSV: view vs all (idle when empty) — same portaled popover UI
  const splitWrap = tools.querySelector(".split-wrap");
  if(o.exportEnabled===false)splitWrap.style.display='none';
  const splitMenu = splitWrap.querySelector(".split-menu");
  const csvMain = splitWrap.querySelector(".csv-main");
  const csvCaret = splitWrap.querySelector(".split-caret");
  splitWrap._popHome = splitWrap;
  splitWrap._pop = splitMenu;
  splitMenu.classList.add("dd-pop");
  const exportRows = (scope) => {
    const target = scope === "all" ? allRows : rows;
    feedbackClick(csvMain, {
      canAct: target.length > 0,
      blockedMessage: scope === "all" ? "No rows to export in this card." : "No rows match the current search.",
      onAction: () => downloadCSV({ ...o, cols }, target),
    });
  };
  csvMain.onclick = () => exportRows(st.q ? "view" : "all");
  csvCaret.onclick = e => {
    e.stopPropagation();
    const open = !splitWrap.classList.contains("open");
    closeAllDropdowns();
    if (!open) return;
    splitWrap.classList.add("open");
    csvCaret.setAttribute("aria-expanded", "true");
    openPortaledPop(splitWrap, splitWrap.querySelector(".split"), splitMenu, { align: "right", minWidth: 240, width: 260, maxH: 220 });
  };
  splitMenu.querySelectorAll("[data-scope]").forEach(opt => {
    opt.onclick = e => { e.stopPropagation(); closeAllDropdowns(); exportRows(opt.dataset.scope); };
  });
  wrap.querySelectorAll("th").forEach(th => th.onclick = e => {
    if (e.target.closest(".col-grip, .col-rs")) return;
    const k = th.dataset.k; const c = cols.find(c => c.k === k);
    st.sort = st.sort?.k === k ? (st.sort.dir < 0 ? { k, dir: 1 } : null) : { k, dir: c.num ? -1 : 1 };
    save();
    redraw();
  });
  wrap.querySelectorAll("td.dim").forEach(td => {
    td.onclick = ev => (o.onDimensionClick||onDim)(td.dataset.dim, td.dataset.v, ev);
    td.onkeydown = ev => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      (o.onDimensionClick||onDim)(td.dataset.dim, td.dataset.v, ev);
    };
  });
  wireColumnReorder(tbl, cols, st, redraw, save);
  wireColumnResize(tbl, cols, st, redraw, save);
}
function downloadCSV(o, rows) {
  const q = v => { let s = v == null ? "" : String(v); if(typeof v === "string" && /^[\s]*[=+@-]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [o.cols.map(c => q(c.label)).join(",")].concat(rows.map(r => o.cols.map(c => q((c.exportGet || c.get)(r))).join(","))).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = (o.csv || "export") + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
