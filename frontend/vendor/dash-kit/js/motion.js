import * as d3 from 'd3';
/**
 * dash-kit — the one place that decides whether anything animates.
 *
 * Two questions get asked constantly while rendering: *may* we animate (the
 * viewer's reduced-motion setting) and *should* we right now (a first mount
 * earns the full stagger; a filter update gets a quick cross-fade). Answering
 * them centrally is what keeps a re-render from replaying the whole page.
 */

import { $, $$ } from "./dom.js";

/** The viewer asked for less motion. Read once — the kit honours it everywhere. */
export const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Live animation gate, read by charts and tables mid-render.
 *
 * A plain mutable object rather than two exported bindings: importers can only
 * read an ES module binding, and the render loop needs to flip these per card.
 *
 * - `now` — animate this render at all
 * - `enter` — full entrance stagger (first mount) rather than a quick update
 * - `update` — cross-filter / filter-only redraw (opacity, not bar grow)
 */
export const ANIM = { now: false, enter: false, update: false };

/** Cards that earned an entrance animation on their next data render. */
export const PENDING_ANIM = new Set();

export const EASE_OUT = d3.easeCubicOut;
export const EASE_IO = d3.easeCubicInOut;

/** d3 transition with the kit's standard enter timing. */
export function tEnter(sel) {
  return sel.transition().duration(ANIM.enter ? 720 : 380).ease(EASE_OUT);
}

/** As `tEnter`, but only staggers on a true entrance — updates land together. */
export function tEnterDelay(sel, delayFn) {
  const t = sel.transition().duration(ANIM.enter ? 700 : 360).ease(EASE_OUT);
  return ANIM.enter ? t.delay(delayFn) : t.delay(0);
}

/** Cross-filter redraw — bar grow like load, but shorter than first mount. */
export function tFilterUpdate(sel) {
  return sel.transition().duration(520).ease(EASE_OUT);
}

// The card the user last touched — the thing that must not move when filters apply.
let lastInteractedCard = null;
if (typeof document !== "undefined") document.addEventListener("pointerdown", e => {
  lastInteractedCard = e.target?.closest?.("main .card") || null;
}, true);

/**
 * Run a re-render without the page jumping under the pointer.
 *
 * Applying a filter resizes the chips row and every chart above it, which would
 * otherwise slide the clicked row out from under the cursor. Pin the card the
 * user is working in (falling back to the topmost visible one) and correct the
 * scroll by its delta.
 *
 * Pair this with `overflow-anchor: none` on the scroll container — the browser's
 * own scroll anchoring will otherwise undo the correction a few frames later.
 */
export function withScrollAnchor(work) {
  let anchor = null;
  if (lastInteractedCard?.isConnected && lastInteractedCard.getBoundingClientRect().bottom > 0) {
    anchor = lastInteractedCard;
  } else {
    for (const card of $$("main .card")) {
      if (card.getBoundingClientRect().bottom > 0) { anchor = card; break; }
    }
  }
  const prevTop = anchor ? anchor.getBoundingClientRect().top : 0;
  work();
  if (!anchor || !anchor.isConnected) return;
  // Charts settle over a couple of frames, so correct again once layout is final.
  const fix = () => {
    if (!anchor.isConnected) return;
    const delta = anchor.getBoundingClientRect().top - prevTop;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  };
  fix();
  requestAnimationFrame(() => requestAnimationFrame(fix));
}

/** Back to the top of the dashboard — smooth unless the viewer opted out. */
export function scrollDashboardTop() {
  window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" });
  const main = $("main");
  if (main) main.scrollTop = 0;
}
