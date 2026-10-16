import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";

export type GeoScope = "world" | "usa";
export type GeoFeature = Feature<Geometry, { name: string }>;

const cache: Partial<Record<GeoScope, Promise<GeoFeature[]>>> = {};

/**
 * Country (Natural Earth 110m) or US-state boundaries, fetched and decoded on
 * first use only, so pages without a map tile never download them.
 */
export function loadGeo(scope: GeoScope): Promise<GeoFeature[]> {
  cache[scope] ??= (async () => {
    const { worldUrl, usUrl } = await import("./geoAssets");
    const [{ feature }, topo] = await Promise.all([
      import("topojson-client"),
      fetch(scope === "usa" ? usUrl : worldUrl).then((r) => {
        if (!r.ok) throw new Error(`Map shapes failed to load (${r.status}).`);
        return r.json() as Promise<Topology>;
      }),
    ]);
    const obj = topo.objects[scope === "usa" ? "states" : "countries"];
    const fc = feature(topo, obj as GeometryCollection) as FeatureCollection<
      Geometry,
      { name: string }
    >;
    // Antarctica eats a third of a world map and never carries usage data.
    return fc.features.filter((f) => f.id !== "010");
  })().catch((e) => {
    delete cache[scope];
    throw e;
  });
  return cache[scope]!;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const US_STATES: [string, string][] = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
  ["PR", "Puerto Rico"],
];

/** ISO alpha-2, alpha-3 → Natural Earth name, for countries we're likely to see. */
const COUNTRIES: [string, string, string][] = [
  ["US", "USA", "United States of America"],
  ["CA", "CAN", "Canada"],
  ["MX", "MEX", "Mexico"],
  ["BR", "BRA", "Brazil"],
  ["AR", "ARG", "Argentina"],
  ["CL", "CHL", "Chile"],
  ["CO", "COL", "Colombia"],
  ["PE", "PER", "Peru"],
  ["UY", "URY", "Uruguay"],
  ["PY", "PRY", "Paraguay"],
  ["BO", "BOL", "Bolivia"],
  ["EC", "ECU", "Ecuador"],
  ["VE", "VEN", "Venezuela"],
  ["CR", "CRI", "Costa Rica"],
  ["PA", "PAN", "Panama"],
  ["GT", "GTM", "Guatemala"],
  ["DO", "DOM", "Dominican Rep."],
  ["CU", "CUB", "Cuba"],
  ["GB", "GBR", "United Kingdom"],
  ["IE", "IRL", "Ireland"],
  ["FR", "FRA", "France"],
  ["DE", "DEU", "Germany"],
  ["ES", "ESP", "Spain"],
  ["PT", "PRT", "Portugal"],
  ["IT", "ITA", "Italy"],
  ["NL", "NLD", "Netherlands"],
  ["BE", "BEL", "Belgium"],
  ["CH", "CHE", "Switzerland"],
  ["AT", "AUT", "Austria"],
  ["SE", "SWE", "Sweden"],
  ["NO", "NOR", "Norway"],
  ["DK", "DNK", "Denmark"],
  ["FI", "FIN", "Finland"],
  ["PL", "POL", "Poland"],
  ["CZ", "CZE", "Czechia"],
  ["RO", "ROU", "Romania"],
  ["HU", "HUN", "Hungary"],
  ["GR", "GRC", "Greece"],
  ["UA", "UKR", "Ukraine"],
  ["RU", "RUS", "Russia"],
  ["TR", "TUR", "Turkey"],
  ["IL", "ISR", "Israel"],
  ["AE", "ARE", "United Arab Emirates"],
  ["SA", "SAU", "Saudi Arabia"],
  ["EG", "EGY", "Egypt"],
  ["ZA", "ZAF", "South Africa"],
  ["NG", "NGA", "Nigeria"],
  ["KE", "KEN", "Kenya"],
  ["MA", "MAR", "Morocco"],
  ["IN", "IND", "India"],
  ["PK", "PAK", "Pakistan"],
  ["CN", "CHN", "China"],
  ["JP", "JPN", "Japan"],
  ["KR", "KOR", "South Korea"],
  ["TW", "TWN", "Taiwan"],
  ["PH", "PHL", "Philippines"],
  ["VN", "VNM", "Vietnam"],
  ["TH", "THA", "Thailand"],
  ["ID", "IDN", "Indonesia"],
  ["MY", "MYS", "Malaysia"],
  ["AU", "AUS", "Australia"],
  ["NZ", "NZL", "New Zealand"],
];

const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "United States of America",
  america: "United States of America",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  england: "United Kingdom",
  brasil: "Brazil",
  "russian federation": "Russia",
  "korea republic of": "South Korea",
  "republic of korea": "South Korea",
  korea: "South Korea",
  "czech republic": "Czechia",
  "viet nam": "Vietnam",
  turkiye: "Turkey",
  "dominican republic": "Dominican Rep.",
  holland: "Netherlands",
  uae: "United Arab Emirates",
};

/**
 * Build a lookup from any accepted spelling of a region (name, ISO / postal
 * code, numeric id) to the boundary feature's `name`.
 */
export function regionIndex(
  scope: GeoScope,
  features: GeoFeature[],
): (value: unknown) => string | null {
  const byKey = new Map<string, string>();
  for (const f of features) {
    byKey.set(norm(f.properties.name), f.properties.name);
    if (f.id != null)
      byKey.set(`#${String(f.id).replace(/^0+/, "")}`, f.properties.name);
  }
  const alias = (key: string, name: string) => {
    const hit = byKey.get(norm(name));
    if (hit && !byKey.has(key)) byKey.set(key, hit);
  };
  if (scope === "usa") {
    for (const [code, name] of US_STATES) alias(norm(code), name);
  } else {
    for (const [a2, a3, name] of COUNTRIES) {
      alias(norm(a2), name);
      alias(norm(a3), name);
    }
    for (const [k, name] of Object.entries(COUNTRY_ALIASES)) alias(k, name);
  }
  return (value) => {
    if (value == null) return null;
    const s = String(value).trim();
    if (/^\d+$/.test(s)) return byKey.get(`#${s.replace(/^0+/, "")}`) ?? null;
    return byKey.get(norm(s)) ?? null;
  };
}

/** True when most non-empty values read as US state names or postal codes. */
export function looksLikeUsStates(values: unknown[]): boolean {
  const known = new Set(US_STATES.flatMap(([c, n]) => [norm(c), norm(n)]));
  const vals = values.map((v) => norm(String(v ?? ""))).filter(Boolean);
  if (!vals.length) return false;
  // "US" alone is a country; a column of 2-letter codes needs more than one state.
  const hits = vals.filter((v) => known.has(v) && v !== "us").length;
  return hits / vals.length >= 0.6;
}
