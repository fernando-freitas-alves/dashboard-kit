export interface ChartColorScale {
  colorFor(namespace: string, key: string): string;
  otherColor(): string;
}

export const GOOGLE_CHARTS_PALETTE = [
  "#3366CC", "#DC3912", "#FF9900", "#109618", "#990099", "#0099C6", "#DD4477",
  "#66AA00", "#B82E2E", "#316395", "#994499", "#22AA99", "#AAAA11", "#6633CC",
  "#E67300", "#8B0707", "#651067", "#329262", "#5574A6", "#3B3EAC",
];

export function createPalette(
  colors = ["#56b988", "#5daec5", "#a9bf6f", "#bd9c6c", "#9d91bf", "#75aaa2"],
  entries: Array<[string, string]> = [],
  other = "#a79e95",
): ChartColorScale {
  const palette = colors.length ? colors : ["#56b988"];
  const overrides = new Map(entries);
  const namespaces = new Map<string, Map<string, string>>();
  return {
    otherColor: () => other,
    colorFor: (namespace: string, key: string) => {
      if (overrides.has(key)) return overrides.get(key)!;
      if (key === "__other") return other;
      let map = namespaces.get(namespace);
      if (!map) {
        map = new Map();
        namespaces.set(namespace, map);
      }
      if (!map.has(key)) map.set(key, palette[map.size % palette.length]);
      return map.get(key)!;
    },
  };
}
