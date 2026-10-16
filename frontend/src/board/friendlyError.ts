/**
 * Turn agent / data-source / network failures into short copy anyone can act on.
 * Never surface raw HTTP bodies, JSON, or stack traces in the UI.
 */
export function friendlyBoardError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const blob = `${code} ${raw}`.toLowerCase();

  if (
    code === "AGENT_UNCONFIGURED" ||
    /not configured|api key.*(missing|not set)/i.test(raw)
  ) {
    return "Chart building isn’t set up yet. Ask an admin to add the AI API key.";
  }

  if (
    code === "AGENT_AUTH" ||
    /401|authentication_error|api key is invalid|invalid.*api.?key|unauthorized/i.test(
      blob,
    )
  ) {
    return "We couldn’t reach the AI service — the API key looks wrong or expired. Ask an admin to check it.";
  }

  if (
    code === "AGENT_FORBIDDEN" ||
    /\b403\b|forbidden|permission/i.test(blob)
  ) {
    return "You don’t have permission to build this chart right now.";
  }

  if (
    code === "AGENT_RATE" ||
    /\b429\b|rate.?limit|too many requests/i.test(blob)
  ) {
    return "The AI service is busy. Wait a moment and try again.";
  }

  if (
    /failed to fetch|networkerror|load failed|err_network|timed out|timeout/i.test(
      blob,
    )
  ) {
    return "Network problem — check your connection and try again.";
  }

  if (/exceeded tool-call|without finalizing/i.test(raw)) {
    return "Couldn’t finish building this chart. Try rephrasing your prompt.";
  }

  if (
    /only select|mutating query|trino|query execution failed|query/i.test(
      blob,
    ) &&
    /fail|error|denied|blocked/i.test(blob)
  ) {
    return "The data query didn’t work. Try a simpler prompt or a different time range.";
  }

  if (
    /board agent http|anthropic|authentication_error|request_id/i.test(blob)
  ) {
    return "Something went wrong talking to the AI. Try again in a moment.";
  }

  // Already short and free of JSON / codes — keep it.
  if (
    raw.length > 0 &&
    raw.length <= 140 &&
    !/[{}\[\]"]/.test(raw) &&
    !/\bhttps?:\/\//i.test(raw) &&
    !/\bHTTP\s+\d{3}\b/i.test(raw)
  ) {
    return raw;
  }

  return "Something went wrong with this chart. Try again or rephrase your prompt.";
}
