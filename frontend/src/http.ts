import type { DashboardAdapter, BoardDocument } from "./contracts";
/** Cookie authentication and CSRF headers are owned by the host. Never pass provider keys. */
export function createHttpAdapter(
  base: string,
  options: { headers?: () => HeadersInit; fetch?: typeof fetch } = {},
): DashboardAdapter {
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) => {
    const headers = new Headers(options.headers?.());
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await (options.fetch || fetch)(
      base.replace(/\/$/, "") + path,
      {
        method,
        credentials: "same-origin",
        headers,
        signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw Error(
        typeof data.error === "string"
          ? data.error
          : "Dashboard request failed. Try again.",
      );
    return data;
  };
  return {
    loadWorkspace: () => request("/workspace"),
    createBoard: (definition) => request("/boards", "POST", { definition }),
    saveBoard: (id, definition, revision) =>
      request("/boards/" + encodeURIComponent(id), "PUT", {
        definition,
        revision,
      }),
    archiveBoard: (id, revision, archived) =>
      request("/boards/" + encodeURIComponent(id) + "/archive", "POST", {
        revision,
        archived,
      }),
    savePreferences: async (preferences) => {
      await request("/preferences", "PUT", preferences);
    },
    query: async (query, signal) =>
      (await request("/query", "POST", { query }, signal)).rows,
    compose: (input, signal) => request("/compose", "POST", input, signal),
    importDefinition: async (definition) =>
      (await request("/import", "POST", { definition }))
        .definition as BoardDocument,
  };
}
