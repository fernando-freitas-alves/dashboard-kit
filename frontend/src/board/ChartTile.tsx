import { fieldPresentation } from "./formatting";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { barChart, donut } from "../../vendor/dash-kit/js/charts.js";
import { table } from "../../vendor/dash-kit/js/table.js";
import { hideTip, showTip } from "../../vendor/dash-kit/js/tooltip.js";
import { isAbortError } from "./abort";
import { orderedSeries } from "./seriesOrder";
import { fileSlug } from "./chartText";

import { activeChartVersion, previousChartVersion } from "./chartHistory";
import { ChartTraceDialog } from "./ChartTraceDialog";
import { D3_KINDS, escapeHtml, num, str } from "./d3Charts";

import { friendlyBoardError } from "./friendlyError";
import { LoadingOrb } from "./LoadingOrb";
import {
  dayRangeFromLabel,
  formatPeriodLabel,
  type BoardPeriod,
} from "./period";
import { TileFlashTip } from "./TileFlashTip";
import {
  isDraftChart,
  type AgentProgress,
  type ChartSpec,
  type ChartTrace,
} from "./types";
import { useDashboard, type DashboardRuntime } from "../runtime";
import { feedbackClick, showFlashTip } from "../../vendor/dash-kit/js/patterns.js";

/** Same database glyph as the dashboard cards' "Show query" button. */
const ICON_definition = (
  <svg
    className="icon-motion-target icon-motion--pop"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <ellipse cx="8" cy="3.5" rx="5.5" ry="2" />
    <path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" />
    <path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
  </svg>
);

const TRACE_TIP =
  '<div class="t">How it was built</div><div class="h">Fields, filters, and how this chart was built</div>';

/** 16px stroke glyph for the prompt-bar icon buttons; `motion` picks the hover animation. */
function PromptIcon({
  motion,
  children,
}: {
  motion: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={`icon-motion-target icon-motion--${motion}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type PromptAction = "stop" | "create" | "update" | "refresh";

/** One state of the prompt-bar action button: glyph, tooltip, and accessible name. */
const PROMPT_ACTIONS: Record<
  PromptAction,
  { icon: ReactNode; label: string; hint: string }
> = {
  stop: {
    label: "Stop",
    hint: "Cancel this query; the chart stays as it was",
    icon: (
      <PromptIcon motion="pop">
        <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
      </PromptIcon>
    ),
  },
  create: {
    label: "Create chart",
    hint: "Ask AI to build a chart from this prompt",
    icon: (
      <PromptIcon motion="pop">
        <path d="M8 3v10M3 8h10" />
      </PromptIcon>
    ),
  },
  update: {
    label: "Update chart",
    hint: "Rebuild this chart from your edited prompt",
    icon: (
      <PromptIcon motion="nudge-up">
        <path d="M8 13V3M4 7l4-4 4 4" />
      </PromptIcon>
    ),
  },
  refresh: {
    label: "Rebuild chart",
    hint: "Ask AI to rebuild this chart from the same prompt",
    icon: (
      <PromptIcon motion="spin">
        <path d="M13 8a5 5 0 1 1-1.46-3.54" />
        <path d="M13 3v2.5h-2.5" />
      </PromptIcon>
    ),
  },
};

const REVERT_ICON = (
  <PromptIcon motion="nudge-left">
    <path d="M3 8a5 5 0 1 0 1.46-3.54" />
    <path d="M3 3v2.5h2.5" />
  </PromptIcon>
);

function tipHtml(title: string, hint: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div class="t">${esc(title)}</div><div class="h">${esc(hint)}</div>`;
}

/**
 * dash-kit tooltip for the prompt-bar icon buttons. Remembers which button owns
 * the tip so it can follow that button's state (Create → Stop under the cursor)
 * and never outlives it: the tip is hidden when the button or tile unmounts,
 * since no mouseleave fires then. Keyboard focus shows it; mouse-click focus doesn't.
 */
/** dash-kit fades the tip in on the next frame, so a show + hide in one frame
 *  would leave it visible; hide again after that frame when a button goes away. */
function hideTipForGone() {
  hideTip();
  requestAnimationFrame(hideTip);
}

function useButtonTip() {
  const owner = useRef<{ key: string; x: number; y: number } | null>(null);
  useEffect(
    () => () => {
      if (owner.current) hideTipForGone();
    },
    [],
  );
  const bind = (key: string, html: string) => ({
    onMouseEnter: (e: { clientX: number; clientY: number }) => {
      owner.current = { key, x: e.clientX, y: e.clientY };
      showTip(e, html);
    },
    onMouseLeave: () => {
      owner.current = null;
      hideTip();
    },
    onFocus: (e: { currentTarget: Element }) => {
      if (!e.currentTarget.matches(":focus-visible")) return;
      const r = e.currentTarget.getBoundingClientRect();
      owner.current = { key, x: r.left + r.width / 2, y: r.bottom };
      showTip({ clientX: owner.current.x, clientY: owner.current.y }, html);
    },
    onBlur: () => {
      if (owner.current?.key !== key) return;
      owner.current = null;
      hideTip();
    },
  });
  /** Re-show `key`'s tip with new copy, or hide it (`null`) when the button goes away. */
  const sync = (key: string, html: string | null) => {
    const o = owner.current;
    if (!o || o.key !== key) return;
    if (html === null) {
      owner.current = null;
      hideTipForGone();
    } else {
      showTip({ clientX: o.x, clientY: o.y }, html);
    }
  };
  return { bind, sync };
}

type Props = {
  spec: ChartSpec;
  /** When false (board locked), hide prompt editor and remove control. */
  editMode?: boolean;
  busy?: boolean;
  progress?: AgentProgress | null;
  /** Agent log for a run in flight or one that failed (not yet saved). */
  liveTrace?: ChartTrace | null;
  /** Board-wide brushed period (filters every tile’s definition). */
  period?: BoardPeriod | null;
  onSetPeriod?: (from: number, to: number, label: string) => void;
  onRemove: () => void;
  /** Run (or re-run) the agent for this tile's prompt. */
  onRunPrompt: (prompt: string) => void;
  /** Cancel this tile's running agent call (keeps the current chart). */
  onStop?: () => void;
  /** Restore a saved version, or the preceding distinct version. */
  onRevert?: (version?: number) => void;
};

/**
 * One board tile: chart body (or draft empty state), with an edit appendix
 * under the chart for the prompt while the board is unlocked.
 * Redraws on resize so tiles stay filled while dragging handles.
 */

/** Dim + blur veil over the chart body: neon ring, status, and a Stop button. */
function TileLoadingVeil({ message }: { message: string }) {
  return (
    <div className="aie-tile-loading" role="status" aria-live="polite">
      <LoadingOrb />
      <p className="aie-tile-loading__msg">{message}</p>
    </div>
  );
}

export function ChartTile({
  spec,
  editMode = true,
  busy = false,
  progress = null,
  liveTrace = null,
  period = null,
  onSetPeriod,
  onRemove,
  onRunPrompt,
  onStop,
  onRevert,
}: Props) {
  const runtime = useDashboard();
  const bodyRef = useRef<HTMLDivElement>(null);
  const tileRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<Record<string, unknown>[]>([]);
  const periodRef = useRef(period);
  const onSetPeriodRef = useRef(onSetPeriod);
  periodRef.current = period;
  onSetPeriodRef.current = onSetPeriod;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isDraftChart(spec));
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [promptDraft, setPromptDraft] = useState(spec.prompt);
  /** Set when the user stops a slow data load; cleared on the next load. */
  const [loadStopped, setLoadStopped] = useState(false);
  /** Bumped by "Run again" to re-run a stopped data load. */
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const update = () => setReloadKey((k) => k + 1);
    runtime.events.addEventListener("refresh", update);
    return () => runtime.events.removeEventListener("refresh", update);
  }, []);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [flashOpen, setFlashOpen] = useState(false);
  const [shakeTip, setShakeTip] = useState(false);
  const tipId = useId();
  const buttonTip = useButtonTip();
  const submitRef = useRef<HTMLButtonElement>(null);
  const [traceOpen, setTraceOpen] = useState(false);

  useEffect(() => {
    if (progress?.phase === "done" && progress.message && submitRef.current)
      showFlashTip(submitRef.current, progress.message);
  }, [progress]);

  const draft = isDraftChart(spec);
  const canInspect =
    runtime.options.features?.inspection !== false &&
    (!draft || Boolean(liveTrace));
  const promptDirty = promptDraft.trim() !== (spec.prompt || "").trim();
  const canRun = Boolean(promptDraft.trim()) && !busy;
  /** Revert first undoes unsent prompt edits, then the last agent change. */
  const revertText = promptDirty && Boolean(spec.prompt?.trim());
  const version = activeChartVersion(spec);
  const previous = previousChartVersion(spec);
  const revertChart = !revertText && Boolean(previous) && !draft;
  const showRevert = !busy && (revertText || revertChart);

  const agentError =
    progress?.phase === "error" && progress.message ? progress.message : null;
  const displayError = agentError ?? error;

  const agentWorking =
    busy &&
    (!progress ||
      (progress.phase !== "idle" &&
        progress.phase !== "error" &&
        progress.phase !== "done"));
  const showLoading = agentWorking || (!draft && loading);
  const loadingMessage = agentWorking
    ? progress?.message || "Working…"
    : "Loading data…";
  /** Stop while the agent works or the chart's data loads; otherwise run the prompt. */
  const action: PromptAction = showLoading
    ? "stop"
    : draft
      ? "create"
      : promptDirty
        ? "update"
        : "refresh";
  const actionMeta = PROMPT_ACTIONS[action];
  /** The prompt bar stays open during a run so Stop is reachable on a locked board. */
  const barOpen = editMode || agentWorking;
  const actionEnabled =
    action === "stop"
      ? agentWorking
        ? Boolean(onStop)
        : true
      : editMode && canRun;

  rowsRef.current = rows;

  useEffect(() => {
    setPromptDraft(spec.prompt);
  }, [spec.id, spec.prompt]);

  /** Shake + tip on the tile when agent or data load fails (skill-ladder pattern). */
  useEffect(() => {
    if (!displayError) {
      setFlashOpen(false);
      setShakeTip(false);
      return;
    }
    setFlashOpen(true);
    setShakeTip(false);
    const btn = submitRef.current;
    const kick = window.requestAnimationFrame(() => {
      setShakeTip(true);
      if (btn) {
        btn.classList.remove("btn-shake");
        void btn.offsetWidth;
        btn.classList.add("btn-shake");
      }
    });
    const clearShake = window.setTimeout(() => setShakeTip(false), 280);
    const clearTip = window.setTimeout(() => setFlashOpen(false), 4800);
    return () => {
      window.cancelAnimationFrame(kick);
      window.clearTimeout(clearShake);
      window.clearTimeout(clearTip);
    };
  }, [displayError, progress?.attentionKey]);

  useEffect(() => {
    if (draft) {
      setLoading(false);
      setRows([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setLoading(true);
    setLoadStopped(false);
    setError(null);
    const query =
      runtime.adapter.applyFilters?.(spec.query, {
        ...runtime.filters,
        period,
      }) ?? spec.query;
    void runtime
      .query(query, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setRows(data);
        setLoading(false);
      })
      .catch((e) => {
        if (isAbortError(e)) {
          // Stop pressed (not an effect re-run, which starts a fresh load).
          if (loadAbortRef.current === controller) {
            setRows([]);
            setLoading(false);
            setLoadStopped(true);
          }
          return;
        }
        if (controller.signal.aborted) return;
        setError(friendlyBoardError(e));
        setLoading(false);
      });
    return () => {
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
      controller.abort();
    };
  }, [spec.query, spec.updatedAt, draft, period?.from, period?.to, reloadKey]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || draft || loading || error || loadStopped) return;

    let raf = 0;
    let lastW = -1;
    let lastH = -1;
    let cleanup: void | (() => void);

    const draw = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w < 8 || h < 8) return;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      hideTip();
      if (typeof cleanup === "function") cleanup();
      el.innerHTML = "";
      el.classList.remove("ldk-chart-axes");
      try {
        cleanup = renderChart(runtime, el, spec, rowsRef.current, {
          period: periodRef.current,
          onSetPeriod: (from, to, label) => {
            onSetPeriodRef.current?.(from, to, label);
          },
          onClearPeriod: () => {
            const p = periodRef.current;
            if (p) onSetPeriodRef.current?.(p.from, p.to, p.label);
          },
        });
      } catch (e) {
        setError(friendlyBoardError(e));
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    if (tileRef.current) ro.observe(tileRef.current);
    const fontsChanged = () => {
      lastW = -1;
      schedule();
    };
    document.fonts?.addEventListener("loadingdone", fontsChanged);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.fonts?.removeEventListener("loadingdone", fontsChanged);
      if (typeof cleanup === "function") cleanup();
    };
  }, [
    rows,
    loading,
    error,
    loadStopped,
    spec,
    draft,
    period?.from,
    period?.to,
  ]);

  const run = () => {
    if (!canRun) {
      if (submitRef.current)
        feedbackClick(submitRef.current, {
          canAct: false,
          blockedMessage: "Describe a chart first.",
          onAction: () => {},
        });
      return;
    }
    onRunPrompt(promptDraft.trim());
  };

  const revert = () => {
    if (revertText) setPromptDraft(spec.prompt);
    else if (revertChart) onRevert?.(previous?.version);
  };

  const revertLabel = revertText ? "Undo prompt edits" : `Restore v${previous?.version}`;
  const revertHint = revertText
    ? "Put back the saved prompt"
    : previous
      ? `${previous.title} · ${previous.kind}`
      : "";

  const actionTip = tipHtml(actionMeta.label, actionMeta.hint);
  const revertTip = showRevert ? tipHtml(revertLabel, revertHint) : null;
  useEffect(
    () => buttonTip.sync("action", barOpen ? actionTip : null),
    [actionTip, barOpen],
  );
  useEffect(() => buttonTip.sync("revert", revertTip), [revertTip]);

  const onAction = () => {
    if (!actionEnabled) {
      if (submitRef.current)
        feedbackClick(submitRef.current, {
          canAct: false,
          blockedMessage: "Describe a chart first.",
          onAction: () => {},
        });
      return;
    }
    if (action === "stop") {
      if (agentWorking) onStop?.();
      else loadAbortRef.current?.abort();
      return;
    }
    run();
  };

  return (
    <article
      className={`aie-tile${draft ? " aie-tile--draft" : ""}`}
      ref={tileRef}
    >
      <header className="aie-tile-h">
        <div className="aie-tile-titles">
          {canInspect && (
            <button
              type="button"
              className="qbtn icon-motion aie-tile-qbtn"
              aria-label={`How “${draft ? "New chart" : spec.title}” was built: details and definition`}
              aria-haspopup="dialog"
              onClick={() => {
                hideTip();
                setTraceOpen(true);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onMouseEnter={(e) => showTip(e, TRACE_TIP)}
              onMouseLeave={hideTip}
              onBlur={hideTip}
            >
              {ICON_definition}
            </button>
          )}
          <h3>{draft ? "New chart" : spec.title}</h3>
          {editMode && !draft && canInspect && (
            <button type="button" className="aie-tile-version"
              aria-label={`Chart version ${version}. View history`}
              aria-haspopup="dialog"
              onPointerDown={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setTraceOpen(true)}>
              <span aria-live="polite">v{version}</span>
            </button>
          )}
        </div>
        {editMode && (
          <div className="aie-tile-actions">
            {!draft && runtime.options.slots?.Editor && (
              <button
                type="button"
                className="qbtn"
                aria-label={`Edit ${spec.title} fields`}
                title="Choose fields"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  runtime.events.dispatchEvent(
                    new CustomEvent("edit-chart", { detail: spec }),
                  )
                }
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m10 2 4 4-8 8H2v-4Z M8 4l4 4" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="aie-tile-x"
              aria-label={draft ? "Remove draft chart" : `Remove ${spec.title}`}
              onClick={onRemove}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </button>
          </div>
        )}
      </header>

      <div className={`aie-tile-b${showLoading ? " is-loading" : ""}`}>
        {draft && editMode && !showLoading && (
          <div className="aie-tile-draft">
            <p className="aie-muted">
              Write a prompt below, or pick a starter:
            </p>
            <ul className="aie-tile-recipes">
              {(runtime.options.starters || []).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="aie-chip"
                    disabled={busy}
                    onClick={() => {
                      setPromptDraft(r.title.toLowerCase());
                      onRunPrompt(r.title.toLowerCase());
                    }}
                  >
                    {r.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {draft && !editMode && !showLoading && (
          <p className="aie-muted">Unlock the board to finish this chart.</p>
        )}
        {!draft && error && !showLoading && (
          <p className="aie-muted">Couldn’t load this chart’s data.</p>
        )}
        {!draft && loadStopped && !showLoading && (
          <div className="aie-tile-stopped">
            <p className="aie-muted">Query stopped.</p>
            <button
              type="button"
              className="aie-btn"
              onClick={() => setReloadKey((k) => k + 1)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              Run again
            </button>
          </div>
        )}
        {!draft && !error && !loadStopped && (
          <div className="aie-tile-chart chart" ref={bodyRef} />
        )}
        {showLoading && <TileLoadingVeil message={loadingMessage} />}
        {displayError && !showLoading && (
          <p className="ldk-chart-error" role="alert">
            {displayError}
          </p>
        )}
      </div>

      <footer
        ref={promptRef}
        className={`aie-tile-appendix${barOpen ? " is-open" : ""}`}
        aria-hidden={!barOpen}
        aria-describedby={flashOpen && displayError ? tipId : undefined}
      >
        <div className="aie-tile-appendix__inner">
          <form
            className="aie-tile-prompt"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <input
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              placeholder="Describe this chart…"
              disabled={busy || !editMode}
              tabIndex={editMode ? undefined : -1}
              aria-label="Chart prompt"
              aria-invalid={Boolean(displayError)}
              aria-describedby={flashOpen && displayError ? tipId : undefined}
            />
            {showRevert && (
              <button
                type="button"
                className="aie-btn aie-icon-btn aie-tile-revert icon-motion"
                onClick={revert}
                aria-disabled={!editMode}
                tabIndex={editMode ? undefined : -1}
                aria-label={`${revertLabel}. ${revertHint}`}
                {...buttonTip.bind("revert", revertTip ?? "")}
              >
                {REVERT_ICON}
              </button>
            )}
            {/* Always type="button": a submit button that turns into Stop mid-click
                would submit the form again right after stopping. */}
            <button
              ref={submitRef}
              type="button"
              className={`aie-btn aie-icon-btn icon-motion ${action === "stop" ? "is-stop" : "primary"}`}
              onClick={onAction}
              aria-disabled={!barOpen}
              tabIndex={barOpen ? undefined : -1}
              aria-label={`${actionMeta.label}. ${actionMeta.hint}`}
              {...buttonTip.bind("action", actionTip)}
            >
              {actionMeta.icon}
            </button>
          </form>
        </div>
      </footer>

      <TileFlashTip
        anchorRef={submitRef}
        id={tipId}
        open={Boolean(flashOpen && displayError)}
        shake={shakeTip}
      >
        {displayError}
      </TileFlashTip>

      <ChartTraceDialog
        open={traceOpen}
        onClose={() => setTraceOpen(false)}
        spec={spec}
        liveTrace={liveTrace}
        period={period}
        onRestore={editMode && !busy ? onRevert : undefined}
      />
    </article>
  );
}

const isNumeric = (v: unknown) =>
  typeof v === "number" ||
  (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));

/**
 * dash-kit table columns for arbitrary definition rows: a column is numeric (right
 * aligned, numeric sort, formatted) when every non-empty value parses as a
 * number, so Trino decimals that arrive as strings still sort correctly.
 */
function tableColumns(rows: Record<string, unknown>[], spec: ChartSpec, runtime: DashboardRuntime) {
  return Object.keys(rows[0])
    .filter((k) => !k.startsWith("_"))
    .map((k) => {
      const filled = rows.filter((r) => r[k] != null && r[k] !== "");
      const numeric = filled.length > 0 && filled.every((r) => isNumeric(r[k]));
      return numeric
        ? {
            k,
            label: fieldPresentation(runtime.options.fieldPresentation, spec, k).label,
            num: true,
            get: (r: Record<string, unknown>) =>
              r[k] == null || r[k] === "" ? null : Number(r[k]),
            fmt: fieldPresentation(runtime.options.fieldPresentation, spec, k).format,
          }
        : {
            k,
            label: fieldPresentation(runtime.options.fieldPresentation, spec, k).label,
            get: (r: Record<string, unknown>) =>
              r[k] == null ? null : str(r[k]),
          };
    });
}

/**
 * Draw `rows` as `spec.kind`. Bar/area go through dash-kit's bar chart (dates
 * brush the board period); kpi/table/donut are inline; the rest are d3
 * renderers. Colours come from the page palette so tiles match the dashboard.
 */
function renderChart(
  runtime: DashboardRuntime,
  el: HTMLElement,
  spec: ChartSpec,
  rows: Record<string, unknown>[],
  opts: {
    period: BoardPeriod | null;
    onSetPeriod: (from: number, to: number, label: string) => void;
    onClearPeriod: () => void;
  },
) {
  const custom = runtime.options.renderers?.[spec.kind];
  if (custom) return custom(el, spec, rows);
  const { renderD3Chart, categoryColor, primaryColor } = runtime.charts;
  const m = spec.mapping;
  const timeLine = spec.kind === "line" && rows.length > 0 && rows.every(row => dayRangeFromLabel(str(row[m.x || "x"])));
  if (D3_KINDS.has(spec.kind) && !timeLine) {
    renderD3Chart(el, spec, rows);
    return;
  }

  if (spec.kind === "kpi") {
    const key = m.value || "value";
    const label = spec.title;
    const value = rows[0] ? num(rows[0][key]) : 0;
    const text = rows[0]?.[key] == null ? "—" : fieldPresentation(runtime.options.fieldPresentation, spec, key).format(value);
    el.innerHTML = `<div class="aie-kpi"><div class="aie-kpi-v" style="--kpi-chars:${Math.max(3, text.length)}">${escapeHtml(text)}</div><div class="aie-kpi-l">${escapeHtml(String(label))}</div></div>`;
    return;
  }

  if (spec.kind === "table") {
    if (!rows.length) {
      el.innerHTML = `<p class="aie-muted">No rows</p>`;
      return;
    }
    table(el, {
      cols:
        runtime.options.tableColumns?.(spec, rows, tableColumns(rows, spec, runtime)) ??
        tableColumns(rows, spec, runtime),
      onDimensionClick: runtime.options.onCellAction,
      exportEnabled: runtime.options.features?.export !== false,
      rows,
      sel: new Set(),
      pageSize: 25,
      csv: fileSlug(spec.title) || "board_table",
      persist: `${runtime.options.namespace}:tile:${spec.id}`,
    });
    return;
  }

  if (spec.kind === "donut") {
    const labelKey = m.label || "label";
    const valueKey = m.value || "value";
    const items = rows.map((r, i) => {
      const key = str(r[labelKey]) || `r${i}`;
      return {
        key,
        label: str(r[labelKey]) || `Row ${i + 1}`,
        value: num(r[valueKey]),
        color: categoryColor(labelKey, key),
      };
    });
    donut(el, {
      items,
      sel: new Set(),
      metric: fieldPresentation(runtime.options.fieldPresentation, spec, valueKey).label,
      valueFmt: fieldPresentation(runtime.options.fieldPresentation, spec, valueKey).format,
      interactive: false,
      center: items.reduce((a, b) => a + b.value, 0),
      onClick: () => {},
    });
    return;
  }

  const xKey = m.x || "x";
  const yKey = m.y || "y";
  const seriesKey = m.series;
  // One bucket per distinct x (rows are long-format when `series` is set).
  const xKeys: string[] = [];
  const cells = new Map<string, Map<string, number>>();
  const seriesTotals = new Map<string, number>();
  rows.forEach((r, i) => {
    const xk = str(r[xKey]) || `b${i}`;
    const sk = seriesKey ? str(r[seriesKey]) || "(blank)" : "v";
    const v = num(r[yKey]);
    if (!cells.has(xk)) {
      xKeys.push(xk);
      cells.set(xk, new Map());
    }
    const at = cells.get(xk)!;
    at.set(sk, (at.get(sk) ?? 0) + v);
    seriesTotals.set(sk, (seriesTotals.get(sk) ?? 0) + Math.abs(v));
  });

  const parsed = xKeys.map((key) => ({ key, range: dayRangeFromLabel(key, m.timeUnit) }));
  const isTimeSeries = parsed.length > 0 && parsed.every((p) => p.range);
  if (isTimeSeries) parsed.sort((a, b) => a.range!.from - b.range!.from);

  const buckets = parsed.map((p, i) => {
    if (p.range) {
      const dayLabel = formatPeriodLabel(p.range.from, p.range.to) || p.key;
      return {
        key: p.key,
        label: dayLabel,
        short: dayLabel,
        from: p.range.from,
        to: p.range.to,
        weekend: false,
      };
    }
    return {
      key: p.key,
      label: p.key,
      short: p.key,
      from: i,
      to: i + 1,
      weekend: false,
    };
  });

  // Biggest series first; past the cap the tail rolls into "Other", as on the dashboard.
  const MAX_SERIES = 10;
  const ranked = orderedSeries(seriesTotals, spec.mapping.seriesOrder);
  const kept =
    ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
  const rolled = new Set(ranked.slice(kept.length));
  const series = seriesKey
    ? [
        ...kept.map((k) => ({
          key: k,
          label: k,
          color: categoryColor(seriesKey, k),
        })),
        ...(rolled.size
          ? [
              {
                key: "__other",
                label: "Other",
                color: categoryColor(seriesKey, "__other"),
              },
            ]
          : []),
      ]
    : [{ key: "v", label: spec.title, color: primaryColor() }];
  const valueAt = (bi: number, si: number) => {
    const at = cells.get(buckets[bi].key);
    const s = series[si];
    if (!at || !s) return 0;
    if (s.key !== "__other") return at.get(s.key) ?? 0;
    let sum = 0;
    for (const k of rolled) sum += at.get(k) ?? 0;
    return sum;
  };

  const selBuckets = new Set<string>();
  if (opts.period && isTimeSeries) {
    for (const b of buckets) {
      if (b.from < opts.period.to && b.to > opts.period.from) {
        selBuckets.add(b.key);
      }
    }
  }

  const applyPeriod = (from: number, to: number, label: string) => {
    opts.onSetPeriod(from, to, formatPeriodLabel(from, to) || label);
  };

  barChart(el, {
    buckets,
    series,
    val: valueAt,
    stacked: spec.kind === "line" ? false : seriesKey ? m.stacked !== false : false,
    mode: spec.kind === "area" ? "area" : spec.kind === "line" ? "line" : "bar",

    yFmt: fieldPresentation(runtime.options.fieldPresentation, spec, yKey).axisFormat,
    tipFmt: fieldPresentation(runtime.options.fieldPresentation, spec, yKey).format,
    sel: { bucket: selBuckets, series: new Set() },
    brush: isTimeSeries,
    bucketNoun: isTimeSeries ? "this period" : "this category",
    onBucket: isTimeSeries
      ? (b: { from: number; to: number; label: string }) => {
          applyPeriod(b.from, b.to, b.label);
        }
      : undefined,
    onRange: isTimeSeries
      ? (from: number, to: number, label: string) => {
          applyPeriod(from, to, label);
        }
      : undefined,
    onClearRange: isTimeSeries
      ? () => {
          opts.onClearPeriod();
        }
      : undefined,
    showTotal: true,
  });
}
