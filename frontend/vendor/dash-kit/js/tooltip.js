/**
 * dash-kit — the single hover tip.
 *
 * One element for the whole page, re-appended to <body> on every show. That
 * re-append is not redundant: painting order among equal-z siblings follows DOM
 * order, so being last is what keeps the tip above a card that was rendered
 * after it. The element is created on demand, so a page need not ship `#tip`.
 */

import { REDUCED } from "./motion.js";

let tip = null;
let tipHideT = 0;

function tipEl() {
  if (tip && tip.isConnected) return tip;
  tip = document.getElementById("ldk-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "ldk-tip";
    tip.className="ldk-surface ldk-popover";
    document.body.appendChild(tip);
  }
  return tip;
}

/**
 * Show the tip next to the pointer, flipping to the other side near an edge.
 * @param {{clientX?: number, clientY?: number}} ev pointer-like position
 * @param {string} html trusted markup — escape any value you interpolate
 */
export function showTip(ev, html) {
  const el = tipEl();
  clearTimeout(tipHideT);
  document.body.appendChild(el); // re-append → paint above later siblings
  el.innerHTML = html;
  el.style.display = "block";
  el.style.zIndex = String(2147483646);
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = (ev.clientX ?? 0) + 14, y = (ev.clientY ?? 0) + 14;
  if (x + w > innerWidth - 8) x = (ev.clientX ?? 0) - w - 14;
  if (y + h > innerHeight - 8) y = (ev.clientY ?? 0) - h - 14;
  el.style.left = Math.max(8, x) + "px";
  el.style.top = Math.max(8, y) + "px";
  if (!REDUCED) requestAnimationFrame(() => el.classList.add("on"));
  else el.classList.add("on");
}

/** Fade the tip out, then take it out of the layout once the fade is done. */
export function hideTip() {
  const el = tipEl();
  el.classList.remove("on");
  clearTimeout(tipHideT);
  tipHideT = setTimeout(() => {
    if (!el.classList.contains("on")) el.style.display = "none";
  }, REDUCED ? 0 : 180);
}

/** The live tip element, for callers that need to reposition it themselves. */
export const tipElement = () => tipEl();
