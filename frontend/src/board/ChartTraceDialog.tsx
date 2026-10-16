import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { type BoardPeriod } from "./period";
import { useDashboard } from "../runtime";
import { activeChartVersion, chartVersions } from "./chartHistory";
import { useQdlg } from "./useQdlg";
import type { ChartSpec, ChartTrace, ChartTraceStep } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  spec: ChartSpec;
  /** In-flight or failed run for this tile (session only). */
  liveTrace: ChartTrace | null;
  period: BoardPeriod | null;
  onRestore?: (version: number) => void;
};

/**
 * "How this chart was built": chart definition (copyable, plus the board-period
 * variant that actually runs) and the agent log — AI's replies, each
 * exploratory query with its result, and the finalize call. Uses the
 * dashboard's `qdlg` query dialog styling so it matches "Show query" on cards.
 */
export function ChartTraceDialog({
  open,
  onClose,
  spec,
  liveTrace,
  period,
  onRestore,
}: Props) {
  const runtime = useDashboard();
  const { ref, mounted } = useQdlg(open);

  if (!mounted) return null;

  const saved = spec.trace ?? null;
  const finalDefinition = spec.status === "ready" ? spec.query.trim() : "";
  const runDefinition = finalDefinition
    ? (
        runtime.adapter.applyFilters?.(finalDefinition, {
          ...runtime.filters,
          period,
        }) ?? finalDefinition
      ).trim()
    : "";
  const prompt = liveTrace?.prompt || saved?.prompt || spec.prompt;
  const title = spec.status === "ready" ? spec.title : "New chart";

  return createPortal(
    <dialog
      ref={ref}
      className="qdlg aie-trace-dlg ldk-surface ldk-dialog"
      aria-labelledby={`aie-trace-${spec.id}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
      // Portal events still bubble through React to the draggable grid item.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="qd-h">
        <h3 id={`aie-trace-${spec.id}`}>{title} — chart details</h3>
        <button
          type="button"
          className="btn icon-motion"
          aria-label="Close"
          onClick={onClose}
        >
          <span
            className="icon-motion-target icon-motion--wiggle"
            aria-hidden="true"
          >
            ✕
          </span>{" "}
          Close
        </button>
      </div>
      <div className="qd-b">
        {spec.status === "ready" && (
          <section className="aie-chart-history" aria-label="Chart versions">
            <h4>Version history <span className="aie-muted">· v{activeChartVersion(spec)} active</span></h4>
            {chartVersions(spec).length === 1 ? <p className="aie-muted">No earlier versions saved.</p> : (
              <ul>{chartVersions(spec).reverse().map(revision => (
                <li key={revision.version}>
                  <div><b>v{revision.version} · {revision.title}</b>
                    <span className="aie-muted">{revision.kind} · {formatWhen(revision.updatedAt)}</span>
                  </div>
                  {revision.version === activeChartVersion(spec) ? <span className="aie-version-active" role="status">Active</span>
                    : onRestore && <button className="aie-btn" type="button" onClick={() => onRestore(revision.version!)}>Restore v{revision.version}</button>}
                </li>
              ))}</ul>
            )}
          </section>
        )}
        {prompt && (
          <div className="qd-logic">
            <b>Prompt:</b> {prompt}
            {saved && !liveTrace && <TraceMeta trace={saved} />}
          </div>
        )}

        {finalDefinition && (
          <div className="qd-src">
            <div className="qd-src-h">
              <b>Chart definition</b>
              <span className="meta">
                v{activeChartVersion(spec)} · {spec.kind} chart · saved {formatWhen(spec.updatedAt)}
              </span>
              <CopyButton text={finalDefinition} />
            </div>
            <pre>{highlightSql(finalDefinition)}</pre>
            {runDefinition !== finalDefinition && (
              <details className="aie-trace-details">
                <summary>
                  As it runs now, with active filters
                  {period?.label ? ` (${period.label})` : ""}
                </summary>
                <SqlBlock query={runDefinition} />
              </details>
            )}
          </div>
        )}

        {liveTrace && (
          <section className="aie-trace-section">
            <h4>
              {liveTrace.status === "running"
                ? "Running now"
                : liveTrace.status === "failed"
                  ? "Last attempt didn’t finish"
                  : "Latest run"}
              <TraceMeta trace={liveTrace} />
            </h4>
            {liveTrace.status === "failed" && liveTrace.error && (
              <p className="aie-trace-error">{liveTrace.error}</p>
            )}
            {liveTrace.status === "failed" && finalDefinition && (
              <p className="aie-muted aie-trace-note">
                The chart on the board still shows its previous version.
              </p>
            )}
            <TraceLog trace={liveTrace} />
          </section>
        )}

        {saved &&
          (liveTrace ? (
            <details className="aie-trace-details aie-trace-section">
              <summary>Log for the chart on the board</summary>
              <TraceLog trace={saved} />
            </details>
          ) : (
            <section className="aie-trace-section">
              <h4>Build details</h4>
              <TraceLog trace={saved} />
            </section>
          ))}

        {!saved && !liveTrace && finalDefinition && (
          <p className="aie-muted aie-trace-note">
            No build details recorded for this chart.
          </p>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

function TraceMeta({ trace }: { trace: ChartTrace }) {
  const who =
    trace.source === "recipe"
      ? "built-in recipe"
      : trace.model
        ? `AI (${trace.model})`
        : "AI";
  const took =
    trace.finishedAt != null
      ? ` · ${((trace.finishedAt - trace.startedAt) / 1000).toFixed(1)}s`
      : "";
  return (
    <span className="aie-trace-meta">
      {who} · {formatWhen(trace.startedAt)}
      {took}
    </span>
  );
}

function TraceLog({ trace }: { trace: ChartTrace }) {
  if (!trace.steps.length) {
    return (
      <p className="aie-muted aie-trace-note">
        {trace.status === "running" ? "Waiting for AI…" : "No steps logged."}
      </p>
    );
  }
  return (
    <ol className="aie-trace-log">
      {trace.steps.map((step, i) => (
        <TraceStepItem key={i} step={step} />
      ))}
    </ol>
  );
}

function TraceStepItem({ step }: { step: ChartTraceStep }) {
  if (step.type === "text") {
    return (
      <li className="aie-trace-step is-text">
        <span className="aie-trace-who">AI</span>
        <p>{step.text}</p>
      </li>
    );
  }

  const status = step.running
    ? "running…"
    : step.error
      ? "failed"
      : step.type === "query"
        ? `${step.rowCount ?? 0} row${step.rowCount === 1 ? "" : "s"}`
        : "validated";
  const ms = step.ms != null ? ` · ${(step.ms / 1000).toFixed(1)}s` : "";

  return (
    <li
      className={`aie-trace-step is-${step.type}${step.error ? " is-error" : ""}${step.running ? " is-running" : ""}`}
    >
      <span className="aie-trace-who">
        {step.type === "query" ? "Query" : "Chart"}
      </span>
      <div className="aie-trace-body">
        <div className="qd-src-h">
          <b>
            {step.type === "query"
              ? "Explored the data"
              : `Saved “${step.title}” (${step.kind})`}
          </b>
          <span className="meta">
            {status}
            {ms}
          </span>
        </div>
        {step.error && <p className="aie-trace-error">{step.error}</p>}
        <details className="aie-trace-details qd-src">
          <summary>definition</summary>
          <SqlBlock query={step.query} />
        </details>
        {step.type === "query" && step.sample && step.sample.length > 0 && (
          <SampleTable rows={step.sample} total={step.rowCount} />
        )}
      </div>
    </li>
  );
}

function SampleTable({
  rows,
  total,
}: {
  rows: Record<string, string>[];
  total?: number;
}) {
  const cols = Object.keys(rows[0] ?? {});
  if (!cols.length) return null;
  return (
    <div className="aie-trace-sample">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{r[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total != null && total > rows.length && (
        <p className="aie-muted">
          First {rows.length} of {total.toLocaleString()} rows AI saw.
        </p>
      )}
    </div>
  );
}

/** Highlighted definition with a Copy button pinned to its top-right corner. */
export function SqlBlock({ query }: { query: string }) {
  return (
    <div className="aie-trace-query">
      <CopyButton text={query} />
      <pre>{highlightSql(query)}</pre>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy definition");
  useEffect(() => {
    if (label === "Copy definition") return;
    const t = window.setTimeout(() => setLabel("Copy definition"), 1500);
    return () => window.clearTimeout(t);
  }, [label]);
  return (
    <button
      type="button"
      className="btn qd-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setLabel("Copied ✓");
        } catch {
          setLabel("Copy failed");
        }
      }}
    >
      {label}
    </button>
  );
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const definition_KEYWORDS = new Set(
  (
    "SELECT FROM WHERE AND OR NOT IN AS ON JOIN LEFT RIGHT FULL INNER OUTER CROSS " +
    "UNION ALL DISTINCT GROUP BY ORDER WITH CASE WHEN THEN ELSE END OVER PARTITION " +
    "BETWEEN LIMIT IS NULL DATE INTERVAL UNNEST CAST COALESCE NULLIF COUNT SUM MIN " +
    "MAX AVG DESC ASC HAVING LIKE ILIKE TRUE FALSE DATE_TRUNC DATE_DIFF DATE_ADD " +
    "CURRENT_DATE CURRENT_TIMESTAMP ROUND LOWER UPPER APPROX_DISTINCT FILTER ROWS"
  ).split(" "),
);

/** Token-level definition colouring as React nodes (no innerHTML, so model definition can't inject markup). */
function highlightSql(query: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|\b(\d+(?:\.\d+)?)\b|([A-Za-z_][A-Za-z0-9_]*)/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(query); m; m = re.exec(query)) {
    if (m.index > last) out.push(query.slice(last, m.index));
    const [tok, comment, str, num, word] = m;
    const cls = comment
      ? "cm"
      : str
        ? "str"
        : num
          ? "num"
          : word && definition_KEYWORDS.has(word.toUpperCase())
            ? "kw"
            : null;
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {tok}
        </span>
      ) : (
        tok
      ),
    );
    last = re.lastIndex;
  }
  if (last < query.length) out.push(query.slice(last));
  return out;
}
