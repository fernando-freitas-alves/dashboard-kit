import { orderedSeries } from "./seriesOrder";
import { axisText, chartViewport, writeAxisLabel } from "./axisLayout";
/**
 * d3 renderers for the My board kinds dash-kit doesn't ship: line, hbar,
 * scatter, heatmap, treemap and map. They reuse the page's look: categorical
 * colours from dash-kit's shared palette (`colorFor`, so an `org` column gets
 * the same colours as the dashboard's org charts), `.axis` / `.gridl` /
 * `.legend` styling, and the single `#tip` tooltip.
 *
 * d3 is the page-global CDN build loaded by index.html.
 */
import * as D3Module from "d3";
import { createPalette, type ChartColorScale } from "../palette";
import { hideTip, showTip } from "../../vendor/dash-kit/js/tooltip.js";
import { loadGeo, looksLikeUsStates, regionIndex, type GeoScope } from "./geo";
import type { ChartKind, ChartSpec } from "./types";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D3 = any;

const d3 = (): D3 => D3Module;

/** Kinds drawn here (everything else stays in ChartTile's dash-kit path). */
export const D3_KINDS: ReadonlySet<ChartKind> = new Set([
  "line",
  "hbar",
  "scatter",
  "heatmap",
  "treemap",
  "map",
]);

/** Most series a chart shows before the tail is rolled into "Other". */
const MAX_SERIES = 10;

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function formatNum(n: number): string {
  if (Math.abs(n) >= 1000)
    return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Colour for one-series charts: the palette's first colour, like the dashboard's own single-series cards. */
export function createRenderers(
  colors?: string[],
  overrides?: Array<[string, string]>,
  colorScale?: ChartColorScale,
) {
  const { colorFor, otherColor } = colorScale ?? createPalette(colors, overrides);
  function primaryColor(): string {
    return colorFor("__aie-board", "primary");
  }

  /** Colour for a category value; namespaced by column so it matches page charts on the same dimension. */
  function categoryColor(column: string | undefined, key: string): string {
    return key === "__other" ? otherColor() : colorFor(column || "label", key);
  }

  /**
   * Panel-to-primary ramp for heatmaps and choropleths. Returns CSS
   * `color-mix()` strings against `var(--panel)` so shades follow a theme
   * switch without a redraw — apply them with `.style("fill")`, not attributes.
   */
  function sequential(min: number, max: number) {
    const pct = d3()
      .scaleLinear()
      .domain([min, max === min ? min + 1 : max])
      .range([12, 100])
      .clamp(true);
    return (v: number) =>
      `color-mix(in srgb, ${primaryColor()} ${Math.round(pct(v))}%, var(--panel))`;
  }

  function tip(title: string, rows: [string, string][], hint?: string): string {
    return (
      `<div class="t">${escapeHtml(title)}</div>` +
      rows
        .map(
          ([k, v]) =>
            `<div class="r"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`,
        )
        .join("") +
      (hint ? `<div class="h">${escapeHtml(hint)}</div>` : "")
    );
  }

  function empty(el: HTMLElement, message = "No rows") {
    el.innerHTML = `<p class="aie-muted">${escapeHtml(message)}</p>`;
  }

  /** dash-kit style legend row (static: no series filtering on the board). */
  function legend(el: HTMLElement, items: { label: string; color: string }[]) {
    if (items.length < 2) return;
    const lg = document.createElement("div");
    lg.className = "legend";
    for (const it of items) {
      const span = document.createElement("span");
      span.className = "lg";
      const sw = document.createElement("i");
      sw.style.background = it.color;
      const label = document.createElement("span");
      label.textContent = it.label;
      label.title = it.label;
      span.append(sw, label);
      lg.appendChild(span);
    }
    el.appendChild(lg);
  }

  /** Remaining drawable box under any legend already appended to `el`. */
  function box(el: HTMLElement): { W: number; H: number } {
    const used = [...el.children].reduce(
      (h, c) => h + (c as HTMLElement).offsetHeight,
      0,
    );
    return {
      W: Math.max(200, el.clientWidth - 2),
      H: Math.max(120, el.clientHeight - used - 4),
    };
  }

  /**
   * Split rows by the `series` column, keeping the biggest `MAX_SERIES - 1`
   * series by total and rolling the rest into "Other" (the dashboard's rule).
   */
  function seriesOf(
    rows: Row[],
    seriesKey: string | undefined,
    valueKey: string,
    order?: string[],
  ): { key: string; label: string; color: string; rows: Row[] }[] {
    if (!seriesKey)
      return [{ key: "_", label: "", color: primaryColor(), rows }];
    const by = new Map<string, Row[]>();
    for (const r of rows) {
      const k = str(r[seriesKey]) || "(blank)";
      (by.get(k) ?? by.set(k, []).get(k)!).push(r);
    }
    const totals = new Map(
      [...by.entries()].map(
        ([key, rows]) =>
          [
            key,
            rows.reduce((sum, row) => sum + Math.abs(num(row[valueKey])), 0),
          ] as const,
      ),
    );
    const ranked = orderedSeries(totals, order).map((k) => ({
      k,
      rs: by.get(k)!,
    }));
    const keep =
      ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
    const out = keep.map(({ k, rs }) => ({
      key: k,
      label: k,
      color: categoryColor(seriesKey, k),
      rows: rs,
    }));
    if (ranked.length > keep.length) {
      out.push({
        key: "__other",
        label: "Other",
        color: otherColor(),
        rows: ranked.slice(keep.length).flatMap((s) => s.rs),
      });
    }
    return out;
  }

  const DAY_RE = /^\d{4}-\d{2}-\d{2}/;

  function asDate(v: unknown): Date | null {
    const s = str(v);
    if (!DAY_RE.test(s)) return null;
    const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Draw a d3-backed kind into `el` (sized by the tile). Map draws asynchronously. */
  function renderD3Chart(el: HTMLElement, spec: ChartSpec, rows: Row[]): void {
    el.innerHTML = "";
    if (!rows.length) {
      empty(el);
      return;
    }
    switch (spec.kind) {
      case "line":
        return lineChart(el, spec, rows);
      case "hbar":
        return hbarChart(el, spec, rows);
      case "scatter":
        return scatterChart(el, spec, rows);
      case "heatmap":
        return heatmapChart(el, spec, rows);
      case "treemap":
        return treemapChart(el, spec, rows);
      case "map":
        return void mapChart(el, spec, rows);
      default:
        empty(el, `Unsupported chart kind “${spec.kind}”.`);
    }
  }

  function yAxis(g: D3, y: D3, iw: number) {
    const D = d3();
    g.append("g")
      .attr("class", "gridl")
      .call(D.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""));
    g.append("g")
      .attr("class", "axis")
      .call(
        D.axisLeft(y)
          .ticks(5)
          .tickFormat((v: number) => formatNum(v)),
      )
      .call((a: D3) => a.select(".domain").remove());
  }

  /** Multi-series line over dates (UTC days) or ordered categories, with a hover rule. */
  function lineChart(el: HTMLElement, spec: ChartSpec, rows: Row[]) {
    const D = d3();
    const xKey = spec.mapping.x || "x";
    const yKey = spec.mapping.y || "y";
    const series = seriesOf(
      rows,
      spec.mapping.series,
      yKey,
      spec.mapping.seriesOrder,
    );
    legend(el, series);
    const viewport = chartViewport(el);
    const text = axisText(el);

    const isTime = rows.every((r) => asDate(r[xKey]));
    const xs: string[] = [];
    for (const r of rows) {
      const k = str(r[xKey]);
      if (!xs.includes(k)) xs.push(k);
    }
    if (isTime) xs.sort();

    const vals = rows.map((r) => num(r[yKey]));
    const y = D.scaleLinear()
      .domain([Math.min(0, D.min(vals)), D.max(vals) || 1]).nice();
    const m = { t: text.lineHeight, r: isTime ? 36 : 10, b: 0,
      l: Math.max(12, ...y.ticks(5).map((v: number) => text.measure(formatNum(v)))) + 14 };
    const W = Math.max(viewport.W, isTime ? 240 : m.l + m.r + xs.length * 72);
    const iw = W - m.l - m.r;
    const labels = new Map(xs.map(k => [k, text.wrap(k, iw / xs.length - 12)]));
    m.b = isTime ? text.lineHeight + 16 : Math.max(...[...labels.values()].map(l => l.height)) + 16;
    const H = Math.max(viewport.H, m.t + m.b + 80);
    const ih = H - m.t - m.b;
    const x = isTime
      ? D.scaleUtc().domain(D.extent(xs, (k: string) => asDate(k))).range([0, iw])
      : D.scalePoint().domain(xs).range([0, iw]).padding(0.5);
    const xPos = (k: string) => (isTime ? x(asDate(k)) : x(k));
    y.range([ih, 0]);

    const svg = D.select(el)
      .append("svg")
      .attr("width", W)
      .attr("height", H)
      .style("display", "block");
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    yAxis(g, y, iw);
    const xa = g
      .append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${ih})`);
    if (isTime) {
      xa.call(
        D.axisBottom(x)
          .ticks(Math.max(2, Math.floor(iw / 90)))
          .tickFormat(D.utcFormat("%b %-d")),
      );
    } else {
      xa.call(D.axisBottom(x));
      xa.selectAll("text").each(function (this: SVGTextElement, k: string) {
        writeAxisLabel(this, labels.get(k)!, text.lineHeight, 0, text.size + 8);
      });
    }
    text.dispose();

    const byX = new Map<string, Map<string, number>>();
    for (const s of series) {
      const pts = s.rows
        .map((r) => ({ k: str(r[xKey]), v: num(r[yKey]) }))
        .sort((a, b) => xs.indexOf(a.k) - xs.indexOf(b.k));
      for (const p of pts) {
        const at = byX.get(p.k) ?? byX.set(p.k, new Map()).get(p.k)!;
        at.set(s.key, (at.get(s.key) ?? 0) + p.v);
      }
      g.append("path")
        .datum(pts)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 2.2)
        .attr(
          "d",
          D.line()
            .x((p: { k: string }) => xPos(p.k))
            .y((p: { v: number }) => y(p.v))
            .curve(D.curveMonotoneX),
        );
      if (pts.length <= 40) {
        g.append("g")
          .selectAll("circle")
          .data(pts)
          .join("circle")
          .attr("cx", (p: { k: string }) => xPos(p.k))
          .attr("cy", (p: { v: number }) => y(p.v))
          .attr("r", 2.6)
          .attr("fill", s.color);
      }
    }

    const rule = g
      .append("line")
      .attr("y1", 0)
      .attr("y2", ih)
      .style("stroke", "var(--line-2)")
      .style("opacity", 0);
    g.append("rect")
      .attr("width", iw)
      .attr("height", ih)
      .attr("fill", "transparent")
      .on("mousemove", (ev: MouseEvent) => {
        const [px] = D.pointer(ev);
        let best = xs[0];
        for (const k of xs)
          if (Math.abs(xPos(k) - px) < Math.abs(xPos(best) - px)) best = k;
        rule.attr("x1", xPos(best)).attr("x2", xPos(best)).style("opacity", 1);
        const at = byX.get(best);
        showTip(
          ev,
          tip(
            isTime ? D.utcFormat("%a, %b %-d %Y")(asDate(best)) : best,
            series
              .filter((s) => at?.has(s.key))
              .map((s) => [s.label || spec.title, formatNum(at!.get(s.key)!)]),
          ),
        );
      })
      .on("mouseleave", () => {
        rule.style("opacity", 0);
        hideTip();
      });
  }

  /** Ranked horizontal bars; wrapped labels and rows scroll within small tiles. */
  function hbarChart(el: HTMLElement, spec: ChartSpec, rows: Row[]) {
    const D = d3();
    const labelKey = spec.mapping.label || spec.mapping.x || "label";
    const valueKey = spec.mapping.value || spec.mapping.y || "value";
    const { W } = chartViewport(el);
    const text = axisText(el);
    const data = rows
      .map((r) => ({ label: str(r[labelKey]) || "(blank)", value: num(r[valueKey]), row: r }))
      .sort((a, b) => b.value - a.value);
    const labelW = Math.min(W * 0.4, Math.max(...data.map(d => text.measure(d.label))) + 12);
    const labels = data.map(d => text.wrap(d.label, Math.max(24, labelW - 12)));
    const rowHeight = Math.max(26, ...labels.map(l => l.height + 10));
    const valueW = Math.max(...data.map(d => text.measure(formatNum(d.value)))) + 12;
    const m = { t: 6, r: valueW, b: 6, l: labelW };
    const width = Math.max(W, m.l + m.r + 80);
    const iw = width - m.l - m.r;
    const ih = data.length * rowHeight;
    const y = D.scaleBand().domain(data.map((_, i) => i)).range([0, ih]).padding(0.22);
    const x = D.scaleLinear().domain([0, D.max(data, (d: { value: number }) => d.value) || 1]).range([0, iw]);
    const color = (d: { row: Row }) =>
      spec.mapping.series
        ? categoryColor(spec.mapping.series, str(d.row[spec.mapping.series]))
        : primaryColor();
    const total = D.sum(rows, (r: Row) => num(r[valueKey])) || 1;

    const svg = D.select(el)
      .append("svg")
      .attr("width", width)
      .attr("height", ih + m.t + m.b)
      .style("display", "block");
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const rowG = g
      .selectAll("g")
      .data(data)
      .join("g")
      .attr("transform", (_: unknown, i: number) => `translate(0,${y(i)})`);
    rowG
      .append("rect")
      .attr("width", (d: { value: number }) =>
        Math.max(1, x(Math.max(0, d.value))),
      )
      .attr("height", y.bandwidth())
      .attr("rx", 2)
      .attr("fill", color);
    rowG.append("text").attr("class", "axis-label").attr("text-anchor", "end")
      .each(function (this: SVGTextElement, _d: unknown, i: number) {
        writeAxisLabel(this, labels[i], text.lineHeight, -8,
          y.bandwidth() / 2 - labels[i].height / 2 + text.size);
      });
    text.dispose();
    rowG
      .append("text")
      .attr("x", (d: { value: number }) => x(Math.max(0, d.value)) + 6)
      .attr("y", y.bandwidth() / 2)
      .attr("dy", "0.35em")
      .style("font-weight", 600)
      .text((d: { value: number }) => formatNum(d.value));
    rowG
      .append("rect")
      .attr("x", -m.l)
      .attr("width", width)
      .attr("height", y.bandwidth())
      .attr("fill", "transparent")
      .on("mousemove", (ev: MouseEvent, d: { label: string; value: number }) =>
        showTip(
          ev,
          tip(d.label, [
            [valueKey, formatNum(d.value)],
            ["Share", `${((d.value / total) * 100).toFixed(1)}%`],
          ]),
        ),
      )
      .on("mouseleave", hideTip);
  }

  /** Numeric x/y dots, coloured by `series`, sized by `size`. */
  function scatterChart(el: HTMLElement, spec: ChartSpec, rows: Row[]) {
    const D = d3();
    const xKey = spec.mapping.x || "x";
    const yKey = spec.mapping.y || "y";
    const labelKey = spec.mapping.label;
    const sizeKey = spec.mapping.size;
    const series = seriesOf(
      rows,
      spec.mapping.series,
      yKey,
      spec.mapping.seriesOrder,
    );
    legend(el, series);
    const viewport = chartViewport(el);
    const text = axisText(el);
    const xv = rows.map((r) => num(r[xKey]));
    const yv = rows.map((r) => num(r[yKey]));
    const x = D.scaleLinear().domain([Math.min(0, D.min(xv)), D.max(xv) || 1]).nice();
    const y = D.scaleLinear().domain([Math.min(0, D.min(yv)), D.max(yv) || 1]).nice();
    const xTickW = Math.max(...x.ticks(5).map((v: number) => text.measure(formatNum(v))));
    const m = { t: text.lineHeight, r: xTickW / 2 + 8, b: 0,
      l: Math.max(xTickW / 2, ...y.ticks(5).map((v: number) => text.measure(formatNum(v)))) + 14 };
    const W = Math.max(viewport.W, m.l + m.r + 100);
    const iw = W - m.l - m.r;
    const xTitle = text.wrap(xKey, iw);
    const yTitle = text.wrap(yKey, iw);
    m.t += yTitle.height + 4;
    m.b = text.lineHeight + xTitle.height + 20;
    const H = Math.max(viewport.H, m.t + m.b + 80);
    const ih = H - m.t - m.b;
    x.range([0, iw]); y.range([ih, 0]);
    const r = sizeKey
      ? D.scaleSqrt()
          .domain([0, D.max(rows, (row: Row) => num(row[sizeKey])) || 1])
          .range([2.5, 16])
      : () => 4.5;

    const svg = D.select(el)
      .append("svg")
      .attr("width", W)
      .attr("height", H)
      .style("display", "block");
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    yAxis(g, y, iw);
    g.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${ih})`)
      .call(
        D.axisBottom(x)
          .ticks(Math.max(1, Math.floor(iw / Math.max(80, xTickW + 16))))
          .tickFormat((v: number) => formatNum(v)),
      );
    writeAxisLabel(g.append("text").attr("text-anchor", "end").node(), xTitle,
      text.lineHeight, iw, ih + text.lineHeight + text.size + 12);
    writeAxisLabel(g.append("text").node(), yTitle, text.lineHeight,
      0, -yTitle.height - 4 + text.size);
    text.dispose();

    for (const s of series) {
      g.append("g")
        .selectAll("circle")
        .data(s.rows)
        .join("circle")
        .attr("cx", (row: Row) => x(num(row[xKey])))
        .attr("cy", (row: Row) => y(num(row[yKey])))
        .attr("r", (row: Row) => r(sizeKey ? num(row[sizeKey]) : 0))
        .attr("fill", s.color)
        .attr("fill-opacity", 0.72)
        .attr("stroke", s.color)
        .on("mousemove", (ev: MouseEvent, row: Row) => {
          const lines: [string, string][] = [
            [xKey, formatNum(num(row[xKey]))],
            [yKey, formatNum(num(row[yKey]))],
          ];
          if (sizeKey) lines.push([sizeKey, formatNum(num(row[sizeKey]))]);
          showTip(
            ev,
            tip(labelKey ? str(row[labelKey]) : s.label || spec.title, lines),
          );
        })
        .on("mouseleave", hideTip);
    }
  }

  /** Category × category grid coloured by `value` (e.g. weekday × hour). */
  function heatmapChart(el: HTMLElement, spec: ChartSpec, rows: Row[]) {
    const D = d3();
    const xKey = spec.mapping.x || "x";
    const yKey = spec.mapping.y || "y";
    const valueKey = spec.mapping.value || "value";
    const xs = [...new Set(rows.map((r) => str(r[xKey])))];
    const ys = [...new Set(rows.map((r) => str(r[yKey])))];
    if (xs.every((k) => asDate(k))) xs.sort();
    const viewport = chartViewport(el);
    const text = axisText(el);
    const labelW = Math.min(viewport.W * 0.35, Math.max(...ys.map(text.measure)) + 14);
    const yLabels = new Map(ys.map(k => [k, text.wrap(k, Math.max(24, labelW - 14))]));
    const m = { t: 8, r: 8, b: 0, l: labelW };
    const W = Math.max(viewport.W, m.l + m.r + xs.length * 72);
    const iw = W - m.l - m.r;
    const xLabels = new Map(xs.map(k => [k, text.wrap(k, iw / xs.length - 12)]));
    m.b = Math.max(...[...xLabels.values()].map(l => l.height)) + 14;
    const rowHeight = Math.max(24, ...[...yLabels.values()].map(l => l.height + 8));
    const H = Math.max(viewport.H, m.t + m.b + ys.length * rowHeight);
    const ih = H - m.t - m.b;
    const x = D.scaleBand().domain(xs).range([0, iw]).padding(0.06);
    const y = D.scaleBand().domain(ys).range([0, ih]).padding(0.06);
    const vals = rows.map((r) => num(r[valueKey]));
    const color = sequential(D.min(vals), D.max(vals));

    const svg = D.select(el)
      .append("svg")
      .attr("width", W)
      .attr("height", H)
      .style("display", "block");
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    g.selectAll("rect")
      .data(rows)
      .join("rect")
      .attr("x", (r: Row) => x(str(r[xKey])))
      .attr("y", (r: Row) => y(str(r[yKey])))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("rx", 2)
      .style("fill", (r: Row) => color(num(r[valueKey])))
      .on("mousemove", (ev: MouseEvent, r: Row) =>
        showTip(
          ev,
          tip(`${str(r[yKey])} · ${str(r[xKey])}`, [
            [valueKey, formatNum(num(r[valueKey]))],
          ]),
        ),
      )
      .on("mouseleave", hideTip);
    const xa = g.append("g").attr("class", "axis axis-x")
      .attr("transform", `translate(0,${ih})`)
      .call(D.axisBottom(x).tickSize(0))
      .call((a: D3) => a.select(".domain").remove());
    xa.selectAll("text").each(function (this: SVGTextElement, k: string) {
      writeAxisLabel(this, xLabels.get(k)!, text.lineHeight, 0, text.size + 6);
    });
    const ya = g.append("g").attr("class", "axis axis-y")
      .call(D.axisLeft(y).tickSize(0).tickPadding(6))
      .call((a: D3) => a.select(".domain").remove());
    ya.selectAll("text").each(function (this: SVGTextElement, k: string) {
      const label = yLabels.get(k)!;
      writeAxisLabel(this, label, text.lineHeight, -6, -label.height / 2 + text.size);
    });
    text.dispose();
  }

  /** Part-to-whole rectangles; `series` groups leaves under a parent. */
  function treemapChart(el: HTMLElement, spec: ChartSpec, rows: Row[]) {
    const D = d3();
    const labelKey = spec.mapping.label || "label";
    const valueKey = spec.mapping.value || "value";
    const groupKey = spec.mapping.series;
    const { W, H } = box(el);
    const leaves = rows
      .map((r) => ({
        name: str(r[labelKey]) || "(blank)",
        group: groupKey ? str(r[groupKey]) || "(blank)" : "",
        value: Math.max(0, num(r[valueKey])),
      }))
      .filter((d) => d.value > 0);
    if (!leaves.length)
      return empty(el, "Nothing to size: every value is zero.");
    const tree = groupKey
      ? {
          children: [...D.group(leaves, (d: { group: string }) => d.group)].map(
            ([name, children]: [string, unknown[]]) => ({ name, children }),
          ),
        }
      : { children: leaves };
    const root = D.hierarchy(tree)
      .sum((d: { value?: number }) => d.value ?? 0)
      .sort((a: D3, b: D3) => b.value - a.value);
    D.treemap()
      .size([W, H])
      .paddingInner(2)
      .paddingTop(groupKey ? 2 : 0)
      .round(true)(root);
    const total = root.value || 1;

    const svg = D.select(el)
      .append("svg")
      .attr("width", W)
      .attr("height", H)
      .style("display", "block");
    const cell = svg
      .selectAll("g")
      .data(root.leaves())
      .join("g")
      .attr("transform", (d: D3) => `translate(${d.x0},${d.y0})`);
    cell
      .append("rect")
      .attr("width", (d: D3) => d.x1 - d.x0)
      .attr("height", (d: D3) => d.y1 - d.y0)
      .attr("rx", 3)
      .attr("fill", (d: D3) =>
        groupKey
          ? categoryColor(groupKey, d.data.group)
          : categoryColor(labelKey, d.data.name),
      )
      .on("mousemove", (ev: MouseEvent, d: D3) =>
        showTip(
          ev,
          tip(d.data.name, [
            ...(groupKey
              ? ([[groupKey, d.data.group]] as [string, string][])
              : []),
            [valueKey, formatNum(d.value)],
            ["Share", `${((d.value / total) * 100).toFixed(1)}%`],
          ]),
        ),
      )
      .on("mouseleave", hideTip);
    const big = cell.filter((d: D3) => d.x1 - d.x0 > 56 && d.y1 - d.y0 > 30);
    big
      .append("text")
      .attr("class", "aie-treemap-t")
      .attr("x", 6)
      .attr("y", 15)
      .text((d: D3) => {
        const room = Math.floor((d.x1 - d.x0 - 10) / 6.4);
        return d.data.name.length > room
          ? `${d.data.name.slice(0, Math.max(1, room - 1))}…`
          : d.data.name;
      });
    big
      .append("text")
      .attr("class", "aie-treemap-v")
      .attr("x", 6)
      .attr("y", 29)
      .text((d: D3) => formatNum(d.value));
  }

  /**
   * Choropleth by country / US state (`region`), or bubbles at `lat`/`lon`.
   * Shapes load lazily; a newer draw on the same element wins the race.
   */
  async function mapChart(el: HTMLElement, spec: ChartSpec, rows: Row[]) {
    const D = d3();
    const token =
      ((el as HTMLElement & { __mapToken?: number }).__mapToken ?? 0) + 1;
    (el as HTMLElement & { __mapToken?: number }).__mapToken = token;
    const m = spec.mapping;
    const valueKey = m.value || "value";
    const regionKey = m.region || m.label;
    const bubbles = Boolean(m.lat && m.lon);
    const scope: GeoScope =
      m.scope ??
      (!bubbles && regionKey && looksLikeUsStates(rows.map((r) => r[regionKey]))
        ? "usa"
        : "world");

    el.innerHTML = `<p class="aie-muted">Loading map…</p>`;
    let features;
    try {
      features = await loadGeo(scope);
    } catch (e) {
      if ((el as HTMLElement & { __mapToken?: number }).__mapToken === token)
        empty(
          el,
          e instanceof Error ? e.message : "Map shapes failed to load.",
        );
      return;
    }
    if (
      (el as HTMLElement & { __mapToken?: number }).__mapToken !== token ||
      !el.isConnected
    )
      return;
    el.innerHTML = "";

    const values = new Map<string, number>();
    let unmatched = 0;
    if (!bubbles && regionKey) {
      const match = regionIndex(scope, features);
      for (const r of rows) {
        const name = match(r[regionKey]);
        if (!name) {
          unmatched++;
          continue;
        }
        values.set(name, (values.get(name) ?? 0) + num(r[valueKey]));
      }
    }
    const vs = bubbles
      ? rows.map((r) => num(r[valueKey]))
      : [...values.values()];
    const lo = D.min(vs) ?? 0;
    const hi = D.max(vs) ?? 1;
    const color = sequential(Math.min(0, lo), hi);

    const key = document.createElement("div");
    key.className = "aie-map-key";
    key.innerHTML = bubbles
      ? `<span class="aie-muted">Dot size = ${escapeHtml(valueKey)}</span>`
      : `<span>${formatNum(Math.min(0, lo))}</span><i style="background:linear-gradient(90deg,${color(Math.min(0, lo))},${color(hi)})"></i><span>${formatNum(hi)}</span>` +
        (unmatched
          ? `<span class="aie-muted" title="Values that didn’t match a ${scope === "usa" ? "US state" : "country"}">· ${unmatched} unmatched</span>`
          : "");
    el.appendChild(key);

    const { W, H } = box(el);
    const fc = { type: "FeatureCollection", features };
    const projection = (
      scope === "usa" ? D.geoAlbersUsa() : D.geoNaturalEarth1()
    ).fitSize([W, H], fc);
    const path = D.geoPath(projection);
    const svg = D.select(el)
      .append("svg")
      .attr("width", W)
      .attr("height", H)
      .style("display", "block");
    svg
      .append("g")
      .selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "aie-geo")
      .attr("d", path)
      .style("fill", (f: D3) => {
        const v = values.get(f.properties.name);
        return v == null ? null : color(v);
      })
      .on("mousemove", (ev: MouseEvent, f: D3) => {
        const v = values.get(f.properties.name);
        showTip(
          ev,
          tip(f.properties.name, [
            [valueKey, v == null ? "No data" : formatNum(v)],
          ]),
        );
      })
      .on("mouseleave", hideTip);

    if (bubbles) {
      const r = D.scaleSqrt()
        .domain([0, hi || 1])
        .range([2, 18]);
      const pts = rows
        .map((row) => ({
          row,
          p: projection([num(row[m.lon!]), num(row[m.lat!])]),
        }))
        .filter((d) => d.p)
        .sort((a, b) => num(b.row[valueKey]) - num(a.row[valueKey]));
      svg
        .append("g")
        .selectAll("circle")
        .data(pts)
        .join("circle")
        .attr("cx", (d: D3) => d.p[0])
        .attr("cy", (d: D3) => d.p[1])
        .attr("r", (d: D3) => r(Math.max(0, num(d.row[valueKey]))))
        .attr("fill", primaryColor())
        .attr("fill-opacity", 0.6)
        .attr("stroke", primaryColor())
        .on("mousemove", (ev: MouseEvent, d: D3) =>
          showTip(
            ev,
            tip(
              m.label
                ? str(d.row[m.label])
                : `${num(d.row[m.lat!]).toFixed(2)}, ${num(d.row[m.lon!]).toFixed(2)}`,
              [[valueKey, formatNum(num(d.row[valueKey]))]],
            ),
          ),
        )
        .on("mouseleave", hideTip);
    }
  }

  return { renderD3Chart, primaryColor, categoryColor };
}
