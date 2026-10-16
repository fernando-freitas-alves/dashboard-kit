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
test("donut centers only the full total and shrinks long totals as the card narrows", async () => {
  const { donut } = await import("../frontend/vendor/dash-kit/js/charts.js");
  const widths = [160, 320, 600];
  const sizes: number[] = [];
  for (const width of widths) {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: width });
    document.body.append(el);
    try {
      donut(el, {
        items: [{ key: "revenue", label: "Revenue", value: 1256512.5, color: "#5b5bd6" }],
        centerLabel: "This redundant label must not appear",
        onClick() {},
      });
      const text = el.querySelector(".donut-value") as SVGTextElement;
      assert.equal(text.textContent, "1,256,512.5");
      assert.equal(text.getAttribute("aria-label"), "Total: 1,256,512.5");
      assert.equal(text.parentElement!.querySelectorAll(":scope > text").length, 1);
      assert.doesNotMatch(el.textContent!, /redundant label/);
      assert.equal(text.getAttribute("dominant-baseline"), "central");
      sizes.push(parseFloat(text.style.fontSize));
    } finally { el.remove(); }
  }
  assert.ok(sizes[0] < sizes[1], "narrow cards shrink the full number instead of clipping it");
  assert.ok(sizes[1] <= sizes[2]);
});

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
test("horizontal bars color categories consistently and honor host overrides", async () => {
  const item = await mount("hbar", { palette: ["#5b5bd6", "#11a78f"], categoryColors: [["Alex", "#f59e0b"]] }, {
    spec: { id: "categories", title: "Categories", prompt: "", query: "fixture", kind: "hbar", status: "ready",
      mapping: { label: "label", value: "value" }, createdAt: 0, updatedAt: 0 },
  });
  try {
    const bars = [...item.el.querySelectorAll(".aie-tile-chart svg rect")].filter(node => node.getAttribute("fill") !== "transparent");
    assert.equal(bars.length, 3);
    const byLabel = bars.map(node => ({ label: node.parentElement!.querySelector(".axis-label")?.textContent, color: node.getAttribute("fill") }));
    assert.ok(byLabel.filter(bar => bar.label === "Alex").every(bar => bar.color === "#f59e0b"));
    assert.equal(new Set(byLabel.map(bar => bar.color)).size, 2);
    assert.equal(byLabel.find(bar => bar.label === "Blair")?.color, "#5b5bd6");
  } finally { await item.close(); }
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

for (const kind of ['bar', 'area', 'line']) test(`${kind} date charts brush whole months and support cancel and keyboard clear`, async () => {
  const points = ['2026-01-01', '2026-02-01', '2026-03-01'].map((label, i) => ({ label, value: [10, 30, 20][i] }));
  const day = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86400000;
  const selected: number[][] = [];
  const period = { from: day('2026-01-01'), to: day('2026-04-01'), label: 'First quarter' };
  const item = await mount(kind, { adapter: { query: async () => points } }, {
    spec: { id: 'dates', title: 'Revenue', prompt: 'Revenue', kind, query: 'dates', status: 'ready', createdAt: 1, updatedAt: 1,
      mapping: { x: 'label', y: 'value', timeUnit: 'month' } },
    period, onSetPeriod: (from: number, to: number) => selected.push([from, to]),
  });
  try {
    const svg = item.el.querySelector('.aie-tile-chart svg')!;
    (svg as any).createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    const group = svg.querySelector('g')!;
    (group as any).getScreenCTM = () => ({ inverse: () => ({}) });
    const buckets = [...svg.querySelectorAll<SVGRectElement>('.bk .bg')];
    assert.equal(buckets.length, 3);
    const center = (i: number) => Number(buckets[i].getAttribute('x')) + Number(buckets[i].getAttribute('width')) / 2;
    const pointer = (target: Element, type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 40 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      target.dispatchEvent(event);
    };
    assert.match(item.el.textContent!, /Drag to filter dashboard/);
    if (kind === 'line') assert.equal(svg.querySelectorAll('.series-line').length, 1);
    await React.act(async () => {
      // Start on the mark, which must not swallow the brush gesture.
      pointer(svg.querySelector('rect.seg') ?? buckets[2], 'pointerdown', center(2));
      pointer(svg, 'pointermove', center(0));
      pointer(svg, 'pointerup', center(0));
    });
    assert.deepEqual(selected, [[day('2026-01-01'), day('2026-04-01')]]);
    await React.act(() => {
      pointer(buckets[0], 'pointerdown', center(0));
      pointer(svg, 'pointermove', center(1));
      pointer(svg, 'pointercancel', center(1));
    });
    assert.equal(selected.length, 1, 'cancel must not commit a selection');
    const clear = svg.querySelector('[aria-label="Clear date range"]')!;
    assert.equal(clear.getAttribute('tabindex'), '0');
    await React.act(() => clear.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.deepEqual(selected[1], [period.from, period.to], 'clear toggles off the committed period');
  } finally { await item.close(); }
});

test('unstacked timelines keep negative values within the plot', () => {
  const el = document.createElement('div'); document.body.append(el);
  try {
    barChart(el, { mode: 'line', stacked: false,
      buckets: [{ key: 'first', label: 'First', from: 1, to: 2 }, { key: 'second', label: 'Second', from: 2, to: 3 }],
      series: [{ key: 'profit', label: 'Profit', color: 'blue' }], val: (i: number) => [-20, 30][i] });
    assert.match(el.querySelector('.axis')!.textContent!, /[−-]20/);
    assert.ok(el.querySelector('.series-line')!.getAttribute('d'));
  } finally { el.remove(); }
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

test('host field labels and currency formats reach cards, charts and tables', async () => {
  const fieldPresentation = (_spec: unknown, field: string) => field === 'value'
    ? { label: 'Revenue', format: (n: number) => `$${n.toFixed(2)}`, axisFormat: (n: number) => `$${n}` }
    : { label: field === 'label' ? 'Region' : field };
  for (const kind of ['kpi', 'table', 'donut', 'hbar', 'line', 'bar', 'area', 'treemap']) {
    const item = await mount(kind, { fieldPresentation });
    try {
      const content = item.el.querySelector('.aie-tile-chart')!;
      assert.match(content.textContent!, /\$/, kind);
      if (kind === 'kpi') assert.equal(content.querySelector('.aie-kpi-v')?.textContent, '$2.00');
      if (kind === 'table') {
        assert.match(content.textContent!, /Revenue/);
        assert.match(content.textContent!, /Region/);
        assert.match(content.textContent!, /\$5\.00/);
      }
      if (kind === 'donut') {
        assert.equal(content.querySelector('.donut-value')?.textContent, '$10.00');
        assert.equal(content.querySelector('.lg-label[role="button"]'), null, 'no fake filtering action');
      }
      const hover = kind === 'hbar' ? content.querySelector('rect[fill="transparent"]')
        : kind === 'donut' ? content.querySelector('.pie-slice') : null;
      if (hover) {
        hover.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
        const tip = document.getElementById('ldk-tip')!;
        assert.match(tip.textContent!, /Revenue/);
        assert.match(tip.textContent!, /\$\d+\.00/);
        assert.doesNotMatch(tip.textContent!, /Click to filter|value/);
      }
    } finally { await item.close(); }
  }
});

test('host-formatted values remain text, including KPI and donut tooltip HTML', async () => {
  for (const kind of ['kpi', 'donut', 'hbar']) {
    const item = await mount(kind, { fieldPresentation: () => ({ label: '<img src=x>', format: () => '<img src=x onerror=alert(1)>' }) });
    try {
      const chart = item.el.querySelector('.aie-tile-chart')!;
      assert.equal(chart.querySelector('img'), null);
      assert.match(chart.textContent!, /<img src=x/);
      const hover = kind === 'hbar' ? chart.querySelector('rect[fill="transparent"]') : chart.querySelector('.pie-slice');
      if (hover) {
        hover.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        assert.equal(document.getElementById('ldk-tip')!.querySelector('img'), null);
        assert.match(document.getElementById('ldk-tip')!.textContent!, /<img src=x/);
      }
    } finally { await item.close(); }
  }
});
