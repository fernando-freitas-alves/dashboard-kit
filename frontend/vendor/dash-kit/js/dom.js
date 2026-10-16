/**
 * dash-kit — DOM and string helpers.
 *
 * Deliberately tiny: every other module in the kit depends on this one, so it
 * must stay free of any dashboard-specific assumption.
 */

/** First match, scoped to `root` (defaults to the document). */
export const $ = (s, r = document) => r.querySelector(s);

/** All matches as a real array, scoped to `root`. */
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** HTML-escape a value for interpolation into innerHTML. Null and undefined become "". */
export const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Trailing-edge debounce. The returned function keeps the last arguments. */
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * localStorage that never throws — private browsing and blocked storage are
 * normal, not exceptional. Read with one argument, write with two.
 */
export function store(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch (e) {
    return null;
  }
}
