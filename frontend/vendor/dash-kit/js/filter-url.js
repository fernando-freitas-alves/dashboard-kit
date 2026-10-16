/**
 * Shareable filter state ↔ URL ↔ browser history.
 *
 * Dashboards keep their own shape of state; this module only handles
 * serialize/hydrate, pushState/replaceState, and popstate replay without
 * forking history when the page is applying a replay.
 */

/**
 * @param {object} cfg
 * @param {() => string} cfg.serialize Return query string without leading `?`, or "" for defaults.
 * @param {(params: URLSearchParams) => void} cfg.hydrate Apply params to in-memory state (reset first in hydrate).
 * @param {() => void} [cfg.onReplay] DOM refresh after back/forward once hydrate ran.
 * @param {object} [cfg.historyState] Stored on each history entry (default `{ dashKitUrl: 1 }`).
 */
export function createFilterUrlSync(cfg) {
  let replayDepth = 0;

  function canonicalUrl() {
    const qs = cfg.serialize();
    return qs ? `${location.pathname}?${qs}` : location.pathname;
  }

  /** Push or replace the address bar from current state. No-op while replaying popstate. */
  function sync({ replace = false } = {}) {
    if (replayDepth > 0) return;
    const url = canonicalUrl();
    const current = location.pathname + location.search;
    if (url === current) return;
    const state = cfg.historyState ?? { dashKitUrl: 1 };
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
  }

  /** Read `location.search` into state. */
  function hydrate() {
    cfg.hydrate(new URLSearchParams(location.search));
  }

  /** Back/forward: hydrate then optional redraw. */
  function replay() {
    replayDepth++;
    try {
      cfg.hydrate(new URLSearchParams(location.search));
      cfg.onReplay?.();
    } finally {
      replayDepth--;
    }
  }

  /** @returns {() => void} remove listener */
  function installPopstate() {
    const handler = () => replay();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }

  return { sync, hydrate, replay, installPopstate, get isReplaying() { return replayDepth > 0; } };
}
