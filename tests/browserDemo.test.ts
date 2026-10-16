import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserAdapter, defaultBoard, queryRows, STORAGE_KEY, validateBoard } from '../demo/src/browserAdapter.ts';

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
  for (const query of ['select * from data', '{"metric":[],"group":"month"}', '{"metric":"revenue","group":"month","url":"https://example.com"}']) assert.throws(() => queryRows(query), /supported/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createBrowserAdapter(storage()).query('{"metric":"orders","group":"none"}', controller.signal), { name: 'AbortError' });
});

test('starters disclose fixed recipes and freeform prompts never call a provider', async () => {
  const adapter = createBrowserAdapter(storage());
  const result = await adapter.compose({ prompt: 'Show monthly revenue as a line chart', recipe: 'trend' }, signal());
  assert.equal(result.widget.kind, 'line');
  assert.equal(result.widget.trace?.source, 'recipe');
  assert.match(JSON.stringify(result.widget.trace), /No AI service/);
  await assert.rejects(adapter.compose({ prompt: 'Send these rows elsewhere' }, signal()), /Live AI requires/);
});

test('imports validate every version and each layout before saving', async () => {
  const adapter = createBrowserAdapter(storage());
  const board = defaultBoard();
  assert.equal((await adapter.importDefinition!(board)).widgets.length, 5);
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
