/**
 * dash-kit — stable categorical colours.
 *
 * Colours are assigned on first sight and remembered per namespace, so a squad
 * keeps the same colour as the user filters, sorts and switches tabs. The
 * namespace is usually the dimension name, which lets two charts of different
 * dimensions reuse the front of the palette instead of both drifting into its
 * muddy tail.
 */

let PALETTE = [
  "#3366CC", "#DC3912", "#FF9900", "#109618", "#990099", "#0099C6", "#DD4477",
  "#66AA00", "#B82E2E", "#316395", "#994499", "#22AA99", "#AAAA11", "#6633CC",
  "#E67300", "#8B0707", "#651067", "#329262", "#5574A6", "#3B3EAC",
];
let OTHER_COLOR = "#CCCCCC";

const colorMaps = {};
let overrides = new Map();
export function setCategoryOverrides(entries) { overrides = new Map(entries); }

/**
 * Swap in a dashboard's own colours. Call before the first render — existing
 * assignments are dropped so nothing keeps a colour from the old palette.
 *
 * @param {string[]} colors ordered categorical colours
 * @param {string} [other] colour for the rolled-up "everything else" series
 */
export function setPalette(colors, other) {
  if (Array.isArray(colors) && colors.length) PALETTE = colors.slice();
  if (other) OTHER_COLOR = other;
  for (const ns in colorMaps) delete colorMaps[ns];
}

/**
 * Colour for a value within a namespace, stable for the life of the page.
 * The reserved key `__other` always gets the roll-up colour.
 */
export function colorFor(ns, key) {
  if (overrides.has(key)) return overrides.get(key);
  if (key === "__other") return OTHER_COLOR;
  const m = colorMaps[ns] || (colorMaps[ns] = new Map());
  if (!m.has(key)) m.set(key, PALETTE[m.size % PALETTE.length]);
  return m.get(key);
}

/** The colour reserved for rolled-up remainders. */
export const otherColor = () => OTHER_COLOR;
