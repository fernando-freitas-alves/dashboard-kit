import { useEffect, useRef, useState } from "react";
import { BoardTabs } from "./board/BoardTabs";
import { CustomBoard } from "./board/CustomBoard";
import { ChartTile } from "./board/ChartTile";
import { useDashboard } from "./runtime";
import type { BoardDocument, BoardIndex, ChartSpec } from "./board/types";
import { feedbackClick } from "../vendor/dash-kit/js/patterns.js";
const showFlashTip = (anchor: HTMLElement, message: string) =>
  feedbackClick(anchor, {
    canAct: false,
    blockedMessage: message,
    onAction: () => {},
  });
import type { BoardPeriod } from "./board/period";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Could not save. Try again.";
}
function download(doc: BoardDocument) {
  const safe = structuredClone(doc);
  safe.widgets.forEach((w) => {
    delete w.trace;
    delete w.previous;
  });
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { format: "loadsmart-dashboard", version: 1, definition: safe },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.name.replace(/[^a-z0-9]+/gi, "-") + ".dashboard.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function DashboardDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => old?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="ldk-surface ldk-modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="btn" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function BoardWorkspace() {
  const runtime = useDashboard();
  const {
    loadBoardIndex,
    saveBoardIndex,
    loadBoard,
    createBoard,
    clearBoard,
    restoreBoard,
    archivedBoards,
    flush: flushBoards,
    retryBoards,
  } = runtime.store;
  const [index, setIndex] = useState<BoardIndex | null>(null);
  const [error, setError] = useState("");
  const [save, setSave] = useState({ pending: 0, error: "" });
  const [modal, setModal] = useState<"import" | "archives" | "chart" | null>(
    null,
  );
  const [editing, setEditing] = useState<ChartSpec | null>(null);
  const [period, setPeriod] = useState<BoardPeriod | null>(null);
  const [filters, setFilterState] = useState(runtime.filters);
  const Toolbar = runtime.options.slots?.Toolbar;
  const Editor = runtime.options.slots?.Editor;
  const Import = runtime.options.slots?.Import || ImportDialog;
  const setFilters = (next: Record<string, unknown>) => {
    runtime.filters = next;
    setFilterState(next);
    runtime.events.dispatchEvent(new Event("refresh"));
  };
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let alive = true;
    loadBoardIndex()
      .then((x) => alive && setIndex({ ...x }))
      .catch((e) => alive && setError(message(e)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const saved = (e: Event) => setSave((e as CustomEvent).detail);
    const filtered = () => setPeriod(runtime.period);
    const edit = (e: Event) => {
      setEditing((e as CustomEvent).detail || null);
      setModal("chart");
    };
    runtime.events.addEventListener("save", saved);
    runtime.events.addEventListener("period", filtered);
    runtime.events.addEventListener("edit-chart", edit);
    return () => {
      runtime.events.removeEventListener("save", saved);
      runtime.events.removeEventListener("period", filtered);
      runtime.events.removeEventListener("edit-chart", edit);
    };
  }, []);
  async function perform(action: () => Promise<void>, anchor?: HTMLElement) {
    try {
      await action();
      setError("");
    } catch (e) {
      const msg = message(e);
      setError(msg);
      if (anchor) showFlashTip(anchor, msg);
    }
  }
  async function commit(next: BoardIndex) {
    await saveBoardIndex(next);
    setIndex({ ...next });
  }
  async function add(name = "Untitled board", doc?: BoardDocument) {
    if (!index) return;
    await flushBoards();
    const id = await createBoard(name, doc);
    await commit({
      ...index,
      active: id,
      boards: [...index.boards, { id, name, createdAt: Date.now() }],
    });
  }
  if (!index)
    return (
      <section className="aie-board">
        <p role={error ? "alert" : "status"}>{error || "Loading boards…"}</p>
        {error && (
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        )}
      </section>
    );
  return (
    <>
      <div className="ldk-board-header">
        <BoardTabs
          index={index}
          onSelect={(id) =>
            void perform(async () => {
              await flushBoards();
              await commit({ ...index, active: id });
            })
          }
          onReorder={(ids) =>
            void perform(() =>
              commit({
                ...index,
                boards: ids.map((id) => index.boards.find((b) => b.id === id)!),
              }),
            )
          }
          onAdd={() => void perform(() => add())}
          onRename={(id, name) =>
            void perform(() =>
              commit({
                ...index,
                boards: index.boards.map((b) =>
                  b.id === id ? { ...b, name } : b,
                ),
              }),
            )
          }
          onDuplicate={(id) =>
            void perform(async () => {
              const doc = await loadBoard(id);
              await add(doc.name.slice(0, 73) + " (copy)", doc);
            })
          }
          onDelete={(id) =>
            void perform(async () => {
              await clearBoard(id);
              const remaining = index.boards.filter((b) => b.id !== id);
              if (!remaining.length) {
                const fresh = await createBoard("Untitled board");
                remaining.push({
                  id: fresh,
                  name: "Untitled board",
                  createdAt: Date.now(),
                });
              }
              await commit({
                ...index,
                active: index.active === id ? remaining[0].id : index.active,
                boards: remaining,
              });
            })
          }
          onShareLink={(id, el) =>
            void perform(async () => {
              await flushBoards();
              if (!runtime.adapter.share) throw Error("Sharing is unavailable.");
              await runtime.adapter.share(await loadBoard(id));
            }, el)
          }
          onDownload={(id) =>
            void perform(async () => download(await loadBoard(id)))
          }
        />
        <div className="ldk-toolbar">
          <div className="ldk-filters">
            {Toolbar && <Toolbar filters={filters} setFilters={setFilters} />}
            {period && (
              <button
                className="btn"
                onClick={() => {
                  runtime.period = null;
                  runtime.options.onPeriodChange?.(null);
                  setPeriod(null);
                  runtime.events.dispatchEvent(new Event("period"));
                }}
              >
                Dates: {period.label} ×
              </button>
            )}
          </div>
          <div className="ldk-tools">
            {runtime.options.features?.editing !== false && (
              <button className="btn aie-btabs-import" onClick={() => setModal("import")}>
                Import board
              </button>
            )}
            {archivedBoards().length > 0 && (
              <button className="btn" onClick={() => setModal("archives")}>
                Archived
              </button>
            )}
            {runtime.options.features?.editing !== false && !locked && Editor && (
              <button
                className="btn"
                onClick={() => {
                  setEditing(null);
                  setModal("chart");
                }}
              >
                Choose fields
              </button>
            )}
            <span className="ldk-save" role="status">
              {save.pending ? "Saving…" : save.error ? "Not saved" : "Saved"}
            </span>
            <span id={`${runtime.rootId}-lock`} />
          </div>
        </div>
      </div>
      {(error || save.error) && (
        <div className="ldk-error" role="alert">
          <span>{save.error || error}</span>
          {save.error && (
            <button
              className="btn"
              onClick={(e) => void perform(retryBoards, e.currentTarget)}
            >
              Retry save
            </button>
          )}
          <button
            className="btn"
            aria-label="Dismiss message"
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}
      <p className="ldk-caption" title={runtime.options.aiDisclosure}>
        {runtime.store.aiConfigured
          ? "AI connected"
          : "Built-in starters · AI not connected"}
        {runtime.options.caption && ` · ${runtime.options.caption}`}
      </p>
      <CustomBoard
        key={index.active}
        boardId={index.active}
        onDocChange={(doc) => setLocked(Boolean(doc.locked))}
      />
      {modal === "archives" && (
        <DashboardDialog title="Archived boards" onClose={() => setModal(null)}>
          <div className="ldk-modal-body">
            {archivedBoards().map((b) => (
              <div className="ldk-archive" key={b.id}>
                <span>{b.definition.name}</span>
                <button
                  className="btn"
                  onClick={(e) =>
                    void perform(async () => {
                      const restored = await restoreBoard(b.id);
                      if (restored) {
                        await commit({
                          ...index,
                          active: b.id,
                          boards: [
                            ...index.boards,
                            {
                              id: b.id,
                              name: b.definition.name,
                              createdAt: Date.now(),
                            },
                          ],
                        });
                        setModal(null);
                      }
                    }, e.currentTarget)
                  }
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </DashboardDialog>
      )}
      {modal === "import" && (
        <Import
          onClose={() => setModal(null)}
          onImport={async (doc) => {
            await add(doc.name, doc);
            setModal(null);
          }}
        />
      )}
      {modal === "chart" && Editor && (
        <Editor
          chart={editing}
          onClose={() => setModal(null)}
          onSave={(chart) => {
            runtime.events.dispatchEvent(
              new CustomEvent("add-chart", { detail: chart }),
            );
            setModal(null);
          }}
        />
      )}
    </>
  );
}
function ImportDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (doc: BoardDocument) => Promise<void>;
}) {
  const runtime = useDashboard();
  const [text, setText] = useState(""),
    [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  async function submit(anchor: HTMLElement) {
    try {
      const f = file.current?.files?.[0];
      if (f && f.size > 1_000_000) throw Error("Choose a file under 1 MB.");
      const raw = JSON.parse(f ? await f.text() : text);
      if (
        !["loadsmart-dashboard", "loadsmart-forms-board"].includes(
          raw.format,
        ) ||
        ![1, 2].includes(raw.version)
      )
        throw Error("Choose a dashboard JSON file.");
      if (!runtime.adapter.importDefinition)
        throw Error("Import is unavailable.");
      await onImport(await runtime.adapter.importDefinition(raw.definition));
    } catch (e) {
      setError(message(e));
      showFlashTip(anchor, message(e));
    }
  }
  return (
    <DashboardDialog title="Import board" onClose={onClose}>
      <div className="ldk-modal-body">
        <p>
          Chart settings and layout only. Fields must match this data source.
        </p>
        <label>
          JSON file
          <input type="file" ref={file} accept=".json,application/json" />
        </label>
        <label>
          Or paste JSON
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
            rows={8}
          />
        </label>
        {error && (
          <p className="ldk-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button className="btn" onClick={(e) => void submit(e.currentTarget)}>
          Import as new board
        </button>
      </footer>
    </DashboardDialog>
  );
}
export function SharedBoard({
  data,
}: {
  data: { board: BoardDocument; widgets: any[] };
}) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="ldk-shared-board">
      {data.board.widgets.map((w) => {
        const l = data.board.layouts.find((l) => l.i === w.id)!;
        return (
          <div
            key={w.id}
            style={{
              gridColumn: width < 700 ? "1 / -1" : `${l.x + 1} / span ${l.w}`,
              gridRow: width < 700 ? undefined : `${l.y + 1} / span ${l.h}`,
              minHeight: width < 700 ? 320 : undefined,
            }}
          >
            <ChartTile
              spec={w}
              editMode={false}
              onRemove={() => {}}
              onRunPrompt={() => {}}
            />
          </div>
        );
      })}
    </div>
  );
}
