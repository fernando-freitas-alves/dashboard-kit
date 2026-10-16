/**
 * dash-kit — theme preference, applied with a circular wipe.
 *
 * Stores 'light' | 'dark' (absent means follow the OS) and drives the
 * `data-theme` attribute the token layer keys off. The toggle uses the View
 * Transitions API to wipe the new theme in from the button, and replays that
 * wipe once a week as a preview so the control stays discoverable.
 *
 * The page owns what a theme change means for its content: pass `onChange` to
 * re-render anything drawn with themed colours (charts, canvases).
 */

import { $ } from "./dom.js";
import { REDUCED } from "./motion.js";

/** Browser-UI colour per theme. Override via initThemeToggle({ metaColors }). */
let META_COLORS = { light: "#E6E9ED", dark: "#1D1D1C" };
let BUTTON_SELECTOR = "#themeBtn";
let META_SELECTOR = "#themeColor";

const THEME_KEY = "theme";
const THEME_PREVIEW_LAST_AT_KEY = "dash-kit-theme-hint-at";
const THEME_PREVIEW_REPLAY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const CIRCLE_VT_MS = 1400;
const ICON_SUN = `<svg class="card-nav-theme-icon card-nav-theme-icon--sun icon-motion-target icon-motion--pop" viewBox="0 0 256 256" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/></svg>`;
const ICON_MOON = `<svg class="card-nav-theme-icon card-nav-theme-icon--moon icon-motion-target icon-motion--pop" viewBox="0 0 256 256" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z"/></svg>`;
let themeVtInFlight = false;

/** @returns {'light'|'dark'|'system'} */
export function storedThemePreference() {
  try { const v = localStorage.getItem(THEME_KEY); return v === "light" || v === "dark" ? v : "system"; }
  catch (e) { return "system"; }
}
function systemTheme() { return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
export function resolveTheme(pref = storedThemePreference()) { return pref === "system" ? systemTheme() : pref; }
export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = $(META_SELECTOR);
  if (meta) meta.content = META_COLORS[theme] || META_COLORS.dark;
}
export function setThemePreference(pref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch (e) { /* session-only */ }
  applyTheme(resolveTheme(pref));
}
function shouldPlayThemePreview() {
  try {
    const raw = localStorage.getItem(THEME_PREVIEW_LAST_AT_KEY);
    if (raw == null) return true;
    const lastAt = Number(raw);
    if (!Number.isFinite(lastAt)) return true;
    return Date.now() - lastAt >= THEME_PREVIEW_REPLAY_AFTER_MS;
  } catch (e) { return true; }
}
function markThemePreviewSeen() {
  try { localStorage.setItem(THEME_PREVIEW_LAST_AT_KEY, String(Date.now())); } catch (e) { /* ignore */ }
}
function canUseCircleVt() {
  return typeof document.startViewTransition === "function" && !REDUCED;
}
function circleOrigin(originEl) {
  if (!(originEl instanceof Element)) return null;
  const rect = originEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (vw <= 0 || vh <= 0) return null;
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const xPct = (x / vw) * 100, yPct = (y / vh) * 100;
  const pxRadius = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y));
  const percentBasis = Math.hypot(vw, vh) / Math.SQRT2;
  return { xPct, yPct, rPct: (pxRadius / percentBasis) * 100 };
}
async function animateCircleReveal(transition, originEl) {
  await transition.ready;
  const origin = circleOrigin(originEl);
  if (!origin) { await transition.finished; return; }
  const { xPct, yPct, rPct } = origin;
  document.documentElement.animate(
    [
      { clipPath: `circle(0% at ${xPct}% ${yPct}%)` },
      { clipPath: `circle(4% at ${xPct}% ${yPct}%)`, offset: 0.12 },
      { clipPath: `circle(5% at ${xPct}% ${yPct}%)`, offset: 0.4 },
      { clipPath: `circle(${rPct}% at ${xPct}% ${yPct}%)` },
    ],
    { duration: CIRCLE_VT_MS, easing: "cubic-bezier(0.33, 0.05, 0.25, 1)", pseudoElement: "::view-transition-new(root)" },
  );
  await transition.finished;
}
async function transitionThemeWithCircle(originEl, nextTheme) {
  if (!(originEl instanceof Element) || !canUseCircleVt() || themeVtInFlight) {
    setThemePreference(nextTheme); return false;
  }
  themeVtInFlight = true;
  document.documentElement.classList.add("theme-vt-circle");
  try {
    const transition = document.startViewTransition(() => { setThemePreference(nextTheme); });
    await animateCircleReveal(transition, originEl);
    return true;
  } catch (e) {
    setThemePreference(nextTheme); return false;
  } finally {
    themeVtInFlight = false;
    document.documentElement.classList.remove("theme-vt-circle");
  }
}
async function previewOppositeTheme(originEl) {
  if (!(originEl instanceof Element) || !canUseCircleVt() || themeVtInFlight) return false;
  const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const opposite = current === "dark" ? "light" : "dark";
  themeVtInFlight = true;
  document.documentElement.classList.add("theme-vt-circle");
  try {
    const reveal = document.startViewTransition(() => { applyTheme(opposite); });
    await animateCircleReveal(reveal, originEl);
    await new Promise(r => setTimeout(r, 400));
    const restore = document.startViewTransition(() => { applyTheme(current); });
    await animateCircleReveal(restore, originEl);
    return true;
  } catch (e) {
    applyTheme(current); return false;
  } finally {
    themeVtInFlight = false;
    document.documentElement.classList.remove("theme-vt-circle");
  }
}
function syncThemeToggle() {
  const btn = $(BUTTON_SELECTOR); if (!btn) return;
  const cur = resolveTheme();
  const goingTo = cur === "dark" ? "light" : "dark";
  btn.innerHTML = goingTo === "light" ? ICON_SUN : ICON_MOON;
  btn.setAttribute("aria-label", `Switch to ${goingTo} theme`);
  btn.title = `Switch to ${goingTo} theme`;
}
export function initThemeToggle({ onChange = () => { }, buttonSelector, metaSelector, metaColors } = {}) {
  if (buttonSelector) BUTTON_SELECTOR = buttonSelector;
  if (metaSelector) META_SELECTOR = metaSelector;
  if (metaColors) META_COLORS = { ...META_COLORS, ...metaColors };
  applyTheme(resolveTheme());
  syncThemeToggle();
  const btn = $(BUTTON_SELECTOR);
  if (!btn) return;
  btn.onclick = async () => {
    const next = resolveTheme() === "dark" ? "light" : "dark";
    markThemePreviewSeen();
    await transitionThemeWithCircle(btn, next);
    syncThemeToggle();
    onChange(resolveTheme());
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (storedThemePreference() === "system") { applyTheme(systemTheme()); syncThemeToggle(); onChange(resolveTheme()); }
  });
  /* Auto circular preview on first pointer move (same discoverability as skill-ladder). */
  if (!shouldPlayThemePreview()) return;
  const onMove = async () => {
    window.removeEventListener("pointermove", onMove);
    const played = await previewOppositeTheme(btn);
    if (played) markThemePreviewSeen();
    else window.addEventListener("pointermove", onMove, { passive: true });
  };
  window.addEventListener("pointermove", onMove, { passive: true });
}
