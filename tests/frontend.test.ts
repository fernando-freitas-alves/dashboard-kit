import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoardStore } from "../frontend/src/store.ts";
import { createPalette, GOOGLE_CHARTS_PALETTE } from "../frontend/src/palette.ts";
import { createQueryPool } from "../frontend/src/queryPool.ts";
import { orderedSeries } from "../frontend/src/board/seriesOrder.ts";
test("ordinal series keep their domain order regardless of counts", () => {
  const totals = new Map([
    ["Usually", 40],
    ["Rarely", 1],
    ["Sometimes", 10],
    ["Not observed", 100],
  ]);
  assert.deepEqual(
    orderedSeries(totals, ["Rarely", "Sometimes", "Usually", "Not observed"]),
    ["Rarely", "Sometimes", "Usually", "Not observed"],
  );
  assert.deepEqual(orderedSeries(totals), [
    "Not observed",
    "Usually",
    "Sometimes",
    "Rarely",
  ]);
});
const doc = (name = "Board") => ({
  v: 2 as const,
  name,
  widgets: [],
  layouts: [],
  updatedAt: 0,
});
function fixture() {
  let revision = 1;
  const saves: any[] = [];
  const adapter: any = {
    loadWorkspace: async () => ({
      boards: [{ id: "one", definition: doc(), revision }],
      archived: [],
      default: doc(),
      preferences: {},
      ai: true,
    }),
    createBoard: async (d: any) => ({
      id: crypto.randomUUID(),
      definition: d,
      revision: 1,
    }),
    saveBoard: async (id: string, d: any, r: number) => {
      assert.equal(r, revision);
      saves.push(structuredClone(d));
      return { revision: ++revision };
    },
    savePreferences: async () => {},
    archiveBoard: async () => ({ revision: ++revision }),
  };
  return { adapter, saves };
}
test("serialized saves preserve every edit and advance revisions", async () => {
  const { adapter, saves } = fixture();
  const store = createBoardStore(adapter, () => {});
  await store.loadBoardIndex();
  await Promise.all([
    store.saveBoard("one", { ...doc(), updatedAt: 1 }),
    store.saveBoard("one", { ...doc(), updatedAt: 2 }),
  ]);
  await store.flush();
  assert.deepEqual(
    saves.map((d) => d.updatedAt),
    [1, 2],
  );
  assert.equal((await store.current())!.updatedAt, 2);
});
test("stores cannot leak boards between workspaces", async () => {
  const a = fixture(),
    b = fixture();
  const sa = createBoardStore(a.adapter, () => {}),
    sb = createBoardStore(b.adapter, () => {});
  await Promise.all([sa.loadBoardIndex(), sb.loadBoardIndex()]);
  await sa.saveBoard("one", { ...doc(), updatedAt: 9 });
  assert.equal((await sb.current())!.updatedAt, 0);
  assert.equal(b.saves.length, 0);
});
test("failed writes block flush and can be retried", async () => {
  const { adapter } = fixture();
  const save = adapter.saveBoard;
  adapter.saveBoard = async () => {
    throw Error("Conflict");
  };
  const s = createBoardStore(adapter, () => {});
  await s.loadBoardIndex();
  await assert.rejects(s.saveBoard("one", doc()), /Conflict/);
  await assert.rejects(s.flush(), /Conflict/);
  adapter.saveBoard = save;
  await s.retryBoards();
  await s.flush();
});
test("archiving and restoring preserves the board", async () => {
  const { adapter } = fixture();
  const s = createBoardStore(adapter, () => {});
  await s.loadBoardIndex();
  await s.clearBoard("one");
  assert.equal(s.archivedBoards().length, 1);
  await s.restoreBoard("one");
  assert.equal((await s.loadBoard("one")).name, "Board");
});
test("palette state is per workspace and category overrides are exact", () => {
  const a = createPalette(["red"], [["NA", "gray"]]),
    b = createPalette(["blue"]);
  assert.equal(a.colorFor("rating", "NA"), "gray");
  assert.equal(a.colorFor("rating", "Yes"), "red");
  assert.equal(b.colorFor("rating", "Yes"), "blue");
  const google = createPalette(GOOGLE_CHARTS_PALETTE, [["Not observed", "#CCCCCC"]], "#CCCCCC");
  assert.equal(google.colorFor("rating", "Not observed"), "#CCCCCC");
  assert.equal(google.colorFor("rating", "Rarely"), "#3366CC");
  assert.equal(google.colorFor("rating", "Sometimes"), "#DC3912");
  assert.equal(google.colorFor("rating", "__other"), "#CCCCCC");
  assert.equal(google.otherColor(), "#CCCCCC");
  assert.equal(b.colorFor("rating", "__other"), "#a79e95");
});
test("20 simultaneous identical queries make one provider call", async () => {
  let calls = 0;
  const run = createQueryPool(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return [42];
  });
  const values = await Promise.all(
    Array.from({ length: 20 }, () => run("same", new AbortController().signal)),
  );
  assert.equal(calls, 1);
  assert.equal(values.length, 20);
  await run("same", new AbortController().signal);
  assert.equal(calls, 2);
});
test("cancelling one subscriber keeps the other alive", async () => {
  let upstream: AbortSignal;
  const run = createQueryPool(async (q, s) => {
    upstream = s;
    await new Promise((r) => setTimeout(r, 10));
    return 7;
  });
  const a = new AbortController(),
    b = new AbortController();
  const first = run("q", a.signal),
    second = run("q", b.signal);
  a.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(await second, 7);
});
test("query pool bounds concurrent work", async () => {
  let active = 0,
    max = 0;
  const run = createQueryPool(async () => {
    max = Math.max(max, ++active);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    return 1;
  }, 3);
  await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      run(String(i), new AbortController().signal),
    ),
  );
  assert.equal(max, 3);
});
test("cancelled queued query never reaches provider", async () => {
  const calls: string[] = [];
  const run = createQueryPool(async (q) => {
    calls.push(q);
    await new Promise((r) => setTimeout(r, 10));
    return 1;
  }, 1);
  const a = new AbortController(),
    b = new AbortController();
  const first = run("first", a.signal),
    second = run("cancelled", b.signal);
  b.abort();
  await assert.rejects(second, { name: "AbortError" });
  await first;
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls, ["first"]);
});
