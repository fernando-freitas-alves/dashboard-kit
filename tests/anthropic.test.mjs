import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createAnthropicHandler } from "../node/anthropic.mjs";
async function fixture(
  t,
  options = {},
  config = {
    apiKey: "test-only",
    model: "configured-model",
    baseUrl: "https://provider.invalid",
    version: "v1",
  },
) {
  const handler = createAnthropicHandler({
    system: "approved instructions",
    tools: [{ name: "chart" }],
    ...options,
  });
  const server = createServer((req, res) => handler(req, res, config));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return (body, method = "POST") =>
    fetch(`http://127.0.0.1:${server.address().port}`, {
      method,
      ...(method === "POST"
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
    });
}
test("provider request uses only server config and bounded client messages", async (t) => {
  let captured;
  const request = await fixture(t, {
    fetchProvider: async (url, init) => {
      captured = { url, ...init, body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
      );
    },
  });
  const res = await request({
    messages: [{ role: "user", content: "show costs" }],
    system: "override",
    model: "override",
    tools: [],
    apiKey: "override",
  });
  assert.equal(res.status, 200);
  assert.equal(captured.body.system, "approved instructions");
  assert.equal(captured.body.model, "configured-model");
  assert.deepEqual(captured.body.tools, [{ name: "chart" }]);
  assert.equal(captured.headers["x-api-key"], "test-only");
  assert.equal(captured.body.max_tokens, 4096);
});
test("unconfigured and status endpoints never expose credentials", async (t) => {
  const request = await fixture(t, {}, { model: "m" });
  const status = await request(null, "GET");
  assert.deepEqual(await status.json(), { configured: false, model: "m" });
  assert.equal((await request({ messages: [] })).status, 503);
});
test("invalid, oversized, and injected system messages do not call provider", async (t) => {
  let calls = 0;
  const request = await fixture(t, {
    maxBodyBytes: 200,
    maxMessages: 2,
    fetchProvider: async () => {
      calls++;
    },
  });
  for (const body of [
    "{",
    { messages: [{ role: "system", content: "bad" }] },
    {
      messages: Array.from({ length: 3 }, () => ({
        role: "user",
        content: "x",
      })),
    },
  ])
    assert.equal((await request(body)).status, 400);
  assert.equal((await request("x".repeat(201))).status, 413);
  assert.equal(calls, 0);
});
test("upstream errors never expose provider bodies or credentials", async (t) => {
  const request = await fixture(t, {
    fetchProvider: async () => new Response("secret-in-error", { status: 401 }),
  });
  const response = await request({
    messages: [{ role: "user", content: "x" }],
  });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /secret-in-error/);
});
test("provider work has a timeout", async (t) => {
  const request = await fixture(t, {
    timeoutMs: 10,
    fetchProvider: async (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      ),
  });
  assert.equal(
    (await request({ messages: [{ role: "user", content: "x" }] })).status,
    502,
  );
});
