/** Bounded, server-configured chart agent endpoint for Node HTTP and Vite.
 * Host authenticates the route and supplies an approved system prompt/tools.
 */
export function createAnthropicHandler({
  system: SYSTEM,
  tools: TOOLS,
  maxMessages: MAX_MESSAGES = 24,
  maxBodyBytes: MAX_BODY_BYTES = 512 * 1024,
  fetchProvider = globalThis.fetch,
  timeoutMs = 60000,
}) {
  function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  }

  /** Read a JSON body, rejecting anything over MAX_BODY_BYTES. */
  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      // Keep draining instead of destroying the socket so the client still receives the 413.
      req.on("data", (c) => {
        if (tooLarge) return;
        size += c.length;
        if (size > MAX_BODY_BYTES) {
          tooLarge = true;
          chunks.length = 0;
          reject(Object.assign(new Error("Body too large"), { status: 413 }));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (tooLarge) return;
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          reject(
            Object.assign(new Error("Invalid JSON body"), { status: 400 }),
          );
        }
      });
      req.on("error", reject);
    });
  }

  /** Only alternating user/assistant turns from the client's own agent loop. */
  function validMessages(messages) {
    return (
      Array.isArray(messages) &&
      messages.length > 0 &&
      messages.length <= MAX_MESSAGES &&
      messages[0]?.role === "user" &&
      messages.every(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          (typeof m.content === "string" || Array.isArray(m.content)),
      )
    );
  }

  /**
   * Handle a request already matched by `isBoardAgentPath`.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {AgentConfig} cfg
   */
  async function handleBoardAgent(req, res, cfg) {
    if (req.method === "GET") {
      return sendJson(res, 200, {
        configured: Boolean(cfg.apiKey),
        model: cfg.model,
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return sendJson(res, 405, { error: "Method Not Allowed" });
    }
    if (!cfg.apiKey) {
      return sendJson(res, 503, {
        error:
          "Board agent is not configured. Set ANTHROPIC_API_KEY in the app env (see .env.example).",
        code: "AGENT_UNCONFIGURED",
      });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      if (e?.status === 413) res.setHeader("Connection", "close");
      return sendJson(res, e?.status || 400, {
        error: e?.message || "Bad request",
      });
    }
    if (!validMessages(body?.messages)) {
      return sendJson(res, 400, {
        error: `messages[] must be 1–${MAX_MESSAGES} user/assistant turns starting with user`,
      });
    }

    // Stop in the UI aborts the browser fetch; cancel the paid upstream call too.
    const upstreamAbort = new AbortController();
    const onClientGone = () => {
      if (!res.writableFinished) upstreamAbort.abort();
    };
    res.on("close", onClientGone);

    try {
      const upstream = await fetchProvider(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        signal: AbortSignal.any([
          upstreamAbort.signal,
          AbortSignal.timeout(timeoutMs),
        ]),
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": cfg.version,
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 4096,
          system: SYSTEM,
          tools: TOOLS,
          messages: body.messages,
          temperature: 0.2,
        }),
      });
      if (!upstream.ok)
        return sendJson(res, 502, {
          error: "Chart provider could not complete the request. Try again.",
          code: "UPSTREAM_ERROR",
        });
      const text = await upstream.text();
      if (text.length > 2_000_000)
        return sendJson(res, 502, {
          error: "Chart provider returned too much data.",
          code: "UPSTREAM_ERROR",
        });
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(text);
    } catch (e) {
      if (upstreamAbort.signal.aborted) return;
      sendJson(res, 502, {
        error: "Chart provider could not complete the request. Try again.",
        code: "UPSTREAM_ERROR",
      });
    } finally {
      res.off("close", onClientGone);
    }
  }

  return handleBoardAgent;
}
