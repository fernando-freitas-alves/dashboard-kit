import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpAdapter } from "../frontend/src/http.ts";
test("HTTP adapter preserves scope, CSRF, revision and cancellation", async () => {
  const calls: any[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ rows: [{ value: 1 }], revision: 2 }));
  };
  const a = createHttpAdapter("/api/sales/1/boards/", {
    fetch: fetcher,
    headers: () => ({ "X-CSRF": "session-token" }),
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await a.query('{"metric":"sales"}', signal), [{ value: 1 }]);
  assert.equal(calls[0].url, "/api/sales/1/boards/query");
  assert.equal(calls[0].init.signal, signal);
  assert.equal(calls[0].init.headers.get("X-CSRF"), "session-token");
  assert.equal(calls[0].init.credentials, "same-origin");
  await a.saveBoard(
    "id/with/slash",
    { v: 2, name: "Board", widgets: [], layouts: [], updatedAt: 0 },
    7,
  );
  assert.match(calls[1].url, /id%2Fwith%2Fslash$/);
  assert.equal(JSON.parse(calls[1].init.body).revision, 7);
});
test("HTTP errors preserve actionable server feedback", async () => {
  const a = createHttpAdapter("/api", {
    fetch: async () =>
      new Response(JSON.stringify({ error: "Reload before saving." }), {
        status: 409,
      }),
  });
  await assert.rejects(a.loadWorkspace(), /Reload before saving/);
});
