import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "SVGElement",
  "Element",
  "Node",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
  "Event",
  "EventTarget",
  "localStorage",
  "location",
  "navigator",
  "MutationObserver",
])
  Object.defineProperty(globalThis, key, {
    value: (dom.window as any)[key],
    configurable: true,
  });
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  matchMedia: () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }),
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (fn: any) => setTimeout(fn, 0),
  cancelAnimationFrame: clearTimeout,
  innerWidth: 1200,
  innerHeight: 800,
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
  value: () => null,
});
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
  get: () => 600,
});
Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
  get: () => 320,
});
Object.assign(dom.window, {
  matchMedia: globalThis.matchMedia,
  ResizeObserver: globalThis.ResizeObserver,
});
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ChartTile } = await import("../frontend/src/board/ChartTile");
const { DashboardContext, createRuntime } = await import(
  "../frontend/src/runtime"
);
const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
const sample = [
  { label: "Alex", value: 2, series: "Rarely", x: 1, y: 2 },
  { label: "Alex", value: 3, series: "Usually", x: 2, y: 3 },
  { label: "Blair", value: 5, series: "Usually", x: 3, y: 5 },
];
async function mount(kind: string, options: any = {}, tileProps: any = {}) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const runtime = createRuntime({
    namespace: "test:" + kind,
    adapter: { query: async () => sample } as any,
    ...options,
  });
  const spec = {
    id: "card",
    title: "Safe <title>",
    prompt: "Show results",
    status: "ready",
    query: "fixture",
    kind,
    mapping: {
      x: "label",
      y: "value",
      label: "label",
      value: "value",
      series: "series",
    },
    createdAt: 0,
    updatedAt: 0,
  };
  if (kind === "heatmap") spec.mapping.y = "series";
  if (kind === "scatter") {
    spec.mapping.x = "x";
    spec.mapping.y = "y";
  }
  await React.act(async () => {
    root.render(
      React.createElement(
        DashboardContext.Provider,
        { value: runtime },
        React.createElement(ChartTile, {
          spec: spec as any,
          editMode: false,
          onRemove() {},
          onRunPrompt() {},
          ...tileProps,
        }),
      ),
    );
    await pause();
  });
  await React.act(pause);
  return {
    el,
    runtime,
    async close() {
      await React.act(() => root.unmount());
      el.remove();
    },
  };
}
for (const kind of [
  "bar",
  "area",
  "line",
  "hbar",
  "scatter",
  "heatmap",
  "treemap",
  "donut",
  "kpi",
  "table",
])
  test(
    kind + " renders authorized fixture rows without executing markup",
    async () => {
      const item = await mount(kind);
      try {
        assert.equal(item.el.querySelector(".aie-tile-version"), null, "locked cards hide version badges");
        assert.ok(
          !item.el.querySelector("title"),
          "escaped title must not become an HTML element",
        );
        assert.ok(
          !item.el.textContent?.includes("Couldn’t load"),
          item.el.textContent || "",
        );
        if (kind === "table")
          assert.equal(
            item.el.querySelectorAll("tbody tr").length,
            3,
            item.el.textContent || "",
          );
        else if (kind === "kpi")
          assert.equal(item.el.querySelector(".aie-kpi-v")?.textContent, "2");
        else
          assert.ok(
            item.el.querySelector("svg"),
            item.el.textContent || "missing chart",
          );
      } finally {
        await item.close();
      }
    },
  );
test("host chart colors reach categorical and single-series renderers without changing other workspaces", async () => {
  const colorScale = {
    colorFor: (_namespace: string, key: string) => key === "Usually" ? "#DC3912" : "#3366CC",
    otherColor: () => "#CCCCCC",
  };
  for (const kind of ["bar", "area", "donut", "line", "hbar", "treemap"]) {
    const item = await mount(kind, {
      colorScale,
      palette: ["#ff00ff"],
      categoryColors: [["Rarely", "#00ffff"]],
    });
    try {
      assert.equal(item.runtime.charts.primaryColor(), "#3366CC");
      assert.equal(item.runtime.charts.categoryColor("series", "Usually"), "#DC3912");
      assert.equal(item.runtime.charts.categoryColor("series", "__other"), "#CCCCCC");
      assert.match(item.el.querySelector(".aie-tile-chart svg")!.outerHTML, /#3366cc|rgb\(51, 102, 204\)/i, kind);
    } finally {
      await item.close();
    }
  }
  const forms = await mount("bar", { palette: ["#56b988"] });
  try {
    assert.equal(forms.runtime.charts.primaryColor(), "#56b988");
    assert.match(forms.el.querySelector(".aie-tile-chart svg")!.outerHTML, /#56b988|rgb\(86, 185, 136\)/i);
  } finally {
    await forms.close();
  }
});
test("table permissions hide CSV, preserve host cell action and search rows", async () => {
  let selected = "";
  const item = await mount("table", {
    features: { export: false },
    tableColumns: (_s: any, _r: any, c: any[]) =>
      c.map((x) => (x.k === "label" ? { ...x, dim: "person" } : x)),
    onCellAction: (_d: string, v: string) => {
      selected = v;
    },
  });
  try {
    assert.equal(
      (item.el.querySelector(".split-wrap") as HTMLElement).style.display,
      "none",
    );
    // The host callback is wired through the table's semantic cell controls.
    const cell = [...item.el.querySelectorAll('[role="button"]')].find((e) =>
      e.getAttribute("aria-label")?.includes("Alex"),
    ) as HTMLElement;
    assert.ok(cell);
    cell.click();
    assert.equal(selected, "Alex");
    const search = item.el.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement;
    assert.ok(search);
    search.value = "Blair";
    search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.match(item.el.querySelector("tbody")!.textContent!, /Blair/);
    assert.doesNotMatch(item.el.querySelector("tbody")!.textContent!, /Alex/);
  } finally {
    await item.close();
  }
});
test("custom renderer cleans up on refresh and unmount", async () => {
  let rendered = 0,
    cleaned = 0;
  const item = await mount("kpi", {
    renderers: {
      kpi: (el: HTMLElement) => {
        rendered++;
        el.textContent = "Custom";
        return () => cleaned++;
      },
    },
  });
  assert.equal(rendered, 1);
  await React.act(async () => {
    item.runtime.events.dispatchEvent(new Event("refresh"));
    await pause();
  });
  await React.act(pause);
  assert.equal(rendered, 2);
  assert.equal(cleaned, 1);
  await item.close();
  assert.equal(cleaned, 2);
});


const { barChart } = await import("../frontend/vendor/dash-kit/js/charts.js");
const { axisText, chartViewport } = await import("../frontend/src/board/axisLayout");
const { createRenderers } = await import("../frontend/src/board/d3Charts");

test("chart viewport subtracts actual legend height, margins and padding", () => {
  const el = document.createElement("div");
  document.body.append(el);
  el.style.padding = "4px 2px 2px";
  const legend = document.createElement("div");
  legend.style.marginBottom = "6px";
  legend.getBoundingClientRect = () => ({ height: 72 }) as DOMRect;
  el.append(legend);
  assert.deepEqual(chartViewport(el), { W: 596, H: 234 });
  el.remove();
});

test("long axis labels wrap without losing words or identifier characters", () => {
  const el = document.createElement("div");
  document.body.append(el);
  const text = axisText(el);
  const label = "Guilherme Baldo Carlos — Phoenix";
  const wrapped = text.wrap(label, 65);
  assert.ok(wrapped.lines.length > 1);
  assert.equal(wrapped.lines.join("").replace(/\s/g, ""), label.replace(/\s/g, ""));
  assert.ok(wrapped.lines.every(line => text.measure(line) <= 65));
  const identifier = "averylongidentifierwithoutspaces";
  assert.equal(text.wrap(identifier, 50).lines.join(""), identifier);
  text.dispose();
  el.remove();
});

for (const mode of ["bar", "area"]) test(`${mode} keeps full labels at wide and narrow card widths`, () => {
  const el = document.createElement("div");
  document.body.append(el);
  let width = 600;
  Object.defineProperty(el, "clientWidth", { get: () => width });
  const labels = ["Alex (demo)", "Guilherme Baldo Carlos", "Casey — Product engineering"];
  const options = { buckets: labels.map(label => ({ key: label, label })),
    series: [{ key: "count", label: "Evaluations", color: "green" }], val: () => 4, mode, brush: false };
  for (width of [600, 260]) {
    barChart(el, options);
    const nodes = [...el.querySelectorAll<SVGTextElement>(".axis-x text")];
    assert.deepEqual(nodes.map(n => n.getAttribute("aria-label")), labels);
    assert.ok(nodes.every(n => !n.textContent?.includes("…")));
    assert.ok(nodes.every(n => n.querySelector("tspan")));
    if (width === 260) assert.ok(nodes.some(n => n.querySelectorAll("tspan").length > 1));
    assert.ok(el.classList.contains("ldk-chart-axes"));
  }
  el.remove();
});

test("dense time axes keep a bounded plot with fewer complete ticks", () => {
  const el = document.createElement("div");
  document.body.append(el);
  const buckets = Array.from({ length: 365 }, (_, i) => ({
    key: String(i), label: "October 16, 2026", from: i * 86400000, to: (i + 1) * 86400000,
  }));
  barChart(el, { buckets, series: [{ key: "v", label: "Count", color: "green" }], val: () => 1 });
  assert.ok(Number(el.querySelector("svg")!.getAttribute("width")) <= 600);
  const ticks = [...el.querySelectorAll(".axis-x text")];
  assert.ok(ticks.length > 1 && ticks.length < 10);
  assert.ok(ticks.every(t => t.getAttribute("aria-label") === "October 16, 2026"));
  el.remove();
});

for (const kind of ["line", "hbar", "heatmap"]) test(`${kind} preserves complete categorical labels`, () => {
  const el = document.createElement("div");
  document.body.append(el);
  Object.defineProperty(el, "clientWidth", { get: () => 260 });
  const names = ["Guilherme Baldo Carlos", "A very long team name with no hidden suffix"];
  const rows = names.map((label, i) => ({ label, value: i + 1, series: "Constructive collaboration" }));
  createRenderers().renderD3Chart(el, { kind, title: "Test", mapping: {
    x: "label", y: kind === "heatmap" ? "series" : "value", label: "label", value: "value",
  }} as any, rows);
  const labels = [...el.querySelectorAll("text[aria-label]")].map(n => n.getAttribute("aria-label"));
  for (const name of names) assert.ok(labels.includes(name), name);
  assert.ok(!el.textContent?.includes("…"));
  assert.ok(el.querySelectorAll("tspan").length > names.length);
  el.remove();
});
after(() => dom.window.close());


test("chart controls name the active and rollback versions and expose saved history", async () => {
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal() { this.open = true; },
    close() { this.open = false; },
  });
  const spec = { id: "versioned", title: "Totals", kind: "table", query: "fixture", mapping: { value: "value" },
    prompt: "Totals", status: "ready", createdAt: 1, updatedAt: 2, version: 2,
    history: [{ title: "Total", kind: "kpi", query: "fixture", mapping: { value: "value" }, prompt: "Total", updatedAt: 1, version: 1 }] };
  const restored: number[] = [];
  const item = await mount("table", {}, { spec, editMode: true, onRevert: (version: number) => restored.push(version) });
  try {
    const rollback = item.el.querySelector<HTMLButtonElement>('button[aria-label="Restore v1. Total · kpi"]')!;
    assert.ok(rollback);
    await React.act(() => rollback.click());
    assert.deepEqual(restored, [1]);
    const badge = item.el.querySelector<HTMLButtonElement>('button[aria-label="Chart version 2. View history"]')!;
    assert.equal(badge.textContent, "v2");
    await React.act(() => badge.click());
    const history = document.querySelector('[aria-label="Chart versions"]')!;
    assert.match(history.textContent!, /v2 active/);
    const restore = history.querySelector<HTMLButtonElement>("button")!;
    assert.equal(restore.textContent, "Restore v1");
    await React.act(() => restore.click());
    assert.deepEqual(restored, [1, 1]);
  } finally { await item.close(); }
});

test("duplicate legacy snapshot does not offer a misleading rollback", async () => {
  const spec = { id: "duplicate", title: "Totals", kind: "table", query: "fixture", mapping: {},
    prompt: "Totals", status: "ready", createdAt: 1, updatedAt: 2 };
  const item = await mount("table", {}, { spec: { ...spec, previous: { ...spec } }, editMode: true });
  try {
    assert.equal(item.el.querySelector('.aie-tile-revert'), null);
    assert.ok(item.el.querySelector('[aria-label="Chart version 1. View history"]'));
  } finally { await item.close(); }
});
