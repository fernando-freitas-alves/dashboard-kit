import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import GridLayout, { type Layout } from "react-grid-layout";
import { hideTip } from "../../vendor/dash-kit/js/tooltip.js";
import { showFlashTip } from "../../vendor/dash-kit/js/patterns.js";
import { isAbortError } from "./abort";
import { composeChartFromPrompt } from "./agent/chartAgent";
import { newId } from "./agent/recipes";
import { ChartTile } from "./ChartTile";
import {
  BOARD_COLS,
  BOARD_MARGIN,
  BOARD_ROW_H,
  DEFAULT_SIZE,
  WIDTH_STEPS,
  snapLayoutItem,
  snapLayouts,
} from "./gridSizes";
import { friendlyBoardError } from "./friendlyError";
import { useDashboard } from "../runtime";
import {
  toggleBoardPeriod,
  formatPeriodLabel,
  type BoardPeriod,
} from "./period";
import type {
  AgentProgress,
  BoardDocument,
  BoardLayout,
  ChartSpec,
  ChartTrace,
} from "./types";
import { isDraftChart } from "./types";
import { activeChartVersion, previousChartVersion, restoreChartVersion, sameChart, updateChartVersion } from "./chartHistory";

/** Ephemeral add-tile id — never persisted. */
const ADD_TILE_ID = "__aie-add-chart__";
/** Match `.aie-grid-item--add` enter/exit CSS duration. */
const ADD_TILE_ANIM_MS = 240;

function toDraft(layouts: BoardLayout[]): Layout[] {
  return layouts
    .filter((l) => l.i !== ADD_TILE_ID)
    .map((l) =>
      snapLayoutItem({
        i: l.i,
        x: Number(l.x) || 0,
        y: Number(l.y) || 0,
        w: Number(l.w) || DEFAULT_SIZE.w,
        h: Number(l.h) || DEFAULT_SIZE.h,
        minW: DEFAULT_SIZE.minW,
        minH: DEFAULT_SIZE.minH,
        maxW: DEFAULT_SIZE.maxW,
        maxH: DEFAULT_SIZE.maxH,
      }),
    );
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

/**
 * Next free slot, packed flush against existing tiles (no holes).
 * Prefers remaining space on the topmost row that still fits a width step.
 */
function findOpenSlot(
  layouts: Array<{ x: number; y: number; w: number; h: number }>,
  preferredW = DEFAULT_SIZE.w,
  preferredH = DEFAULT_SIZE.h,
): { x: number; y: number; w: number; h: number } {
  const items = layouts.map((l) => ({
    x: Number(l.x) || 0,
    y: Number(l.y) || 0,
    w: Number(l.w) || preferredW,
    h: Number(l.h) || preferredH,
  }));

  if (!items.length) {
    return { x: 0, y: 0, w: preferredW, h: preferredH };
  }

  const rowYs = [...new Set(items.map((i) => i.y))].sort((a, b) => a - b);
  for (const rowY of rowYs) {
    const onRow = items.filter((i) => i.y === rowY);
    const rowEnd = Math.max(...onRow.map((i) => i.x + i.w));
    const rowH = Math.max(...onRow.map((i) => i.h));
    const remaining = BOARD_COLS - rowEnd;
    if (remaining < WIDTH_STEPS[0]) continue;

    const widths = WIDTH_STEPS.filter(
      (w) => w <= preferredW && w <= remaining,
    ).sort((a, b) => b - a);
    if (!widths.length) continue;

    const candidate = {
      x: rowEnd,
      y: rowY,
      w: widths[0],
      h: rowH || preferredH,
    };
    if (!items.some((l) => rectsOverlap(candidate, l))) {
      return candidate;
    }
  }

  const maxY = items.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return { x: 0, y: maxY, w: preferredW, h: preferredH };
}

/** Keep only layouts that belong to current widgets (drop phantoms / add-tile). */
function reconcileLayouts(layouts: Layout[], widgetIds: string[]): Layout[] {
  const idSet = new Set(widgetIds);
  const byId = new Map<string, Layout>();
  for (const l of layouts) {
    if (l.i === ADD_TILE_ID || !idSet.has(l.i)) continue;
    byId.set(l.i, l);
  }
  const out: Layout[] = [];
  let maxY = 0;
  for (const id of widgetIds) {
    const existing = byId.get(id);
    if (existing) {
      out.push(existing);
      maxY = Math.max(maxY, existing.y + existing.h);
    } else {
      const slot = findOpenSlot(out);
      out.push(
        snapLayoutItem({
          i: id,
          x: slot.x,
          y: slot.y,
          w: slot.w,
          h: slot.h,
          minW: DEFAULT_SIZE.minW,
          minH: DEFAULT_SIZE.minH,
          maxW: DEFAULT_SIZE.maxW,
          maxH: DEFAULT_SIZE.maxH,
        }),
      );
      maxY = Math.max(maxY, slot.y + slot.h);
    }
  }
  return out;
}

/**
 * Place the “Add chart” control on the bottom-most row that still has room,
 * at the leftmost free column. If that row is full, start a new row below
 * everything at x = 0.
 */
function findAddTileSlot(
  layouts: Array<{ x: number; y: number; w: number; h: number }>,
  preferredW = DEFAULT_SIZE.w,
  preferredH = DEFAULT_SIZE.h,
): { x: number; y: number; w: number; h: number } {
  const w = Math.min(preferredW, BOARD_COLS);
  const h = preferredH;
  const items = layouts.map((l) => ({
    x: Number(l.x) || 0,
    y: Number(l.y) || 0,
    w: Number(l.w) || preferredW,
    h: Number(l.h) || preferredH,
  }));

  if (!items.length) {
    return { x: 0, y: 0, w, h };
  }

  const bottomRowY = Math.max(...items.map((i) => i.y));
  const onRow = items.filter((i) => i.y === bottomRowY);
  const rowH = Math.max(...onRow.map((i) => i.h), h);

  for (let x = 0; x <= BOARD_COLS - w; x++) {
    const candidate = { x, y: bottomRowY, w, h: rowH };
    if (!items.some((l) => rectsOverlap(candidate, l))) {
      return candidate;
    }
  }

  const maxY = items.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  return { x: 0, y: maxY, w, h };
}

/** Append the blank “Add chart” tile on the bottom row, leftmost. */
function withAddTile(layouts: Layout[]): Layout[] {
  const widgetsOnly = layouts.filter((l) => l.i !== ADD_TILE_ID);
  const slot = findAddTileSlot(widgetsOnly);
  return [
    ...widgetsOnly,
    {
      i: ADD_TILE_ID,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      minW: slot.w,
      minH: slot.h,
      maxW: slot.w,
      maxH: slot.h,
      // Stay put at bottom-right — vertical compact must not pull this into holes.
      static: true,
      isDraggable: false,
      isResizable: false,
    },
  ];
}

function normalizeWidgets(widgets: ChartSpec[]): ChartSpec[] {
  return widgets.map((w) => ({
    ...w,
    status: w.status ?? (w.query?.trim() ? "ready" : "draft"),
  }));
}

function emptyDraft(): ChartSpec {
  const now = Date.now();
  return {
    id: newId(),
    title: "New chart",
    prompt: "",
    kind: "bar",
    query: "",
    mapping: {},
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Datadog-style personal board: editable prompts on tiles; unlocked boards show a
 * blank “Add chart” grid slot (not persisted). Credentials stay in the host backend.
 *
 * Renders one board (`boardId`); mount with `key={boardId}` so switching tabs
 * starts fresh and stops runs on the board being left. `onDocChange` reports
 * the loaded/saved document so the tab bar can share it.
 */
export function CustomBoard({
  boardId,
  onDocChange,
}: {
  boardId: string;
  onDocChange?: (doc: BoardDocument) => void;
}) {
  const runtime = useDashboard();
  const { loadBoard, saveBoard } = runtime.store;
  const [doc, setDoc] = useState<BoardDocument | null>(null);
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  /** Tiles currently running the chart agent (more than one allowed). */
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [tileProgress, setTileProgress] = useState<
    Record<string, AgentProgress>
  >({});
  /**
   * Agent log for runs in flight or that failed (session only). A successful
   * run drops its entry here because the saved `spec.trace` takes over.
   */
  const [liveTraces, setLiveTraces] = useState<Record<string, ChartTrace>>({});
  const [width, setWidth] = useState(960);
  const [editMode, setEditMode] = useState(
    runtime.options.features?.editing !== false,
  );
  /** Keep add-tile in the grid until exit animation finishes. */
  const [showAddTile, setShowAddTile] = useState(
    runtime.options.features?.editing !== false,
  );
  const [addTileOpen, setAddTileOpen] = useState(
    runtime.options.features?.editing !== false,
  );
  const [layoutDraft, setLayoutDraft] = useState<Layout[]>([]);
  const [interacting, setInteracting] = useState(false);
  /** Snap-grid overlay — only while a tile is being resized. */
  const [resizing, setResizing] = useState(false);
  /** Board-wide period — mirrored from the shared Active filters chip. */
  const [period, setPeriod] = useState<BoardPeriod | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const busyIdsRef = useRef<Set<string>>(new Set());
  /** One controller per running tile so Stop cancels just that tile's run. */
  const abortersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const aborters = abortersRef.current;
    return () => {
      for (const c of aborters.values()) c.abort();
      aborters.clear();
    };
  }, []);

  useEffect(() => {
    const sync = () => setPeriod(runtime.period);
    sync();
    runtime.events.addEventListener("period", sync);
    return () => runtime.events.removeEventListener("period", sync);
  }, [runtime]);

  useEffect(() => {
    const root = document.getElementById(runtime.rootId);
    if (!root) return;
    const clearSel = () => window.getSelection()?.removeAllRanges();
    const onPointerDown = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.closest?.(".aie-tile-chart")) clearSel();
    };
    const onSelectStart = (e: Event) => {
      if (
        document.querySelector(".aie-tile-chart.is-brushing") ||
        (e.target as Element | null)?.closest?.(".aie-tile-chart")
      ) {
        e.preventDefault();
      }
    };
    root.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("selectstart", onSelectStart, true);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("selectstart", onSelectStart, true);
    };
  }, []);

  useEffect(() => {
    if (editMode) {
      setShowAddTile(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setAddTileOpen(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setAddTileOpen(false);
    const t = window.setTimeout(() => setShowAddTile(false), ADD_TILE_ANIM_MS);
    return () => window.clearTimeout(t);
  }, [editMode]);

  useEffect(() => {
    let alive = true;
    void loadBoard(boardId).then((board) => {
      if (!alive) return;
      const widgets = normalizeWidgets(board.widgets);
      const layouts = snapLayouts(
        board.layouts.filter((l) => l.i !== ADD_TILE_ID),
      ).map((l) => ({
        ...l,
        minW: DEFAULT_SIZE.minW,
        minH: DEFAULT_SIZE.minH,
      }));
      const loaded = { ...board, widgets, layouts };
      setDoc(loaded);
      setEditMode(
        runtime.options.features?.editing !== false && !loaded.locked,
      );
      setLayoutDraft(toDraft(layouts));
      onDocChangeRef.current?.(loaded);
    });
    return () => {
      alive = false;
    };
  }, [boardId]);

  useEffect(() => {
    const root = document.getElementById(runtime.rootId);
    if (!root) return;
    const measure = () => setWidth(Math.max(320, root.clientWidth - 8));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const visibleWidgets = useMemo(() => {
    if (!doc) return [];
    // Keep drafts in-layout through the lock exit animation so the Add tile
    // doesn't reflow into their vacated slots mid-fade. A draft whose query is
    // still running stays visible so it can be watched and stopped.
    if (!editMode && !showAddTile) {
      return doc.widgets.filter((w) => !isDraftChart(w) || busyIds.has(w.id));
    }
    return doc.widgets;
  }, [doc, editMode, showAddTile, busyIds]);

  const allWidgetIds = doc?.widgets.map((w) => w.id) ?? [];
  const visibleIds = visibleWidgets.map((w) => w.id);

  const gridLayout = useMemo(() => {
    const widgetsOnly = reconcileLayouts(layoutDraft, visibleIds);
    return showAddTile ? withAddTile(widgetsOnly) : widgetsOnly;
  }, [showAddTile, layoutDraft, visibleIds.join("|")]);

  const addSlot = useMemo(() => {
    if (!editMode || !showAddTile) return null;
    const item = gridLayout.find((l) => l.i === ADD_TILE_ID);
    return item
      ? { x: item.x, y: item.y, w: item.w, h: item.h }
      : findAddTileSlot(layoutDraft);
  }, [editMode, showAddTile, gridLayout, layoutDraft]);

  const syncLayoutDraft = (next: Layout[]) => {
    if (!editMode) return;
    setLayoutDraft(
      reconcileLayouts(
        next.filter((l) => l.i !== ADD_TILE_ID),
        allWidgetIds,
      ),
    );
  };

  const persist = useCallback(
    async (next: BoardDocument) => {
      const cleaned: BoardDocument = {
        ...next,
        layouts: next.layouts.filter((l) => l.i !== ADD_TILE_ID),
        widgets: next.widgets.filter((w) => w.id !== ADD_TILE_ID),
      };
      docRef.current = cleaned;
      setDoc(cleaned);
      setLayoutDraft(toDraft(cleaned.layouts));
      onDocChangeRef.current?.(cleaned);
      try {
        await saveBoard(boardId, cleaned);
      } catch (e) {
        const root = document.getElementById(runtime.rootId);
        if (root) {
          showFlashTip(root, friendlyBoardError(e));
        }
      }
    },
    [boardId],
  );

  useEffect(() => {
    const apply = (e: Event) => {
      const current = docRef.current;
      if (!current) return;
      const proposed = (e as CustomEvent<ChartSpec>).detail;
      const chart = updateChartVersion(current.widgets.find(w => w.id === proposed.id), proposed);
      const exists = current.widgets.some((w) => w.id === chart.id);
      const y = Math.max(0, ...current.layouts.map((l) => l.y + l.h));
      void persist({
        ...current,
        widgets: exists
          ? current.widgets.map((w) => (w.id === chart.id ? chart : w))
          : [...current.widgets, chart],
        layouts: exists
          ? current.layouts
          : [
              ...current.layouts,
              { i: chart.id, x: 0, y, w: 6, h: 8, minW: 3, minH: 4 },
            ],
      });
    };
    runtime.events.addEventListener("add-chart", apply);
    return () => runtime.events.removeEventListener("add-chart", apply);
  }, [persist]);

  const commitLayouts = (next: Layout[]) => {
    if (!doc || !editMode) return;
    const layoutsNext: BoardLayout[] = snapLayouts(
      reconcileLayouts(
        next.filter((l) => l.i !== ADD_TILE_ID),
        doc.widgets.map((w) => w.id),
      ),
    ).map((l) => ({
      i: l.i,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      minW: DEFAULT_SIZE.minW,
      minH: DEFAULT_SIZE.minH,
    }));
    void persist({ ...doc, layouts: layoutsNext });
  };

  const addDraftTile = () => {
    if (!doc || !editMode || !addSlot) return;
    const widget = emptyDraft();
    const existing = reconcileLayouts(
      layoutDraft,
      doc.widgets.map((w) => w.id),
    );
    // Place exactly where the Add tile currently sits (flush-packed slot).
    const layout = snapLayoutItem({
      i: widget.id,
      x: addSlot.x,
      y: addSlot.y,
      w: addSlot.w,
      h: addSlot.h,
      minW: DEFAULT_SIZE.minW,
      minH: DEFAULT_SIZE.minH,
    });
    const layouts: BoardLayout[] = [
      ...existing.map((l) => ({
        i: l.i,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        minW: DEFAULT_SIZE.minW,
        minH: DEFAULT_SIZE.minH,
      })),
      layout,
    ];
    void persist({
      ...doc,
      widgets: [...doc.widgets, widget],
      layouts,
    });
  };

  const runPromptForTile = async (id: string, prompt: string) => {
    if (!docRef.current || busyIdsRef.current.has(id)) return;
    busyIdsRef.current.add(id);
    setBusyIds(new Set(busyIdsRef.current));
    const controller = new AbortController();
    abortersRef.current.set(id, controller);

    // A draft's prompt otherwise lives only in tile state, and the tile unmounts
    // when a locked board hides it (e.g. after Stop). Save it so it comes back.
    const startDoc = docRef.current;
    const startWidget = startDoc.widgets.find((w) => w.id === id);
    if (
      startWidget &&
      isDraftChart(startWidget) &&
      startWidget.prompt !== prompt
    ) {
      void persist({
        ...startDoc,
        widgets: startDoc.widgets.map((w) =>
          w.id === id ? { ...w, prompt } : w,
        ),
      });
    }

    setTileProgress((p) => ({
      ...p,
      [id]: { phase: "thinking", message: "Starting…" },
    }));
    const onProgress = (progress: AgentProgress) => {
      setTileProgress((p) => ({ ...p, [id]: progress }));
    };
    const onTrace = (trace: ChartTrace) => {
      setLiveTraces((t) => ({ ...t, [id]: trace }));
    };
    try {
      const result = await composeChartFromPrompt(
        runtime,
        prompt,
        onProgress,
        controller.signal,
        onTrace,
        startWidget,
      );
      if (controller.signal.aborted) return;
      // Read latest board so a draft added while this ran is not clobbered.
      const latest = docRef.current;
      const current = latest?.widgets.find((w) => w.id === id);
      if (!latest || !current) return;
      const nextWidget = updateChartVersion(current, {
        ...result.widget, id, status: "ready",
      });
      const widgets = latest.widgets.map((w) => (w.id === id ? nextWidget : w));
      await persist({ ...latest, widgets });
      setLiveTraces((t) => {
        const next = { ...t };
        delete next[id];
        return next;
      });
      setTileProgress((p) => ({
        ...p,
        [id]: { phase: "done", message: sameChart(current, nextWidget)
          ? `Chart unchanged · v${activeChartVersion(nextWidget)}`
          : `Updated · v${activeChartVersion(nextWidget)}` },
      }));
    } catch (e) {
      if (controller.signal.aborted || isAbortError(e)) {
        clearProgress(id);
        return;
      }
      setTileProgress((p) => ({
        ...p,
        [id]: {
          phase: "error",
          message: friendlyBoardError(e),
          attentionKey: Date.now(),
        },
      }));
    } finally {
      if (abortersRef.current.get(id) === controller) {
        abortersRef.current.delete(id);
      }
      busyIdsRef.current.delete(id);
      setBusyIds(new Set(busyIdsRef.current));
    }
  };

  const clearProgress = (id: string) => {
    setTileProgress((p) => {
      if (!(id in p)) return p;
      const next = { ...p };
      delete next[id];
      return next;
    });
  };

  /** Cancel a tile's agent run; the tile keeps the chart it had before. */
  const stopTile = (id: string) => {
    abortersRef.current.get(id)?.abort();
  };

  const revertTile = (id: string, version?: number) => {
    const latest = docRef.current;
    if (!latest || busyIdsRef.current.has(id)) return;
    const current = latest.widgets.find(w => w.id === id);
    if (!current) return;
    const target = version ?? previousChartVersion(current)?.version;
    if (target == null) return;
    const restored = restoreChartVersion(current, target);
    if (restored === current) return;
    clearProgress(id);
    void persist({ ...latest, widgets: latest.widgets.map(w => w.id === id ? restored : w) });
  };

  const removeWidget = (id: string) => {
    if (!doc) return;
    stopTile(id);
    void persist({
      ...doc,
      widgets: doc.widgets.filter((w) => w.id !== id),
      layouts: doc.layouts.filter((l) => l.i !== id),
    });
    clearProgress(id);
    setLiveTraces((t) => {
      const next = { ...t };
      delete next[id];
      return next;
    });
  };

  const applyPeriod = (from: number, to: number, label: string) => {
    const nice = formatPeriodLabel(from, to) || label;
    const next = toggleBoardPeriod(period, { from, to, label: nice });
    runtime.period = next;
    runtime.options.onPeriodChange?.(next);
    setPeriod(next);
    runtime.events.dispatchEvent(new Event("period"));
  };

  const beginInteract = () => {
    window.getSelection()?.removeAllRanges();
    hideTip();
    setInteracting(true);
  };

  const beginResize = () => {
    beginInteract();
    setResizing(true);
  };

  const endInteract = (next: Layout[]) => {
    hideTip();
    setInteracting(false);
    setResizing(false);
    commitLayouts(next);
  };

  const lockSlot =
    typeof document !== "undefined"
      ? document.getElementById(`${runtime.rootId}-lock`)
      : null;

  const tabLock =
    runtime.options.features?.editing === false ? null : (
      <button
        type="button"
        className={`aie-tab-lock${editMode ? " is-unlocked" : " is-locked"}`}
        aria-pressed={editMode}
        aria-label={
          editMode
            ? "Layout editing is unlocked. Click to lock the board layout."
            : "Board layout is locked. Click to unlock and edit."
        }
        title={
          editMode
            ? "Unlocked — click to lock layout"
            : "Locked — click to unlock layout"
        }
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setEditMode((v) => !v);
          if (docRef.current)
            void persist({ ...docRef.current, locked: editMode });
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="aie-tab-lock__icon" aria-hidden="true">
          {editMode ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M5.25 7V5.1a2.75 2.75 0 0 1 5.3-.9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <rect
                x="3.25"
                y="7"
                width="9.5"
                height="6.75"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M5.25 7V4.85a2.75 2.75 0 0 1 5.5 0V7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <rect
                x="3.25"
                y="7"
                width="9.5"
                height="6.75"
                rx="1.6"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle cx="8" cy="10.4" r="1.05" fill="currentColor" />
            </svg>
          )}
        </span>
      </button>
    );

  if (!doc) {
    return (
      <>
        {lockSlot ? createPortal(tabLock, lockSlot) : null}
        <div className="aie-board">
          <p className="aie-muted">Loading your board…</p>
        </div>
      </>
    );
  }

  return (
    <div
      className={`aie-board${interacting ? " aie-board--interacting" : ""}${resizing ? " aie-board--resizing" : ""}`}
    >
      {lockSlot ? createPortal(tabLock, lockSlot) : null}
      {!visibleWidgets.length && !editMode && (
        <div className="aie-empty">
          <p>No charts yet — unlock the board to add one.</p>
        </div>
      )}

      <div className="aie-grid-wrap">
        <div
          className="aie-board-snapgrid"
          aria-hidden="true"
          style={
            {
              "--aie-grid-pad": `${BOARD_MARGIN[0]}px`,
              "--aie-grid-gap": `${BOARD_MARGIN[0]}px`,
              "--aie-grid-row": `${BOARD_ROW_H + BOARD_MARGIN[1]}px`,
            } as CSSProperties
          }
        >
          <div className="aie-board-snapgrid__mesh">
            {Array.from({ length: BOARD_COLS }, (_, i) => (
              <span key={i} className="aie-board-snapgrid__col" />
            ))}
          </div>
          <div className="aie-board-snapgrid__vignette" />
        </div>
        <GridLayout
          className="aie-grid"
          layout={
            width < 700
              ? gridLayout.reduce<Layout[]>(
                  (items, l) => [
                    ...items,
                    {
                      ...l,
                      x: 0,
                      y: items.reduce((n, p) => n + p.h, 0),
                      w: 12,
                      minW: 12,
                    },
                  ],
                  [],
                )
              : gridLayout
          }
          cols={BOARD_COLS}
          rowHeight={BOARD_ROW_H}
          margin={BOARD_MARGIN}
          containerPadding={BOARD_MARGIN}
          width={width}
          isDraggable={editMode && width >= 700}
          isResizable={editMode && width >= 700}
          resizeHandles={["se"]}
          compactType="vertical"
          onLayoutChange={width >= 700 ? syncLayoutDraft : undefined}
          onDragStart={beginInteract}
          onResizeStart={beginResize}
          onResize={syncLayoutDraft}
          onDrag={syncLayoutDraft}
          onResizeStop={endInteract}
          onDragStop={endInteract}
          draggableHandle=".aie-tile-h"
        >
          {visibleWidgets.map((w: ChartSpec) => {
            const draft = isDraftChart(w);
            // Drafts stay open while editing or running; on lock they share the add-tile exit beat.
            const draftOpen = editMode || addTileOpen || busyIds.has(w.id);
            return (
              <div
                key={w.id}
                className={
                  draft
                    ? `aie-grid-item aie-grid-item--draft${draftOpen ? " is-open" : ""}`
                    : "aie-grid-item"
                }
              >
                <ChartTile
                  spec={w}
                  editMode={editMode}
                  busy={busyIds.has(w.id)}
                  progress={tileProgress[w.id] ?? null}
                  liveTrace={liveTraces[w.id] ?? null}
                  period={period}
                  onSetPeriod={applyPeriod}
                  onRemove={() => removeWidget(w.id)}
                  onRunPrompt={(prompt) => void runPromptForTile(w.id, prompt)}
                  onStop={() => stopTile(w.id)}
                  onRevert={(version) => revertTile(w.id, version)}
                />
              </div>
            );
          })}
          {showAddTile && (
            <div
              key={ADD_TILE_ID}
              className={`aie-grid-item aie-grid-item--add${addTileOpen ? " is-open" : ""}`}
              aria-hidden={!addTileOpen}
            >
              <button
                type="button"
                className="aie-add-tile"
                onClick={addDraftTile}
                disabled={!addTileOpen || !editMode}
                tabIndex={addTileOpen && editMode ? undefined : -1}
                aria-label="Add chart"
              >
                <span className="aie-add-tile__plus" aria-hidden="true">
                  +
                </span>
                <span className="aie-add-tile__label">Add chart</span>
                <span className="aie-add-tile__hint">
                  Drop a blank chart onto your board
                </span>
              </button>
            </div>
          )}
        </GridLayout>
      </div>
    </div>
  );
}
