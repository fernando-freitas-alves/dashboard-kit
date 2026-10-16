import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useDashboard } from "../runtime";
import type { BoardIndex } from "./types";

type Props = {
  index: BoardIndex;
  onSelect: (id: string) => void;
  /** New tab order (all board ids). Only called when the order changed. */
  onReorder: (ids: string[]) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onShareLink: (id: string, anchor: HTMLElement) => void;
  onDownload: (id: string) => void;
  onDuplicate: (id: string) => void;
};

/** Pointer travel (px) before a press on a tab becomes a drag instead of a click. */
const DRAG_THRESHOLD = 5;

type DragState = {
  id: string;
  el: HTMLElement;
  x0: number;
  y0: number;
  active: boolean;
  /** Insert position among the other tabs (0…n). */
  at: number | null;
};

/** Move `id` so it sits at `at` among the remaining ids. */
function moveTo(ids: string[], id: string, at: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(at, 0, id);
  return rest;
}

/**
 * Board tabs inside the Boards tab: one pill per board, a `⋯` menu on the
 * active one (rename, share link, download, delete), plus New board.
 * Tabs reorder by dragging (including wrapped rows) or with Alt+←/→.
 */
export function BoardTabs({
  index,
  onSelect,
  onReorder,
  onAdd,
  onRename,
  onDelete,
  onShareLink,
  onDownload,
  onDuplicate,
}: Props) {
  const runtime = useDashboard();
  const editable = runtime.options.features?.editing !== false;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [menuFor]);

  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  /** The click that ends a drag must not also select the tab. */
  const suppressClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const idsRef = useRef<string[]>([]);
  idsRef.current = index.boards.map((b) => b.id);
  /** Window listeners are registered once; read the latest callback through this. */
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  /**
   * Where the dragged tab would land: before the first other tab that sits
   * on a later row or, on the pointer's row, whose midpoint is right of it.
   */
  const dropIndexAt = (x: number, y: number, dragged: string): number => {
    const others = [
      ...(listRef.current?.querySelectorAll<HTMLElement>(
        ".aie-btab[data-id]",
      ) ?? []),
    ].filter((el) => el.dataset.id !== dragged);
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return i;
    }
    return others.length;
  };

  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    d.el.style.transform = "";
    document.documentElement.classList.remove("aie-btab-dragging");
    setDragId(null);
    setDropAt(null);
    if (!d.active) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (!commit || d.at == null) return;
    const ids = idsRef.current;
    const next = moveTo(ids, d.id, d.at);
    if (next.some((id, i) => id !== ids[i])) onReorderRef.current(next);
  };

  const startPress = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (!editable || e.button !== 0 || renaming || idsRef.current.length < 2)
      return;
    if (
      (e.target as Element).closest(".aie-btab-more, .aie-btab-menu, input")
    ) {
      return;
    }
    dragRef.current = {
      id,
      el: e.currentTarget,
      x0: e.clientX,
      y0: e.clientY,
      active: false,
      at: null,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.active = true;
        setDragId(d.id);
        setMenuFor(null);
        document.documentElement.classList.add("aie-btab-dragging");
      }
      e.preventDefault();
      d.el.style.transform = `translate(${dx}px, ${dy}px)`;
      const at = dropIndexAt(e.clientX, e.clientY, d.id);
      if (at !== d.at) {
        d.at = at;
        setDropAt(at);
      }
    };
    const onUp = () => endDrag(true);
    const onCancel = () => endDrag(false);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current?.active) {
        e.preventDefault();
        endDrag(false);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
    // endDrag/dropIndexAt read refs only; one listener set for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (renaming) return;
    const ids = index.boards.map((b) => b.id);
    const i = ids.indexOf(index.active);
    if (
      editable &&
      e.altKey &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      const at = i + (e.key === "ArrowRight" ? 1 : -1);
      if (at < 0 || at >= ids.length) return;
      e.preventDefault();
      onReorder(moveTo(ids, index.active, at));
      requestAnimationFrame(() =>
        document
          .getElementById(`${runtime.rootId}-tab-${index.active}`)
          ?.focus(),
      );
      return;
    }
    const j =
      e.key === "ArrowRight"
        ? (i + 1) % ids.length
        : e.key === "ArrowLeft"
          ? (i - 1 + ids.length) % ids.length
          : -1;
    if (j < 0) return;
    e.preventDefault();
    onSelect(ids[j]);
    requestAnimationFrame(() =>
      document.getElementById(`${runtime.rootId}-tab-${ids[j]}`)?.focus(),
    );
  };

  return (
    <div className="aie-btabs">
      <div
        ref={listRef}
        className="aie-btabs-list"
        role="tablist"
        aria-label="Your boards"
        onKeyDown={onTabKey}
      >
        {index.boards.map((b) => {
          const active = b.id === index.active;
          const others = dragId
            ? index.boards.filter((o) => o.id !== dragId)
            : index.boards;
          const k = others.findIndex((o) => o.id === b.id);
          const dropBefore = dropAt != null && b.id !== dragId && k === dropAt;
          const dropAfter =
            dropAt != null &&
            b.id !== dragId &&
            k === others.length - 1 &&
            dropAt === others.length;
          return (
            <div
              key={b.id}
              data-id={b.id}
              className={`aie-btab${active ? " is-active" : ""}${b.id === dragId ? " is-dragging" : ""}${dropBefore ? " is-drop-before" : ""}${dropAfter ? " is-drop-after" : ""}`}
              ref={menuFor === b.id ? menuRef : undefined}
              onPointerDown={(e) => startPress(e, b.id)}
            >
              {renaming === b.id ? (
                <RenameInput
                  initial={b.name}
                  onDone={(name) => {
                    setRenaming(null);
                    if (name && name !== b.name) onRename(b.id, name);
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  id={`${runtime.rootId}-tab-${b.id}`}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  className="aie-btab-name"
                  onClick={() => {
                    if (!suppressClick.current) onSelect(b.id);
                  }}
                  onDoubleClick={() => editable && setRenaming(b.id)}
                  title={
                    index.boards.length > 1
                      ? `${b.name} — drag to reorder${active ? ", double-click to rename" : ""}`
                      : active
                        ? "Double-click to rename"
                        : b.name
                  }
                >
                  {b.name}
                </button>
              )}
              {active && renaming !== b.id && (
                <button
                  type="button"
                  className="aie-btab-more"
                  aria-label={`${b.name} options`}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === b.id}
                  onClick={() => setMenuFor((m) => (m === b.id ? null : b.id))}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
                  </svg>
                </button>
              )}
              {menuFor === b.id && (
                <div className="aie-btab-menu" role="menu">
                  <button
                    hidden={!editable}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuFor(null);
                      setRenaming(b.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    hidden={
                      runtime.options.features?.sharing === false ||
                      !runtime.adapter.share
                    }
                    onClick={(e) => {
                      setMenuFor(null);
                      const anchor =
                        e.currentTarget.closest<HTMLElement>(".aie-btab");
                      onShareLink(b.id, anchor ?? document.body);
                    }}
                  >
                    {runtime.options.shareLabel || "Share board"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    hidden={runtime.options.features?.export === false}
                    onClick={() => {
                      setMenuFor(null);
                      onDownload(b.id);
                    }}
                  >
                    Download file
                  </button>
                  <button
                    hidden={!editable}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuFor(null);
                      onDuplicate(b.id);
                    }}
                  >
                    Duplicate
                  </button>
                  <hr />
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    hidden={!editable}
                    title={
                      index.boards.length < 2
                        ? "You need at least one board"
                        : undefined
                    }
                    onClick={() => {
                      setMenuFor(null);
                      onDelete(b.id);
                    }}
                  >
                    Archive board
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="aie-btabs-act"
        hidden={!editable}
        onClick={onAdd}
        aria-label="New board"
        title="New board"
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/** Inline tab rename: Enter/blur saves, Esc cancels (reports `null`-ish via unchanged name). */
function RenameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string) => {
    if (done.current) return;
    done.current = true;
    onDone(name.trim());
  };
  return (
    <input
      className="aie-btab-input"
      aria-label="Board name"
      maxLength={80}
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(initial);
      }}
      size={Math.max(6, value.length + 1)}
    />
  );
}
