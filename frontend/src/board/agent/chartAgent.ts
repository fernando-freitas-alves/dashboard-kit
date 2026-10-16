import type { AgentProgress, ChartSpec, ChartTrace } from "../types";
import type { DashboardRuntime } from "../../runtime";
export async function composeChartFromPrompt(
  runtime: DashboardRuntime,
  prompt: string,
  onProgress: (p: AgentProgress) => void,
  signal: AbortSignal,
  onTrace: (t: ChartTrace) => void,
  current?: ChartSpec,
) {
  const trace: ChartTrace = {
    source: "agent",
    prompt,
    status: "running",
    startedAt: Date.now(),
    steps: [{ type: "text", text: "Selecting fields and a chart type." }],
  };
  onTrace(trace);
  onProgress({ phase: "thinking", message: "Building your chart…" });
  const recipe = (runtime.options.starters || []).find(
    (r) => r.title.toLowerCase() === prompt.toLowerCase(),
  );
  try {
    const r = await runtime.adapter.compose(
      {
        prompt,
        ...(recipe ? { recipe: recipe.id } : {}),
        ...(current?.status === "ready" ? { current } : {}),
      },
      signal,
      { onProgress, onTrace },
    );
    onProgress({ phase: "composing", message: "Loading your chart…" });
    return { widget: r.widget as ChartSpec };
  } catch (e) {
    if (!signal.aborted)
      onTrace({
        ...trace,
        status: "failed",
        error: e instanceof Error ? e.message : "Could not build this chart.",
        finishedAt: Date.now(),
      });
    throw e;
  }
}
