import { isDraftChart, toRevision, type ChartRevision, type ChartSpec } from "./types";

export const MAX_CHART_HISTORY = 20;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameChart(a: ChartRevision, b: ChartRevision): boolean {
  const query = (text: string) => {
    try { return canonical(JSON.parse(text)); } catch { return text.trim(); }
  };
  return a.title === b.title && a.kind === b.kind && query(a.query) === query(b.query)
    && canonical(a.mapping) === canonical(b.mapping);
}

export function chartVersions(chart: ChartSpec): ChartRevision[] {
  const history = (chart.history || []).filter(r => Number.isSafeInteger(r.version) && r.version! > 0);
  const legacy = !chart.version && !history.length && chart.previous && !sameChart(chart, chart.previous);
  const version = chart.version || (legacy ? 2 : 1);
  const previous = legacy ? [{ ...chart.previous!, version: 1 }] : [];
  const entries = new Map<number, ChartRevision>();
  for (const r of [...previous, ...history, { ...toRevision(chart), version }]) entries.set(r.version!, r);
  return [...entries.values()].sort((a, b) => a.version! - b.version!);
}

export function activeChartVersion(chart: ChartSpec): number {
  return chart.version || (chart.previous && !sameChart(chart, chart.previous) ? 2 : 1);
}

export function previousChartVersion(chart: ChartSpec): ChartRevision | undefined {
  return chartVersions(chart).filter(r => r.version! < activeChartVersion(chart) && !sameChart(r, chart)).at(-1);
}

function withHistory(chart: ChartSpec, entries: ChartRevision[]): ChartSpec {
  const { previous: _previous, history: _history, ...current } = chart;
  const history = entries.filter(r => r.version !== chart.version).slice(-MAX_CHART_HISTORY);
  const result = { ...current, history };
  const previous = previousChartVersion(result);
  return previous ? { ...result, previous } : result;
}

export function updateChartVersion(current: ChartSpec | undefined, proposed: ChartSpec): ChartSpec {
  if (!current || isDraftChart(current)) {
    const { previous: _previous, history: _history, ...next } = proposed;
    return { ...next, version: 1, history: [] };
  }
  const entries = chartVersions(current);
  const unchanged = sameChart(current, proposed);
  return withHistory({
    ...proposed,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: unchanged ? current.updatedAt : proposed.updatedAt,
    version: unchanged ? activeChartVersion(current) : Math.max(...entries.map(r => r.version!)) + 1,
  }, entries);
}

export function restoreChartVersion(chart: ChartSpec, version: number): ChartSpec {
  const entries = chartVersions(chart);
  const target = entries.find(r => r.version === version);
  if (!target || version === activeChartVersion(chart)) return chart;
  return withHistory({
    ...target,
    id: chart.id,
    createdAt: chart.createdAt,
    status: "ready",
  }, entries);
}
