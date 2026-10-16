/**
 * dash-kit — dropdowns that escape their container.
 *
 * Every menu in the kit (filter multi-selects, table listboxes, split actions)
 * is portaled into `#dd-portal` on open and positioned against its trigger in
 * viewport coordinates. That is the only reliable way out of a scrolling
 * sidebar or a card with `overflow: hidden` — and it keeps the menu pinned to
 * its button rather than floating somewhere in the middle of the screen.
 *
 * The portal element is created on demand, so a page need not ship it.
 */

import { $, $$ } from "./dom.js";

/** Body portal for all dropdown menus — escapes overflow / transform clipping. */
/** The body-level container every portaled menu is moved into. Created on demand. */
export function ddPortal() {
  let p = $("#ldk-dd-portal");
  if (!p) { p = document.createElement("div"); p.id = "ldk-dd-portal"; p.className = "ldk-surface"; document.body.appendChild(p); }
  return p;
}
export function clearPopPos(pop) {
  if (!pop) return;
  pop.style.left = pop.style.top = pop.style.right = pop.style.bottom = pop.style.width = pop.style.maxHeight = pop.style.minWidth = "";
  pop.classList.remove("open", "dd-pop--above", "dd-pop--below", "dd-pop--settled");
}
/** Restore a portaled popover to its trigger home node. */
export function shelvePop(owner, pop) {
  if (!pop) return;
  clearPopPos(pop);
  const home = owner._popHome;
  if (home && pop.parentNode !== home) home.appendChild(pop);
}
/** Close every open dropdown (filters, listboxes, CSV split). */
export function closeAllDropdowns() {
  $$(".ms.open").forEach(ms => {
    ms.classList.remove("open");
    shelvePop(ms, ms._pop || ms.querySelector(".ms-pop"));
  });
  $$(".lb.open").forEach(lb => {
    lb.classList.remove("open");
    const btn = lb.querySelector(".lb-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
    shelvePop(lb, lb._pop || lb.querySelector(".dd-pop, .ms-pop"));
  });
  $$(".split-wrap.open").forEach(wrap => {
    wrap.classList.remove("open");
    const caret = wrap.querySelector(".split-caret");
    if (caret) caret.setAttribute("aria-expanded", "false");
    shelvePop(wrap, wrap._pop || wrap.querySelector(".split-menu"));
  });
}
/** Legacy alias kept for pages that still call the multi-select name. */
export const closeAllMs = closeAllDropdowns;
/**
 * Pin a dropdown to the viewport (fixed + portaled).
 * Always below the trigger, or above when there isn’t enough room below — never floating elsewhere.
 */
export function placeDdPop(trigger, pop, opts = {}) {
  if (!trigger || !pop) return;
  const r = trigger.getBoundingClientRect();
  const pad = 8;
  const gap = 4;
  const minUseful = 120;
  const maxHCap = opts.maxH || 320;
  const minW = opts.minWidth || 220;
  const preferW = opts.width != null ? opts.width : Math.max(r.width, minW);
  const width = Math.min(Math.max(preferW, minW), window.innerWidth - pad * 2);

  // Horizontal: stay under the button; only nudge to keep inside the viewport
  let left = opts.align === "right" ? r.right - width : r.left;
  left = Math.min(Math.max(left, pad), window.innerWidth - width - pad);

  const spaceBelow = window.innerHeight - pad - (r.bottom + gap);
  const spaceAbove = r.top - pad - gap;
  // Prefer below; flip above only when below is too tight and above has more room
  const placeAbove = spaceBelow < minUseful && spaceAbove > spaceBelow;
  const avail = Math.max(80, placeAbove ? spaceAbove : spaceBelow);

  pop.style.width = width + "px";
  if (opts.minWidth) pop.style.minWidth = Math.min(opts.minWidth, width) + "px";
  pop.style.left = left + "px";
  pop.style.right = "auto";
  pop.style.maxHeight = Math.min(maxHCap, avail) + "px";
  const wasOpen = pop.classList.contains("open");
  pop.classList.add("open");
  // First open animates; later placeDdPop calls (resize/scroll/refresh) only reposition
  pop.classList.toggle("dd-pop--settled", wasOpen);
  pop.classList.toggle("dd-pop--above", placeAbove);
  pop.classList.toggle("dd-pop--below", !placeAbove);

  // Always flush to the trigger edge — never float mid-viewport
  if (placeAbove) {
    pop.style.top = "auto";
    pop.style.bottom = (window.innerHeight - r.top + gap) + "px";
  } else {
    pop.style.bottom = "auto";
    pop.style.top = (r.bottom + gap) + "px";
  }
}
/** Move popover into #dd-portal and position it under the trigger. */
export function openPortaledPop(owner, trigger, pop, opts) {
  if (!owner._popHome) owner._popHome = pop.parentElement;
  owner._pop = pop;
  ddPortal().appendChild(pop);
  placeDdPop(trigger, pop, opts);
}
export function placeMsPop(ms) {
  const btn = ms.querySelector(".ms-btn");
  const pop = ms._pop || ms.querySelector(".ms-pop");
  if (!btn || !pop || !ms.classList.contains("open")) return;
  openPortaledPop(ms, btn, pop, { width: Math.max(btn.getBoundingClientRect().width + 60, 220), maxH: 320 });
}
/**
 * Replace a native &lt;select&gt; with the shared listbox UI (same as filter menus).
 * Keeps the select in the DOM (sr-only) so existing onchange wiring still works.
 */
export function enhanceSelect(selectEl, opts = {}) {
  if (!selectEl || selectEl.dataset.lb === "1") return selectEl.closest(".lb");
  selectEl.dataset.lb = "1";
  selectEl.classList.add("lb-native");
  selectEl.setAttribute("tabindex", "-1");
  selectEl.setAttribute("aria-hidden", "true");
  const wrap = document.createElement("div");
  wrap.className = "lb" + (opts.field ? " lb-field" : " lb-compact");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lb-btn icon-motion";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  if (selectEl.getAttribute("aria-label") || selectEl.title) {
    btn.setAttribute("aria-label", selectEl.getAttribute("aria-label") || selectEl.title);
  }
  const pop = document.createElement("div");
  pop.className = "dd-pop ms-pop";
  pop.setAttribute("role", "listbox");
  const list = document.createElement("div");
  list.className = "lb-list";
  pop.appendChild(list);
  const parent = selectEl.parentNode;
  parent.insertBefore(wrap, selectEl);
  wrap.appendChild(btn);
  wrap.appendChild(pop);
  wrap.appendChild(selectEl);
  wrap._popHome = wrap;
  wrap._pop = pop;
  const syncLabel = () => {
    const opt = selectEl.selectedOptions[0];
    btn.textContent = opt ? opt.textContent : (opts.placeholder || "Select…");
    wrap.classList.toggle("has", !!selectEl.value);
  };
  const renderOpts = () => {
    list.innerHTML = "";
    [...selectEl.options].forEach(o => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lb-opt";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", o.selected ? "true" : "false");
      b.dataset.value = o.value;
      b.textContent = o.textContent;
      b.onclick = e => {
        e.stopPropagation();
        if (selectEl.value !== o.value) {
          selectEl.value = o.value;
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        closeAllDropdowns();
        syncLabel();
      };
      list.appendChild(b);
    });
  };
  btn.onclick = e => {
    e.stopPropagation();
    const open = !wrap.classList.contains("open");
    closeAllDropdowns();
    if (!open) return;
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    renderOpts();
    openPortaledPop(wrap, btn, pop, {
      width: Math.max(btn.getBoundingClientRect().width, opts.minWidth || 140),
      minWidth: opts.minWidth || 140,
      align: opts.align || "left",
      maxH: 280,
    });
  };
  pop.onclick = e => e.stopPropagation();
  selectEl.addEventListener("change", syncLabel);
  syncLabel();
  return wrap;
}
