/** Layout cell on the 12-column board grid (react-grid-layout units). */
export type BoardLayout = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
};

/**
 * Chart kinds the agent may pick. `bar`/`area` go through dash-kit's bar
 * chart (brushable dates); the d3 kinds live in `d3Charts.ts`. Hosts validate supported kinds in their data adapter.
 */
export type ChartKind =
  | "bar"
  | "area"
  | "line"
  | "hbar"
  | "scatter"
  | "heatmap"
  | "treemap"
  | "map"
  | "donut"
  | "kpi"
  | "table";

export const CHART_KINDS: readonly ChartKind[] = [
  "bar",
  "area",
  "line",
  "hbar",
  "scatter",
  "heatmap",
  "treemap",
  "map",
  "donut",
  "kpi",
  "table",
];

/**
 * Saved chart definition produced by the board agent.
 * Draft tiles have `status: "draft"` and empty `query` until the user runs a prompt.
 * definition results are never persisted — only the spec + layout.
 */
export type ChartSpec = {
  id: string;
  title: string;
  prompt: string;
  kind: ChartKind;
  /** Host-validated query. Empty while draft. */
  query: string;
  /** Column names the renderer expects from definition rows (plus a few display options). */
  mapping: {
    x?: string;
    y?: string;
    /** Splits rows into coloured series (bar/area/line/scatter) or groups (treemap). */
    series?: string;
    label?: string;
    value?: string;
    /** Map: country or US-state column (names or ISO / postal codes). */
    region?: string;
    /** Map bubbles: latitude / longitude columns (instead of `region`). */
    lat?: string;
    lon?: string;
    /** Scatter / map bubbles: column that sizes each dot. */
    size?: string;
    /** Map extent; inferred from the region values when omitted. */
    scope?: "world" | "usa";
    /** Multi-series bar/area: stack (default) or place side by side. */
    stacked?: boolean;
    /** Domain order for ordinal scales; otherwise series rank by volume. */
    seriesOrder?: string[];
  };
  /** `draft` = empty tile waiting for a prompt; `ready` = has definition. */
  status: "draft" | "ready";
  createdAt: number;
  updatedAt: number;
  /** Preceding distinct version; retained for older consumers. */
  previous?: ChartRevision;
  /** Active chart version; independent of the board's save revision. */
  version?: number;
  /** Retained chart versions, excluding the active version. */
  history?: ChartRevision[];
  /** How the agent built this chart (saved trimmed; absent on older charts). */
  trace?: ChartTrace;
};

/** One entry in an agent run log, in the order it happened. */
export type ChartTraceStep =
  /** A short user-facing build explanation. */
  | { type: "text"; text: string }
  /** An exploratory `execute_query` call and what it returned. */
  | {
      type: "query";
      query: string;
      ms?: number;
      rowCount?: number;
      /** First few rows, values stringified and truncated. */
      sample?: Record<string, string>[];
      error?: string;
      running?: boolean;
    }
  /** The `finalize_chart` call (its definition is validated before the chart saves). */
  | {
      type: "finalize";
      title: string;
      kind: string;
      query: string;
      ms?: number;
      error?: string;
      running?: boolean;
    };

/**
 * Record of one prompt → chart run. Live copies update while the agent works;
 * the saved copy on `ChartSpec.trace` is only written when the run succeeds.
 */
export type ChartTrace = {
  /** `recipe` = built-in recipe fallback (no OpenAI key configured). */
  source: "agent" | "recipe";
  model?: string;
  prompt: string;
  status: "running" | "done" | "failed";
  /** Plain-language failure copy when `status` is `failed`. */
  error?: string;
  startedAt: number;
  finishedAt?: number;
  steps: ChartTraceStep[];
};

/** A saved chart definition with its prompt and build details. */
export type ChartRevision = Pick<
  ChartSpec,
  "title" | "prompt" | "kind" | "query" | "mapping" | "updatedAt" | "trace" | "version"
>;

/** Snapshot the agent-owned fields of a ready chart for a later Revert. */
export function toRevision(spec: ChartSpec): ChartRevision {
  return {
    title: spec.title,
    prompt: spec.prompt,
    kind: spec.kind,
    query: spec.query,
    mapping: { ...spec.mapping },
    updatedAt: spec.updatedAt,
    trace: spec.trace,
    version: spec.version,
  };
}

export type BoardDocument = {
  v: 2;
  name: string;
  locked?: boolean;
  widgets: ChartSpec[];
  layouts: BoardLayout[];
  updatedAt: number;
};

/** The viewer's board tabs (order = tab order) and the one last opened. */
export type BoardIndex = {
  v: 1;
  active: string;
  boards: { id: string; name: string; createdAt: number }[];
};

export type AgentProgress = {
  phase: "idle" | "thinking" | "querying" | "composing" | "error" | "done";
  /** Plain-language status or error copy for the tile. */
  message: string;
  /** Bumps so identical error copy still re-triggers shake + tip. */
  attentionKey?: number;
};

/** True when the tile still needs an agent run. */
export function isDraftChart(spec: ChartSpec): boolean {
  return spec.status === "draft" || !spec.query?.trim();
}
