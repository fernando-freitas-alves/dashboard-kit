/**
 * dash-kit — the interaction patterns that make a dense dashboard feel alive.
 *
 * Four ideas, each small on its own:
 *  - a flash tip that explains why a click did nothing, instead of a dead button
 *  - icons that replay their hover motion on click, so a press is acknowledged
 *  - a busy veil that dims cards while keeping the last good view readable
 *  - dotted-underline help on card titles, explaining what a number means
 *
 * Nothing here knows about your data. Where a pattern needs to ask a question
 * about page state ('are any filters active?'), it takes a predicate.
 */

import { $, $$, esc } from "./dom.js";
import { REDUCED } from "./motion.js";
import { showTip, hideTip, tipElement } from "./tooltip.js";

let flashTipEl = null, flashTipTimer = 0;
/** Portaled flash tip anchored above a control (idle-action feedback). */
export function showFlashTip(anchor, message) {
  if (!flashTipEl) {
    flashTipEl = document.createElement("div");
    flashTipEl.className = "flash-tip";
    flashTipEl.setAttribute("role", "status");
    document.body.appendChild(flashTipEl);
  }
  (anchor.closest("dialog[open]")||document.body).appendChild(flashTipEl);
  flashTipEl.textContent = message;
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = flashTipEl.offsetWidth || 200;
    const left = Math.min(Math.max(r.left + r.width / 2, 12 + w / 2), window.innerWidth - 12 - w / 2);
    flashTipEl.style.top = `${r.top - 8}px`;
    flashTipEl.style.left = `${left}px`;
    flashTipEl.style.display = "block";
  };
  place();
  clearTimeout(flashTipTimer);
  flashTipTimer = setTimeout(() => { flashTipEl.style.display = "none"; }, 2200);
}
/**
 * Replay icon hover motion on click (skill-ladder icon-motion--click-flash).
 */
export function flashIconMotion(btn) {
  if (!btn || REDUCED) return;
  const host = btn.classList?.contains("icon-motion") ? btn : btn.closest?.(".icon-motion");
  if (!host) return;
  host.classList.remove("icon-motion--click-flash");
  void host.offsetWidth;
  host.classList.add("icon-motion--click-flash");
  clearTimeout(host._iconFlashT);
  host._iconFlashT = setTimeout(() => host.classList.remove("icon-motion--click-flash"), 450);
}
/** Delegate click-flash for every .icon-motion control (icons animate on hover and click). */
export function initIconMotionClicks() {
  document.addEventListener("pointerdown", e => {
    if (e.button != null && e.button !== 0) return;
    const host = e.target.closest?.(".icon-motion");
    if (!host || host.disabled) return;
    flashIconMotion(host);
  }, true);
}
/**
 * Idle-action feedback: keep control clickable; shake + tip when blocked.
 * @returns {boolean} true when the real action ran
 */
export function feedbackClick(btn, { canAct, busy = false, blockedMessage, busyMessage, onAction }) {
  flashIconMotion(btn);
  if (busy) {
    if (!REDUCED) { btn.classList.remove("btn-shake"); void btn.offsetWidth; btn.classList.add("btn-shake"); }
    showFlashTip(btn, busyMessage || blockedMessage);
    return false;
  }
  if (!canAct) {
    if (!REDUCED) { btn.classList.remove("btn-shake"); void btn.offsetWidth; btn.classList.add("btn-shake"); }
    showFlashTip(btn, blockedMessage);
    return false;
  }
  onAction();
  return true;
}
let DASH_BUSY = 0;
/** Extra check before the veil lets go of the refresh icon — set by configureBusy(). */
let isSourceLoading = () => false;

/** Tell the busy veil how to ask whether background loads are still running. */
export function configureBusy({ sourceLoading }) { if (sourceLoading) isSourceLoading = sourceLoading; }

/** True while any dash-kit work is holding the veil up. */
export function isDashboardBusy() { return DASH_BUSY > 0; }
let busyClearT = 0;
/**
 * Show/hide the updating veil on every chart/table card.
 * Keeps the last good view visible so refresh/filter work feels intentional.
 */
export function setDashboardBusy(on, label = "Updating…") {
  clearTimeout(busyClearT);
  if (on) {
    DASH_BUSY++;
    $$(".card[data-c]").forEach(card => {
      card.classList.add("is-busy");
      card.setAttribute("aria-busy", "true");
      const el = card.querySelector(".card-b");
      if (!el) return;
      let veil = el.querySelector(".card-busy");
      if (!veil) {
        veil = document.createElement("div");
        veil.className = "card-busy";
        veil.setAttribute("role", "status");
        veil.innerHTML = `<div class="card-busy-spin" aria-hidden="true"></div><span class="card-busy-label"></span>`;
        el.appendChild(veil);
      }
      const lbl = veil.querySelector(".card-busy-label");
      if (lbl) lbl.textContent = label;
    });
    const refresh = $("#refreshBtn");
    if (refresh) refresh.classList.add("icon-motion--busy");
  } else {
    DASH_BUSY = Math.max(0, DASH_BUSY - 1);
    if (DASH_BUSY > 0) return;
    $$(".card[data-c]").forEach(card => {
      card.classList.remove("is-busy");
      card.removeAttribute("aria-busy");
      card.querySelector(".card-busy")?.remove();
    });
    const refresh = $("#refreshBtn");
    if (refresh && !isSourceLoading()) {
      refresh.classList.remove("icon-motion--busy");
    }
  }
}
/** Run work under the busy veil; keep it up for a short minimum so fast filter updates still read. */
export function runWithBusy(work, label = "Updating…") {
  const t0 = performance.now();
  setDashboardBusy(true, label);
  const finish = () => {
    const wait = REDUCED ? 0 : Math.max(0, 240 - (performance.now() - t0));
    busyClearT = setTimeout(() => setDashboardBusy(false), wait);
  };
  requestAnimationFrame(() => {
    try { work(); } finally { finish(); }
  });
}
/**
 * Label-with-help: dotted underline on each card title, explaining the number
 * behind it on hover and focus.
 *
 * @param {Record<string,string>} helpByCard help text keyed by the card's data-c
 */
export function decorateCardTitles(helpByCard) {
  $$(".card[data-c]").forEach(card => {
    const c = card.dataset.c;
    const h3 = card.querySelector(".card-h h3");
    if (!h3 || h3.dataset.helped || !helpByCard[c]) return;
    h3.dataset.helped = "1";
    const text = h3.textContent;
    h3.textContent = "";
    const span = document.createElement("span");
    span.className = "label-help";
    span.textContent = text;
    span.tabIndex = 0;
    span.setAttribute("aria-describedby", `help-${c}`);
    span.onmouseenter = span.onfocus = () => {
      showTip({ clientX: span.getBoundingClientRect().left, clientY: span.getBoundingClientRect().bottom },
        `<div class="t">${esc(text)}</div><div>${esc(helpByCard[c])}</div>`);
      const tipEl = tipElement();
      const r = span.getBoundingClientRect();
      tipEl.style.left = Math.min(r.left, window.innerWidth - 340) + "px";
      tipEl.style.top = (r.bottom + 8) + "px";
    };
    span.onmouseleave = span.onblur = hideTip;
    h3.appendChild(span);
  });
}
