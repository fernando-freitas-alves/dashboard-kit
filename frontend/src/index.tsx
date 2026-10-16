import { forwardRef, useImperativeHandle, useState } from "react";
import { DashboardContext, createRuntime } from "./runtime";
import { BoardWorkspace, SharedBoard } from "./workspace";
import type {
  DashboardOptions,
  DashboardHandle,
  BoardDocument,
} from "./contracts";
export * from "./contracts";
export { CHART_KINDS } from "./board/types";
export { DashboardDialog } from "./workspace";
export { useQdlg } from "./board/useQdlg";
export { useDashboard } from "./runtime";
export { createBoardStore } from "./store";
export { createPalette, GOOGLE_CHARTS_PALETTE } from "./palette";
import { feedbackClick } from "../vendor/dash-kit/js/patterns.js";
export { feedbackClick };
export const feedback = (anchor: HTMLElement, message: string) =>
  feedbackClick(anchor, {
    canAct: false,
    blockedMessage: message,
    onAction: () => {},
  });
export const Dashboard = forwardRef<
  DashboardHandle,
  {
    options: DashboardOptions;
    shared?: { board: BoardDocument; widgets: unknown[] };
  }
>(function Dashboard({ options, shared }, ref) {
  const [runtime] = useState(() => createRuntime(options));
  useImperativeHandle(
    ref,
    () => ({
      flush: runtime.store.flush,
      current: runtime.store.current,
      setPeriod: (period) => {
        runtime.period = period;
        runtime.events.dispatchEvent(new Event("period"));
      },
      refresh: () => runtime.events.dispatchEvent(new Event("refresh")),
    }),
    [runtime],
  );
  return (
    <DashboardContext.Provider value={runtime}>
      <div className="ldk-surface" id={runtime.rootId}>
        {shared ? <SharedBoard data={shared} /> : <BoardWorkspace />}
      </div>
    </DashboardContext.Provider>
  );
});

export { SqlBlock } from "./board/ChartTraceDialog";
export { createHttpAdapter } from "./http";
