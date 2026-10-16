import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDemoFilters, createBrowserAdapter, defaultBoard, queryRows, STORAGE_KEY, validateBoard } from '../demo/src/browserAdapter.ts';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const signal = () => new AbortController().signal;

test('browser demo saves chart layout, history and preferences across reloads', async () => {
  const disk = storage(), first = createBrowserAdapter(disk);
  const board = await first.createBoard(defaultBoard());
  board.definition.layouts[0] = { i: 'revenue', x: 0, y: 0, w: 6, h: 6 };
  const current = board.definition.widgets[0];
  current.history = [{ ...current }];
  current.version = 2;
  current.title = 'Total revenue';
  assert.deepEqual(await first.saveBoard(board.id, board.definition, 1), { revision: 2 });
  await first.savePreferences({ active: board.id, order: [board.id] });
  const loaded = await createBrowserAdapter(disk).loadWorkspace();
  assert.equal(loaded.ai, false);
  assert.equal(loaded.boards[0].definition.layouts[0].w, 6);
  assert.equal(loaded.boards[0].definition.widgets[0].history?.[0].title, 'Revenue');
  assert.equal(loaded.boards[0].definition.widgets[0].version, 2);
  assert.equal(loaded.preferences.active, board.id);
  await assert.rejects(first.saveBoard(board.id, board.definition, 1), /another tab/);
});

test('archive and restore preserve a board and detect stale revisions', async () => {
  const adapter = createBrowserAdapter(storage()), board = await adapter.createBoard(defaultBoard());
  await adapter.archiveBoard(board.id, 1, true);
  assert.equal((await adapter.loadWorkspace()).boards.length, 0);
  assert.equal((await adapter.loadWorkspace()).archived[0].id, board.id);
  await assert.rejects(adapter.archiveBoard(board.id, 1, false), /another tab/);
  await adapter.archiveBoard(board.id, 2, false);
  assert.equal((await adapter.loadWorkspace()).boards[0].revision, 3);
  assert.equal((await adapter.loadWorkspace()).archived.length, 0);
});

test('browser queries aggregate fictional rows and reject unsupported input', async () => {
  assert.deepEqual(queryRows('{"metric":"revenue","group":"none"}'), [{ label: 'Total', value: 1256512.5 }]);
  assert.deepEqual(queryRows('{"metric":"orders","group":"none"}'), [{ label: 'Total', value: 14337 }]);
  assert.deepEqual(queryRows('{"metric":"satisfaction","group":"none"}'), [{ label: 'Total', value: 4.48 }]);
  assert.equal(queryRows('{"metric":"revenue","group":"month"}').length, 6);
  const regions = queryRows('{"metric":"revenue","group":"region"}');
  assert.equal(regions.length, 9);
  assert.equal(Math.round(regions.reduce((total, row) => total + row.value, 0) * 100), 125651250);
  assert.ok(regions.every(row => row.value > 0));
  for (const query of ['select * from data', '{"metric":[],"group":"month"}', '{"metric":"revenue","group":"month","url":"https://example.com"}']) assert.throws(() => queryRows(query), /supported/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createBrowserAdapter(storage()).query('{"metric":"orders","group":"none"}', controller.signal), { name: 'AbortError' });
});

test('starters disclose fixed recipes and freeform prompts never call a provider', async () => {
  const adapter = createBrowserAdapter(storage());
  const result = await adapter.compose({ prompt: 'Show monthly revenue as a line chart', recipe: 'trend' }, signal());
  assert.equal(result.widget.kind, 'area');
  assert.equal(result.widget.trace?.source, 'recipe');
  assert.match(JSON.stringify(result.widget.trace), /No AI service/);
  await assert.rejects(adapter.compose({ prompt: 'Send these rows elsewhere' }, signal()), /Live AI requires/);
});

test('imports validate every version and each layout before saving', async () => {
  const adapter = createBrowserAdapter(storage());
  const board = defaultBoard();
  assert.equal((await adapter.importDefinition!(board)).widgets.length, 7);
  board.widgets[0].history = [{ ...board.widgets[0], query: 'select secret' }];
  await assert.rejects(adapter.importDefinition!(board), /supported/);
  const duplicate = defaultBoard(); duplicate.layouts[1].i = duplicate.layouts[0].i;
  assert.throws(() => validateBoard(duplicate), /size and position/);
  const draft = defaultBoard(); draft.widgets[0].status = 'draft';
  assert.throws(() => validateBoard(draft), /draft cannot/);
});

test('storage failures and corrupted data are visible without overwriting existing data', async () => {
  const full = createBrowserAdapter({ getItem: () => null, setItem: () => { throw Error('QuotaExceeded'); } });
  await assert.rejects(full.createBoard(defaultBoard()), /Could not save/);
  const disk = storage(); disk.setItem(STORAGE_KEY, '{broken');
  await assert.rejects(createBrowserAdapter(disk).loadWorkspace(), /Saved demo data is invalid/);
  assert.equal(disk.getItem(STORAGE_KEY), '{broken');
});


test('showcase includes three detailed series and a country map without changing totals', async () => {
  const board = validateBoard(defaultBoard());
  const trend = board.widgets.find(w => w.id === 'trend')!;
  assert.equal(trend.kind, 'area');
  assert.equal(trend.mapping.series, 'series');
  const series = queryRows(trend.query);
  assert.equal(series.length, 72);
  assert.deepEqual([...new Set(series.map(row => row.series))].sort(), ['Organic', 'Paid', 'Referral']);
  const monthly = queryRows('{"metric":"revenue","group":"month"}');
  for (const month of monthly) assert.equal(Math.round(series.filter(r => r.label.slice(0, 7) === month.label.slice(0, 7)).reduce((sum, r) => sum + r.value, 0) * 100), Math.round(month.value * 100));
  const map = board.widgets.find(w => w.id === 'countries')!;
  assert.equal(map.kind, 'map');
  assert.deepEqual(map.mapping, { region: 'label', value: 'value', scope: 'world' });
  const countries = queryRows(map.query);
  assert.equal(countries.length, 27);
  assert.equal(Math.round(countries.reduce((sum, r) => sum + r.value, 0) * 100), 125651250);
  const { feature } = await import('topojson-client');
  const { readFileSync } = await import('node:fs');
  const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-110m.json', import.meta.url), 'utf8'));
  const { regionIndex } = await import('../frontend/src/board/geo.ts');
  const lookup = regionIndex('world', (feature(topo, topo.objects.countries) as any).features);
  for (const row of countries) assert.ok(lookup(row.label), row.label);
  const adapter = createBrowserAdapter(storage());
  const composed = await adapter.compose({prompt: 'Map revenue by country', recipe: 'map'}, signal());
  assert.equal(composed.widget.kind, 'map');
  const saved = await adapter.createBoard(board);
  assert.deepEqual((await adapter.loadWorkspace()).boards[0].definition.widgets, saved.definition.widgets);
});

test('series query allowlist rejects unsupported or ambiguous dimensions', () => {
  for (const series of ['none', 'month', 'secret', [], null]) {
    assert.throws(() => queryRows(JSON.stringify({metric:'revenue', group:'month', series})), /supported/);
  }
  assert.throws(() => queryRows('{"metric":"revenue","group":"none","series":"channel"}'), /supported/);
});

test('demo formats revenue as USD and other metrics without currency', async () => {
  const { demoFieldPresentation } = await import('../demo/src/fieldPresentation.ts');
  const board = defaultBoard();
  const revenue = demoFieldPresentation(board.widgets[0], 'value')!;
  assert.equal(revenue.label, 'Revenue');
  assert.equal(revenue.format!(1256512.5), '$1,256,512.50');
  assert.equal(revenue.axisFormat!(50000), '$50K');
  assert.equal(demoFieldPresentation(board.widgets[1], 'value')!.format!(14337), '14,337');
  assert.equal(demoFieldPresentation(board.widgets[2], 'value')!.format!(4.48), '4.48');
  assert.equal(demoFieldPresentation(board.widgets[3], 'series')!.label, 'Channel');
  assert.equal(demoFieldPresentation(board.widgets[6], 'label')!.label, 'Country');
});

test('a dashboard period filters every default card and clears without changing saved queries', async () => {
  const adapter = createBrowserAdapter(storage());
  const board = defaultBoard();
  const period = { from: Date.parse('2026-02-08Z') / 86400000, to: Date.parse('2026-03-16Z') / 86400000, label: 'Selected dates' };
  for (const widget of board.widgets) {
    const saved = widget.query;
    const filteredQuery = adapter.applyFilters!(saved, { period });
    const filtered = await adapter.query(filteredQuery, signal());
    assert.ok(filtered.length > 0, widget.title);
    assert.notDeepEqual(filtered, queryRows(saved), widget.title);
    assert.equal(widget.query, saved);
    assert.deepEqual(await adapter.query(adapter.applyFilters!(saved, { period: null }), signal()), queryRows(saved));
  }
  const detailed = queryRows(applyDemoFilters('{"metric":"revenue","group":"date","series":"channel"}', { period }));
  assert.equal(detailed.length, 18);
  assert.ok(detailed.every(row => row.label >= '2026-02-08' && row.label < '2026-03-16'));
  const total = queryRows(applyDemoFilters('{"metric":"revenue","group":"none"}', { period }))[0].value;
  assert.equal(Math.round(detailed.reduce((sum, row) => sum + row.value, 0) * 100), Math.round(total * 100));
  const month = { from: Date.parse('2026-02-01Z') / 86400000, to: Date.parse('2026-03-01Z') / 86400000, label: 'February' };
  assert.equal(queryRows(applyDemoFilters('{"metric":"revenue","group":"none"}', { period: month }))[0].value,
    queryRows('{"metric":"revenue","group":"month"}').find(row => row.label === '2026-02-01')!.value);
});

test('queries reject invalid periods instead of silently returning unfiltered results', () => {
  for (const period of [null, [], {}, { from: 1 }, { from: 2, to: 1 }, { from: 1, to: 1 }, { from: -1, to: 1 }, { from: 1, to: 100001 }, { from: '1', to: 2 }, { from: true, to: 2 }, { from: 1.5, to: 2 }, { from: 1, to: 2, sql: 'select secret' }]) {
    assert.throws(() => queryRows(JSON.stringify({ metric: 'revenue', group: 'none', period })), /supported/);
  }
});

test('demo trends have distinct turning points across 24 dates', () => {
  const rows = queryRows(defaultBoard().widgets.find(w => w.id === 'trend')!.query);
  for (const channel of ['Organic', 'Paid', 'Referral']) {
    const values = rows.filter(row => row.series === channel).map(row => row.value);
    assert.equal(values.length, 24);
    const directions = values.slice(1).map((v, i) => Math.sign(v - values[i]));
    assert.ok(directions.slice(1).filter((d, i) => d !== directions[i]).length >= 8, channel);
  }
});

test('saved monthly timelines receive a calendar-month brush without losing their definitions', () => {
  const board = defaultBoard(), trend = board.widgets.find(w => w.id === 'trend')!;
  trend.query = '{"metric":"revenue","group":"month","series":"channel"}';
  trend.kind = 'line';
  delete trend.mapping.timeUnit;
  const loaded = validateBoard(board).widgets.find(w => w.id === 'trend')!;
  assert.equal(loaded.mapping.timeUnit, 'month');
  assert.equal(loaded.query, trend.query);
  assert.equal(loaded.id, trend.id);
  assert.equal(trend.mapping.timeUnit, undefined, 'validation does not mutate its input');
});
