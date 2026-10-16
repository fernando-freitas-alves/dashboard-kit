import { createQueryPool } from "./queryPool";
import { createRenderers } from "./board/d3Charts";
import { createContext, useContext } from "react";
import type { DashboardOptions, Period } from "./contracts";
import { createBoardStore } from "./store";
export function createRuntime(options: DashboardOptions) {
  const runtime = {
    query: createQueryPool(
      options.adapter.query,
      options.queryConcurrency ?? 4,
    ),
    charts: createRenderers(options.palette, options.categoryColors, options.colorScale, options.fieldPresentation),
    options,
    adapter: options.adapter,
    events: new EventTarget(),
    filters: {} as Record<string, unknown>,
    period: null as Period | null,
    rootId: `dashboard-${crypto.randomUUID()}`,
    store: null as unknown as ReturnType<typeof createBoardStore>,
  };
  runtime.store = createBoardStore(options.adapter, (state) => {
    options.onSaveState?.(state);
    runtime.events.dispatchEvent(new CustomEvent("save", { detail: state }));
  });
  return runtime;
}
export type DashboardRuntime = ReturnType<typeof createRuntime>;
export const DashboardContext = createContext<DashboardRuntime | null>(null);
export function useDashboard() {
  const runtime = useContext(DashboardContext);
  if (!runtime) throw Error("Dashboard components need DashboardProvider.");
  return runtime;
}
