import type {
  DashboardAdapter,
  BoardRecord,
  BoardDocument,
  BoardIndex,
  WorkspaceData,
} from "./contracts";
export function createBoardStore(
  adapter: DashboardAdapter,
  onState: (state: { pending: number; error?: string }) => void,
) {
  let records = new Map<string, BoardRecord>(),
    archived: BoardRecord[] = [],
    index: BoardIndex;
  let workspace: WorkspaceData,
    initializing: Promise<BoardIndex> | undefined,
    pending = 0;
  const queues = new Map<string, Promise<void>>(),
    failures = new Map<string, Error>();
  const signal = () =>
    onState({ pending, error: [...failures.values()][0]?.message });
  async function loadBoardIndex() {
    if (initializing) return initializing;
    initializing = (async () => {
      workspace = await adapter.loadWorkspace();
      archived = workspace.archived;
      let boards = workspace.boards;
      if (!boards.length)
        boards = [await adapter.createBoard(workspace.default)];
      records = new Map(boards.map((b) => [b.id, b]));
      const order = workspace.preferences.order || [];
      boards.sort(
        (a, b) =>
          (order.includes(a.id) ? order.indexOf(a.id) : 999) -
          (order.includes(b.id) ? order.indexOf(b.id) : 999),
      );
      index = {
        v: 1,
        active: records.has(workspace.preferences.active || "")
          ? workspace.preferences.active!
          : boards[0].id,
        boards: boards.map((b) => ({
          id: b.id,
          name: b.definition.name,
          createdAt: Date.now(),
        })),
      };
      return index;
    })().catch((error) => {
      initializing = undefined;
      throw error;
    });
    return initializing;
  }
  async function saveBoard(id: string, document: BoardDocument) {
    const record = records.get(id);
    if (!record) throw Error("Board not found. Reload your workspace.");
    const snapshot = {
      ...structuredClone(document),
      name: index.boards.find((b) => b.id === id)?.name || document.name,
    };
    record.definition = snapshot;
    pending++;
    signal();
    const task = (queues.get(id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const result = await adapter.saveBoard(id, snapshot, record.revision);
        record.revision = result.revision;
        failures.delete(id);
      })
      .catch((error) => {
        failures.set(id, error);
        throw error;
      })
      .finally(() => {
        pending--;
        signal();
      });
    queues.set(id, task);
    return task;
  }
  async function flush() {
    await Promise.all(queues.values());
    if (failures.size) throw [...failures.values()][0];
  }
  async function saveBoardIndex(next: BoardIndex) {
    const prior = index;
    index = next;
    try {
      for (const b of next.boards) {
        const record = records.get(b.id);
        if (record && record.definition.name !== b.name)
          await saveBoard(b.id, { ...record.definition, name: b.name });
      }
      await adapter.savePreferences({
        order: next.boards.map((b) => b.id),
        active: next.active,
      });
    } catch (error) {
      index = prior;
      throw error;
    }
  }
  return {
    loadBoardIndex,
    saveBoard,
    saveBoardIndex,
    flush,
    get aiConfigured() {
      return Boolean(workspace?.ai);
    },
    archivedBoards: () => archived,
    async loadBoard(id: string) {
      await loadBoardIndex();
      const r = records.get(id);
      if (!r) throw Error("Board not found.");
      return structuredClone(r.definition);
    },
    async current() {
      await loadBoardIndex();
      return records.get(index.active)?.definition;
    },
    async createBoard(name: string, doc?: BoardDocument) {
      const definition = doc
        ? structuredClone(doc)
        : {
            v: 2 as const,
            name,
            widgets: [],
            layouts: [],
            updatedAt: Date.now(),
            locked: false,
          };
      definition.name = name;
      const r = await adapter.createBoard(definition);
      records.set(r.id, r);
      return r.id;
    },
    async retryBoards() {
      for (const id of [...failures.keys()])
        await saveBoard(id, records.get(id)!.definition);
    },
    async clearBoard(id: string) {
      await flush();
      const r = records.get(id);
      if (!r) return;
      const result = await adapter.archiveBoard(id, r.revision, true);
      archived.push({ ...r, revision: result.revision });
      records.delete(id);
    },
    async restoreBoard(id: string) {
      const r = archived.find((b) => b.id === id);
      if (!r) return;
      const result = await adapter.archiveBoard(id, r.revision, false);
      r.revision = result.revision;
      records.set(id, r);
      archived = archived.filter((b) => b.id !== id);
      return r;
    },
  };
}
