import * as d3 from 'd3';
/**
 * dash-kit — number formatting shared by charts, tables and KPI tiles.
 *
 * Requires d3 on the page (the kit uses d3-format's SI notation).
 * All of these render "–" for missing values so a gap never reads as a zero.
 */

/** Compact notation for axes and dense tables: 1.23k, 4.5M, 6.7B. */
export const smart = v => {
  if (v == null || isNaN(v)) return "–";
  const a = Math.abs(v);
  if (a < 1000) return d3.format(",.4~r")(v);
  return d3.format(".3~s")(v).replace("G", "B");
};

/** Exact currency, two decimals — for single values a reader may want to copy. */
export const money = v => (v == null ? "–" : "$" + d3.format(",.2f")(v));

/** Compact currency for axes and bars, sign before the symbol: -$1.2k. */
export const moneyS = v => {
  const a = Math.abs(v);
  return (v < 0 ? "-$" : "$") + (a < 1000 ? d3.format(",.4~r")(a) : d3.format(".3~s")(a).replace("G", "B"));
};

/** One-decimal percentage from a 0–1 ratio. */
export const pct = v => (v == null || isNaN(v) ? "–" : d3.format(".1%")(v));

/** Thousands-separated integer. */
export const int = v => d3.format(",")(v);
