import type { BoardDocument, BoardRecord, ChartSpec, DashboardAdapter, Period, WorkspaceData } from '@loadsmart/dashboard-kit';
import rows from '../data/sales.json';

export const STORAGE_KEY = 'dashboard-kit-playground:v1';
export const starters = [
  { id: 'trend', title: 'Explore revenue trends by channel' },
  { id: 'channel', title: 'Compare orders by channel' },
  { id: 'region', title: 'Show revenue by region' },
  { id: 'map', title: 'Map revenue by country' },
];
const metrics = ['revenue', 'orders', 'tickets', 'satisfaction'] as const;
export const groups = ['date', 'month', 'channel', 'region', 'country', 'product', 'none'] as const;
export const kinds = ['bar', 'area', 'line', 'hbar', 'donut', 'map', 'kpi', 'table'];
export type Metric = typeof metrics[number];
export type Group = typeof groups[number];
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type State = { v: 1; boards: BoardRecord[]; archived: BoardRecord[]; preferences: WorkspaceData['preferences'] };

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid dashboard data.');
  return value as Record<string, any>;
}
function text(value: unknown, max: number, optional = false): string {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw Error('Invalid dashboard text.');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('Invalid dashboard number.');
  return value;
}
export function parseQuery(query: string): { metric: Metric; group: Group; series?: Group; period?: { from: number; to: number } } {
  try {
    if (typeof query !== 'string' || query.length > 500) throw Error();
    const q = object(JSON.parse(query));
    if (Object.keys(q).some(k => !['metric', 'group', 'series', 'period'].includes(k)) || !metrics.includes(q.metric) || !groups.includes(q.group)) throw Error();
    if ('series' in q && (!groups.includes(q.series) || q.series === 'none' || q.group === 'none' || q.series === q.group)) throw Error();
    if ('period' in q) {
      const p = object(q.period);
      if (Object.keys(p).sort().join(',') !== 'from,to' || !Number.isInteger(p.from) || !Number.isInteger(p.to) || p.from < 0 || p.to > 100000 || p.from >= p.to) throw Error();
    }
    return { metric: q.metric, group: q.group, ...(q.series ? { series: q.series } : {}), ...(q.period ? { period: { from: q.period.from, to: q.period.to } } : {}) };
  } catch { throw Error('Choose a supported measure and grouping.'); }
}
export function applyDemoFilters(query: string, { period }: { period: Period | null }) {
  const base = parseQuery(query);
  return JSON.stringify({ ...base, ...(period ? { period: { from: period.from, to: period.to } } : {}) });
}
export function queryRows(query: string) {
  const { metric, group, series, period } = parseQuery(query);
  const buckets = new Map<string, { label: string; series?: string; values: number[] }>();
  for (const row of rows) {
    const day = Date.parse(`${row.date}T00:00:00Z`) / 86400000;
    if (period && (day < period.from || day >= period.to)) continue;
    const label = group === 'none' ? 'Total' : row[group];
    const seriesLabel = series && series !== 'none' ? row[series] : undefined;
    const key = JSON.stringify([label, seriesLabel]);
    const bucket = buckets.get(key) ?? { label, ...(seriesLabel ? { series: seriesLabel } : {}), values: [] };
    bucket.values.push(row[metric]);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label) || (a.series ?? '').localeCompare(b.series ?? '')).map(({ values, ...dimensions }) => ({
    ...dimensions, value: Math.round(values.reduce((a, b) => a + b, 0) / (metric === 'satisfaction' ? values.length : 1) * 100) / 100,
  }));
}
export function chartMapping(kind: ChartSpec['kind'], series?: Group, group?: Group): ChartSpec['mapping'] {
  return kind === 'map'
    ? { region: 'label', value: 'value', scope: 'world' }
    : { x: 'label', y: 'value', label: 'label', value: 'value', ...(series ? { series: 'series' } : {}), ...(kind === 'area' ? { stacked: false } : {}), ...(['date', 'month'].includes(group ?? '') ? { timeUnit: group === 'month' ? 'month' : 'day' } as const : {}) };
}
function chart(title: string, kind: ChartSpec['kind'], metric: Metric, group: Group, id: string = crypto.randomUUID(), series?: Group): ChartSpec {
  if (kind === 'map') { group = 'country'; series = undefined; }
  return { id, title, prompt: title, kind, query: JSON.stringify({ metric, group, ...(series ? { series } : {}) }), mapping: chartMapping(kind, series, group), status: 'ready', createdAt: Date.now(), updatedAt: Date.now(), version: 1 };
}
export function defaultBoard(): BoardDocument {
  const widgets = [
    chart('Revenue', 'kpi', 'revenue', 'none', 'revenue'),
    chart('Orders', 'kpi', 'orders', 'none', 'orders'),
    chart('Customer satisfaction', 'kpi', 'satisfaction', 'none', 'satisfaction'),
    chart('Revenue by channel over time', 'area', 'revenue', 'date', 'trend', 'channel'),
    chart('Revenue by channel', 'donut', 'revenue', 'channel', 'channels'),
    chart('Revenue by region', 'hbar', 'revenue', 'region', 'regions'),
    chart('Revenue by country', 'map', 'revenue', 'country', 'countries'),
  ];
  const sizes = [[0, 0, 4, 4], [4, 0, 4, 4], [8, 0, 4, 4], [0, 4, 8, 8], [8, 4, 4, 8], [0, 12, 6, 10], [6, 12, 6, 10]];
  return { v: 2, name: 'Sales overview', widgets, layouts: widgets.map((w, i) => ({ i: w.id, x: sizes[i][0], y: sizes[i][1], w: sizes[i][2], h: sizes[i][3] })), locked: false, updatedAt: Date.now() };
}
function revision(raw: unknown): NonNullable<ChartSpec['history']>[number] {
  const r = object(raw);
  if (!kinds.includes(r.kind)) throw Error('Unsupported chart type for this demo.');
  const query = parseQuery(r.query);
  const mapping = { ...object(r.mapping) };
  if (Object.entries(mapping).some(([k, v]) => k === 'scope' ? v !== 'world' : k === 'stacked' ? typeof v !== 'boolean' : k === 'timeUnit' ? !['day', 'week', 'month'].includes(v as string) : !['x', 'y', 'label', 'value', 'series', 'region'].includes(k) || !['label', 'value', 'series'].includes(v as string))) throw Error('Invalid chart fields.');
  if (!mapping.timeUnit && ['bar', 'area', 'line'].includes(r.kind) && query.group === 'month') mapping.timeUnit = 'month';
  return { title: text(r.title, 160), prompt: text(r.prompt || '', 2000, true), kind: r.kind, query: r.query, mapping: { ...mapping }, updatedAt: number(r.updatedAt), version: number(r.version ?? 1) };
}
function validateChart(raw: unknown): ChartSpec {
  const w = object(raw);
  const id = text(w.id, 100), createdAt = number(w.createdAt);
  if (w.status === 'draft') {
    if (w.query || Object.keys(object(w.mapping)).length || w.previous || w.history?.length) throw Error('A draft cannot contain a query or previous results.');
    return { id, createdAt, updatedAt: createdAt, title: text(w.title, 160), prompt: text(w.prompt || '', 2000, true), status: 'draft', kind: 'bar', query: '', mapping: {} };
  }
  if (!Array.isArray(w.history || []) || (w.history || []).length > 20) throw Error('Invalid chart history.');
  return { ...revision(w), id, createdAt, status: 'ready', history: (w.history || []).map(revision), ...(w.previous ? { previous: revision(w.previous) } : {}) };
}
export function validateBoard(raw: unknown): BoardDocument {
  const b = object(raw);
  if (b.v !== 2 || !Array.isArray(b.widgets) || b.widgets.length > 60 || !Array.isArray(b.layouts) || b.layouts.length !== b.widgets.length) throw Error('Provide a board with at most 60 charts and one layout per chart.');
  if (b.locked !== undefined && typeof b.locked !== 'boolean') throw Error('Invalid board lock.');
  const widgets = b.widgets.map(validateChart), ids = new Set(widgets.map(w => w.id)), seen = new Set();
  if (ids.size !== widgets.length) throw Error('Each chart needs a unique ID.');
  const layouts = b.layouts.map((raw: unknown) => {
    const l = object(raw);
    if (!ids.has(l.i) || seen.has(l.i) || ![l.x, l.y, l.w, l.h].every(Number.isInteger) || ![3, 4, 6, 8, 12].includes(l.w) || ![4, 6, 8, 10, 12, 14, 16].includes(l.h) || l.x < 0 || l.x + l.w > 12 || l.y < 0 || l.y > 10000) throw Error('Choose a supported chart size and position.');
    seen.add(l.i);
    return { i: l.i, x: l.x, y: l.y, w: l.w, h: l.h, minW: 3, minH: 4 };
  });
  return { v: 2, name: text(b.name, 80).trim(), locked: b.locked ?? false, updatedAt: number(b.updatedAt), widgets, layouts };
}
export function createBrowserAdapter(storage: Storage = localStorage): DashboardAdapter {
  function read(): State {
    let raw: string | null;
    try { raw = storage.getItem(STORAGE_KEY); } catch { throw Error('Browser storage is unavailable. Allow site storage to save boards.'); }
    if (!raw) return { v: 1, boards: [], archived: [], preferences: {} };
    try {
      if (raw.length > 2_000_000) throw Error();
      const s = object(JSON.parse(raw));
      if (s.v !== 1 || !Array.isArray(s.boards) || !Array.isArray(s.archived)) throw Error();
      const record = (raw: unknown): BoardRecord => { const r = object(raw); return { id: text(r.id, 100), revision: number(r.revision), definition: validateBoard(r.definition) }; };
      const preferences = object(s.preferences);
      return { v: 1, boards: s.boards.map(record), archived: s.archived.map(record), preferences: { order: Array.isArray(preferences.order) ? preferences.order.filter((s: unknown) => typeof s === 'string') : [], active: typeof preferences.active === 'string' ? preferences.active : undefined } };
    } catch { throw Error('Saved demo data is invalid. Clear this site\'s storage to start again.'); }
  }
  function write(state: State) {
    const json = JSON.stringify(state);
    if (json.length > 2_000_000) throw Error('Demo storage is full. Export a board and remove unused charts.');
    try { storage.setItem(STORAGE_KEY, json); } catch { throw Error('Could not save in this browser. Free some site storage and retry.'); }
  }
  function find(records: BoardRecord[], id: string, revision: number) {
    const record = records.find(b => b.id === id);
    if (!record) throw Error('Board not found. Reload the page.');
    if (record.revision !== revision) throw Error('This board changed in another tab. Reload before saving.');
    return record;
  }
  return {
    applyFilters: applyDemoFilters,
    async loadWorkspace() { const s = read(); return { ...s, default: defaultBoard(), ai: false }; },
    async createBoard(definition) {
      const s = read();
      if (s.boards.length + s.archived.length >= 30) throw Error('This demo supports up to 30 boards.');
      const record = { id: crypto.randomUUID(), revision: 1, definition: validateBoard(definition) };
      s.boards.push(record); write(s); return structuredClone(record);
    },
    async saveBoard(id, definition, revision) {
      const s = read(), record = find(s.boards, id, revision);
      record.definition = validateBoard(definition); record.revision++; write(s); return { revision: record.revision };
    },
    async archiveBoard(id, revision, archived) {
      const s = read(), from = archived ? s.boards : s.archived, to = archived ? s.archived : s.boards;
      const record = find(from, id, revision); record.revision++;
      from.splice(from.indexOf(record), 1); to.push(record); write(s); return { revision: record.revision };
    },
    async savePreferences(preferences) { const s = read(); s.preferences = structuredClone(preferences); write(s); },
    async query(query, signal) { signal.throwIfAborted(); return queryRows(query); },
    async compose(input, signal) {
      signal.throwIfAborted();
      const recipe = input.recipe || starters.find(s => s.title.toLowerCase() === input.prompt.trim().toLowerCase())?.id;
      const specs = { trend: ['Revenue by channel over time', 'area', 'revenue', 'date'], channel: ['Orders by channel', 'bar', 'orders', 'channel'], region: ['Revenue by region', 'hbar', 'revenue', 'region'], map: ['Revenue by country', 'map', 'revenue', 'country'] } as const;
      const spec = specs[recipe as keyof typeof specs];
      if (!spec) throw Error('Live AI requires the Python demo. Pick a starter or use Choose fields here.');
      const widget = chart(spec[0], spec[1], spec[2], spec[3], input.current?.id, recipe === 'trend' ? 'channel' : undefined);
      widget.prompt = input.prompt;
      widget.trace = { source: 'recipe', prompt: input.prompt, status: 'done', startedAt: Date.now(), finishedAt: Date.now(), steps: [{ type: 'text', text: 'Created from a fixed starter using fictional data. No AI service was called.' }] };
      return { widget };
    },
    async importDefinition(raw) { return validateBoard(raw); },
  };
}
