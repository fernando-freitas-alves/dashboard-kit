import { test } from "node:test";
import assert from "node:assert/strict";
import { activeChartVersion, chartVersions, previousChartVersion, restoreChartVersion, updateChartVersion, MAX_CHART_HISTORY } from "../frontend/src/board/chartHistory";
import { toRevision, type ChartSpec } from "../frontend/src/board/types";

const chart = (kind: ChartSpec["kind"] = "kpi", n = 1): ChartSpec => ({id:"same-card",title:"Evaluations",prompt:"Evaluations",kind,query:'{"metric":"submitted","subject":""}',mapping:{value:"value"},status:"ready",createdAt:1,updatedAt:n});

test("rebuilding an identical table preserves the number chart as the rollback target", () => {
  const table = updateChartVersion(chart(), chart("table", 2));
  const rebuilt = updateChartVersion(table, {...chart("table", 3), query:'{ "subject": "", "metric": "submitted" }', prompt:"Evaluations."});
  assert.equal(activeChartVersion(rebuilt), 2);
  assert.equal(previousChartVersion(rebuilt)?.kind, "kpi");
  assert.equal(restoreChartVersion(rebuilt, 1).kind, "kpi");
});

test("multiple edits and restores retain stable versions across save and reload", () => {
  let w = updateChartVersion(chart(), chart("table", 2));
  w = updateChartVersion(w, {...chart("bar", 3), title:"By person"});
  w = JSON.parse(JSON.stringify(restoreChartVersion(w, 1)));
  assert.equal(w.kind, "kpi");
  assert.equal(activeChartVersion(w), 1);
  assert.deepEqual(chartVersions(w).map(r => r.version), [1,2,3]);
  assert.equal(restoreChartVersion(w, 3).kind, "bar");
  w = updateChartVersion(w, {...chart("line", 4), title:"Timeline"});
  assert.equal(w.version, 4);
});

test("legacy duplicate history is not offered as a no-op rollback", () => {
  const w = {...chart("table"), previous:toRevision(chart("table"))};
  assert.equal(previousChartVersion(w), undefined);
  assert.equal(chartVersions(w).length, 1);
  const old = {...chart("table", 2), previous:toRevision(chart())};
  assert.equal(previousChartVersion(old)?.kind, "kpi");
  assert.equal(activeChartVersion(old), 2);
});

test("restore clears later build details and preserves card identity and creation time", () => {
  const initial = chart();
  const w = updateChartVersion(initial, {...chart("table", 2), id:"new-agent-id",createdAt:99,trace:{source:"agent",prompt:"new",status:"done",startedAt:2,steps:[]}});
  const restored = restoreChartVersion(w, 1);
  assert.equal(restored.trace, undefined);
  assert.equal(restored.id, initial.id);
  assert.equal(restored.createdAt, initial.createdAt);
  assert.equal(restored.updatedAt, initial.updatedAt);
});

test("history is bounded and missing versions cannot change the chart", () => {
  let w = chart();
  for(let i=2;i<30;i++) w=updateChartVersion(w,{...chart("table",i),title:`Edit ${i}`});
  assert.equal(w.history?.length,MAX_CHART_HISTORY);
  assert.equal(w.version,29);
  assert.equal(restoreChartVersion(w,1),w);
});
