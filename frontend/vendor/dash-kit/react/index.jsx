/**
 * dash-kit/react — thin React bindings over the vanilla kit.
 *
 * The renderers in `../js/` own the DOM inside their container and are cheap to
 * re-run, so these components do the boring-and-correct thing: render an empty
 * host element and call the renderer from an effect whenever the options
 * change. No virtual-DOM diffing of chart internals, no second implementation
 * to keep in sync with the pages version.
 *
 * Requires d3 as a global (the kit reads `window.d3`) and the kit stylesheet:
 *
 *   import "dash-kit/dash-kit.css";
 *
 * See ../README.md for how to wire the path in a Vite app.
 */

import { useEffect, useRef } from "react";
import { barChart, donut } from "../js/charts.js";
import { table } from "../js/table.js";
import { initThemeToggle, resolveTheme } from "../js/theme.js";

/**
 * Run a kit renderer into a host div, re-running when `options` changes.
 *
 * `options` is compared by identity, so memoise it (`useMemo`) or build it from
 * state — passing a fresh object literal every render will redraw every render.
 */
export function useKitRenderer(render, options) {
  const host = useRef(null);
  useEffect(() => {
    if (host.current) render(host.current, options);
  }, [render, options]);
  return host;
}

/**
 * A chart card body. Takes the same options object as the vanilla `barChart`:
 * buckets, series, val(bucketIndex, seriesIndex), stacked, mode, sel, onBucket,
 * onSeries, onRange.
 */
export function BarChart({ options, className = "card-b chart" }) {
  const host = useKitRenderer(barChart, options);
  return <div className={className} ref={host} />;
}

/** A donut with its legend below, from the vanilla `donut` options. */
export function Donut({ options, className = "card-b chart" }) {
  const host = useKitRenderer(donut, options);
  return <div className={className} ref={host} />;
}

/**
 * The kit data table. Keeps its own search, sort, page and column order on the
 * host element, so a re-render from above does not reset what the user did.
 */
export function DataTable({ options, className = "card-b" }) {
  const host = useKitRenderer(table, options);
  return <div className={className} ref={host} />;
}

/**
 * The standard card frame. `help` adds the dotted-underline hover explanation
 * that `decorateCardTitles` applies on the pages side.
 */
export function Card({ id, title, actions, children, magic = true }) {
  return (
    <section className={`card${magic ? " magic-card" : ""}`} data-c={id}>
      <div className="card-h">
        <h3>{title}</h3>
        {actions ? <div className="fx">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Mount the theme toggle once and get the resolved theme back.
 *
 * The toggle itself is plain DOM (the circular wipe needs a real element to
 * originate from), so render a `<button id="themeBtn" class="card-nav-theme">`
 * and call this hook from the component that owns it.
 *
 * @param {() => void} [onChange] redraw hook — charts bake theme colours in
 */
export function useThemeToggle(onChange) {
  useEffect(() => {
    initThemeToggle({ onChange: () => onChange?.() });
  }, [onChange]);
  return resolveTheme();
}

export { useFilterUrlSync } from "./useFilterUrlSync.jsx";
export { createFilterUrlSync } from "../js/filter-url.js";
export { setPalette, colorFor } from "../js/palette.js";
export { configureTable } from "../js/table.js";
export { configureCharts } from "../js/charts.js";
export { configureBusy, runWithBusy } from "../js/patterns.js";
