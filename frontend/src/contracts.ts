import type { ComponentType, ReactNode } from "react";
import type { ChartColorScale } from "./palette";
export type { ChartColorScale } from "./palette";
import type {
  BoardDocument,
  ChartSpec,
  ChartTrace,
  AgentProgress,
} from "./board/types";
export type {
  BoardDocument,
  ChartSpec,
  BoardIndex,
  ChartTrace,
  BoardLayout,
  ChartKind,
} from "./board/types";
export type QueryRow = Record<string, unknown>;
export type Period = { from: number; to: number; label: string };
export type BoardRecord = {
  id: string;
  definition: BoardDocument;
  revision: number;
};
export type WorkspaceData = {
  boards: BoardRecord[];
  archived: BoardRecord[];
  default: BoardDocument;
  preferences: { order?: string[]; active?: string };
  ai: boolean;
};
export type Starter = { id: string; title: string };
/** Every method executes in an already authorized dataset/version/user scope. */
export interface DashboardAdapter {
  loadWorkspace(): Promise<WorkspaceData>;
  createBoard(definition: BoardDocument): Promise<BoardRecord>;
  saveBoard(
    id: string,
    definition: BoardDocument,
    revision: number,
  ): Promise<{ revision: number }>;
  archiveBoard(
    id: string,
    revision: number,
    archived: boolean,
  ): Promise<{ revision: number }>;
  savePreferences(value: { order: string[]; active: string }): Promise<void>;
  query(query: string, signal: AbortSignal): Promise<QueryRow[]>;
  compose(
    input: { prompt: string; recipe?: string; current?: ChartSpec },
    signal: AbortSignal,
    events?: {
      onProgress: (value: AgentProgress) => void;
      onTrace: (trace: ChartTrace) => void;
    },
  ): Promise<{ widget: ChartSpec }>;
  /** App-owned filtering: the kit never concatenates query language fragments. */
  applyFilters?(
    query: string,
    filters: Record<string, unknown> & { period: Period | null },
  ): string;
  importDefinition?(definition: unknown): Promise<BoardDocument>;
  share?(definition: BoardDocument): Promise<void>;
}
export type EditorProps = {
  chart: ChartSpec | null;
  onSave: (chart: ChartSpec) => void;
  onClose: () => void;
};
export type ToolbarProps = {
  filters: Record<string, unknown>;
  setFilters: (next: Record<string, unknown>) => void;
};
export type ChartRenderer = (
  element: HTMLElement,
  spec: ChartSpec,
  rows: QueryRow[],
) => void | (() => void);
export type TableColumn = {
  k: string;
  label: string;
  get: (row: QueryRow) => unknown;
  fmt?: (value: any) => string;
  num?: boolean;
  dim?: string;
  exportGet?: (row: QueryRow) => unknown;
  badge?: boolean;
};
export type FieldPresentation = {
  label?: string;
  format?: (value: number) => string;
  axisFormat?: (value: number) => string;
};
export interface DashboardOptions {
  /** Stable, non-secret namespace for table preferences; include dataset/version/user. */
  namespace: string;
  queryConcurrency?: number;
  adapter: DashboardAdapter;
  starters?: Starter[];
  caption?: string;
  shareLabel?: string;
  aiDisclosure?: string;
  features?: {
    editing?: boolean;
    sharing?: boolean;
    export?: boolean;
    inspection?: boolean;
  };
  slots?: {
    Import?: ComponentType<{
      onClose: () => void;
      onImport: (definition: BoardDocument) => Promise<void>;
    }>;
    Toolbar?: ComponentType<ToolbarProps>;
    Editor?: ComponentType<EditorProps>;
    empty?: ReactNode;
  };
  /** Display labels and number formats, resolved from host-owned field metadata. */
  fieldPresentation?: (spec: ChartSpec, field: string) => FieldPresentation | undefined;
  tableColumns?: (
    spec: ChartSpec,
    rows: QueryRow[],
    defaults: TableColumn[],
  ) => TableColumn[];
  onCellAction?: (dimension: string, value: string) => void;
  /** Custom renderer takes priority over the built-in renderer for its kind. */
  renderers?: Partial<Record<ChartSpec["kind"], ChartRenderer>>;
  palette?: string[];
  categoryColors?: Array<[string, string]>;
  /** Reuse the host's category assignments, including Other. Overrides palette/categoryColors. */
  colorScale?: ChartColorScale;
  onPeriodChange?: (period: Period | null) => void;
  onSaveState?: (state: { pending: number; error?: string }) => void;
}
export interface DashboardHandle {
  flush(): Promise<void>;
  refresh(): void;
  setPeriod(period: Period | null): void;
  current(): Promise<BoardDocument | undefined>;
}
