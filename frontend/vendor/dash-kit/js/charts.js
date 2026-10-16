import * as d3 from 'd3';
import { axisText, chartViewport, writeAxisLabel } from '../../../src/board/axisLayout';
/**
 * dash-kit — the bar, stacked-bar, grouped-bar and area chart, plus the donut.
 *
 * One function draws all four bar variants because they share everything that
 * matters: the same stacking pass, the same hover tip, the same click-to-filter
 * contract, the same brush. Only the mark differs.
 *
 * Both charts are pure renderers — they hold no filter state. Selection comes
 * in through `o.sel` and clicks go out through `o.onBucket` / `o.onSeries`, so
 * the page decides what cross-filtering means.
 *
 * Requires d3 on the page.
 */

import { esc } from "./dom.js";
import { ANIM, EASE_OUT, EASE_IO, REDUCED, tEnter, tEnterDelay, tFilterUpdate } from "./motion.js";
import { showTip, hideTip } from "./tooltip.js";
import { smart, int, pct } from "./format.js";
import { iso } from "./time.js";

/** What a brushed range means. Set once per page; `o.onRange` overrides per chart. */
let onRangeDefault = () => { };

/**
 * Wire brushing into a page's period model.
 * @param {{ onRange?: (from: number, to: number, label: string, ev: Event) => void }} cfg
 */
export function configureCharts({ onRange } = {}) {
  if (onRange) onRangeDefault = onRange;
}

/**
 * Human label for a brushed bucket span — a single bucket reads as itself,
 * a range as its endpoints.
 */
export function brushPeriodLabel(buckets, i0, i1) {
  const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
  const a = buckets[lo], b = buckets[hi];
  if (lo === hi) return a.label;
  const left = a.short || iso(a.from);
  const right = b.short || iso(b.to - 1);
  return `${left} – ${right}`;
}

/* o: { buckets:[{key,label,short,from,to,weekend}], series:[{key,label,color,dim?,value?,filters?}], val(bi,si), stacked, mode:'bar'|'area',
       line:{label,color,vals:[]}, target:{v,label}, yFmt, sel:{bucket:Set, series:Set}, onBucket(b,ev), onSeries(s,ev,{source}), height, hiddenKey } */
export function barChart(el, o) {
  const animEnter = ANIM.now && ANIM.enter;
  const animUpdate = ANIM.now && ANIM.update;
  const anim = animEnter || animUpdate;
  el.innerHTML = "";
  const hidden = el.__hidden || (el.__hidden = new Set());
  // legend
  const lg = document.createElement("div"); lg.className = "legend";
  const anySel = o.sel?.series?.size > 0;
  for (const s of o.series) {
    // The "Other" bucket dims like any other series: it holds the long tail,
    // never the focused value, so leaving it lit reads as though it were picked.
    const it = document.createElement("span");
    it.className = "lg" + (hidden.has(s.key) ? " off" : "") + (anySel && !o.sel.series.has(s.key) ? " dim" : "");
    const filterable = s.dim && o.onSeries;
    const swatch = document.createElement("i");
    swatch.className = filterable ? "lg-swatch" : "";
    swatch.style.background = s.color;
    const label = document.createElement("span");
    label.className = filterable ? "lg-label" : "";
    label.title = esc(s.label);
    label.textContent = s.label;
    it.append(swatch, label);

    const bindBtn = (node, target, title, ariaLabel, onActivate) => {
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      node.title = title;
      node.setAttribute("aria-label", ariaLabel);
      node.onclick = ev => { ev.stopPropagation(); onActivate(ev); };
      node.onkeydown = ev => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        onActivate(ev);
      };
    };

    if (filterable) {
      it.classList.add("filterable");
      const on = !!o.sel?.series?.has(s.key);
      swatch.setAttribute("aria-pressed", String(on));
      bindBtn(
        swatch,
        "swatch",
        on ? "Remove from filters" : "Add to filters",
        `${s.label}. Color: ${on ? "remove from filters" : "add to filters"}.`,
        ev => o.onSeries(s, ev, { source: "legend", target: "swatch" }),
      );
      bindBtn(
        label,
        "label",
        "Show only this series",
        `${s.label}. Label: show only this series.`,
        ev => o.onSeries(s, ev, { source: "legend", target: "label" }),
      );
    } else {
      it.setAttribute("role", "button");
      it.tabIndex = 0;
      it.title = `${hidden.has(s.key) ? "Show" : "Hide"} ${s.label}`;
      it.setAttribute("aria-label", `${hidden.has(s.key) ? "Show" : "Hide"} ${s.label}`);
      const activate = () => {
        hidden.has(s.key) ? hidden.delete(s.key) : hidden.add(s.key);
        barChart(el, o);
      };
      it.onclick = activate;
      it.onkeydown = ev => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        activate();
      };
    }
    lg.appendChild(it);
  }
  if (o.line) { const it = document.createElement("span"); it.className = "lg" + (hidden.has("__line") ? " off" : ""); it.innerHTML = `<i class="ln" style="background:${o.line.color}"></i><span>${esc(o.line.label)}</span>`; it.onclick = () => { hidden.has("__line") ? hidden.delete("__line") : hidden.add("__line"); barChart(el, o); }; lg.appendChild(it); }
  if (o.target) { const it = document.createElement("span"); it.className = "lg"; it.innerHTML = `<i class="ln" style="background:var(--target)"></i><span>${esc(o.target.label)}</span>`; lg.appendChild(it); }
  el.appendChild(lg);
  const vis = o.series.map((s, i) => [s, i]).filter(([s]) => !hidden.has(s.key));
  const nb = o.buckets.length;
  if (!nb) { const e = document.createElement("div"); e.className = "card-empty"; e.textContent = "No data for the current filters"; el.appendChild(e); return; }
  // stack
  const segs = []; const tot = new Float64Array(nb); let yMax = 0, yMin = 0;
  const stackTop = [], stackBot = [];
  for (let b = 0; b < nb; b++) {
    let pos = 0, neg = 0; const top = [], bot = [];
    for (const [s, si] of vis) {
      const v = o.val(b, si) || 0;
      if (o.stacked === false) { segs.push({ b, s, si, v, y0: 0, y1: v }); pos = Math.max(pos, v); }
      else if (v >= 0) { segs.push({ b, s, si, v, y0: pos, y1: pos + v }); bot.push(pos); pos += v; top.push(pos); }
      else { segs.push({ b, s, si, v, y0: neg + v, y1: neg }); neg += v; }
      tot[b] += v;
    }
    stackTop.push(pos); stackBot.push(neg);
    yMax = Math.max(yMax, pos); yMin = Math.min(yMin, neg);
    if (o.line && !hidden.has("__line") && o.line.vals[b] != null) yMax = Math.max(yMax, o.line.vals[b]);
  }
  if (o.target) yMax = Math.max(yMax, o.target.v);
  if (o.yMax != null) yMax = Math.max(o.yMax, 0) || yMax;
  if (yMax === 0 && yMin === 0) yMax = 1;
  // Room for the brush range label (`.brush-tag` sits at y ≈ -22 in plot coords).
  const brushCapable = o.brush !== false && o.buckets[0].from != null;
  const canBrush = brushCapable && o.buckets[0].to != null;
  if (canBrush) {
    const hint = document.createElement("span");
    hint.className = "brush-hint";
    hint.textContent = "Drag horizontally to select a date range";
    lg.appendChild(hint);
  }
  const viewport = chartViewport(el);
  const text = axisText(el);
  const y = d3.scaleLinear().domain([yMin, yMax]).nice();
  const yLabels = y.ticks(5).map(o.yFmt || smart);
  const m = { t: brushCapable ? 30 : text.lineHeight, r: 10, b: 0,
    l: Math.ceil(Math.max(...yLabels.map(text.measure))) + 14 };
  // Categorical ticks remain complete. Dense charts scroll inside the card.
  const W = Math.max(viewport.W, m.l + m.r + (brushCapable ? 80 : nb * 64));
  const iw = W - m.l - m.r;
  const every = brushCapable ? Math.ceil(nb / Math.max(1, Math.floor(iw / 90))) : 1;
  const labels = o.buckets.map(b => text.wrap(b.label, Math.max(24, iw * every / nb - 14)));
  m.b = Math.max(...labels.map(label => label.height)) + 14;
  const H = Math.max(o.height || viewport.H, m.t + m.b + 80);
  const ih = H - m.t - m.b;
  const x = d3.scaleBand().domain(d3.range(nb)).range([0, iw])
    .paddingInner(o.mode === "area" ? (nb <= 6 ? 0.04 : 0.1) : (nb > 40 ? 0.12 : 0.22))
    .paddingOuter(o.mode === "area" ? 0.02 : 0.08);
  y.range([ih, 0]);
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", H).style("display", "block");
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
  g.append("g").attr("class", "gridl").call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""));
  const yax = g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5).tickFormat(o.yFmt || smart)).call(a => a.select(".domain").remove());
  if (animEnter) yax.style("opacity", 0).transition().duration(420).ease(EASE_OUT).style("opacity", 1);
  // Legend stagger. The inline opacity has to go once the fade lands, or it
  // outranks the .dim / .off classes that show which series are filtered out.
  if (animEnter || animUpdate) {
    d3.select(lg).selectAll(".lg").style("opacity", animUpdate ? 0.55 : 0).transition()
      .duration(animUpdate ? 260 : 320).delay((d, i) => (animEnter ? 40 : 8) * i).ease(EASE_OUT)
      .style("opacity", 1)
      .on("end interrupt", function () { this.style.removeProperty("opacity"); });
  }
  // weekends
  o.buckets.forEach((bk, b) => { if (bk.weekend) g.append("rect").attr("class", "weekend").attr("x", x(b) - x.step() * x.paddingInner() / 2).attr("width", x.step()).attr("y", 0).attr("height", ih); });
  // buckets
  const selB = o.sel?.bucket || new Set();
  const bkG = g.selectAll("g.bk").data(o.buckets).join("g").attr("class", (d) => "bk" + (selB.has(d.key) ? " sel" : ""));
  bkG.append("rect").attr("class", "bg").attr("x", (d, b) => x(b) - x.step() * x.paddingInner() / 2).attr("width", x.step()).attr("y", 0).attr("height", ih);
  const fade = (s, b) => { const bs = selB.size && !selB.has(o.buckets[b].key); const ss = anySel && !o.sel.series.has(s.key); return bs || ss ? 0.28 : 1; };
  if (o.mode !== "area") {
    const bw = o.stacked === false ? x.bandwidth() / Math.max(1, vis.length) : x.bandwidth();
    g.selectAll("rect.seg").data(segs).join("rect").attr("class", "seg")
      .attr("x", d => x(d.b) + (o.stacked === false ? bw * vis.findIndex(v => v[1] === d.si) : 0)).attr("width", Math.max(1, bw))
      // Stacked segments stay square so parts meet flush; only grouped bars get a light radius
      .attr("rx", o.stacked === false && nb <= 60 ? 2 : 0).style("fill", d => d.s.color).style("opacity", d => fade(d.s, d.b))
      .on("pointerdown", (ev) => { ev.stopPropagation(); })
      .on("click", (ev, d) => {
        if (el.__suppressClick) { ev.stopPropagation(); return; }
        ev.stopPropagation(); hideTip();
        if (d.s.dim && o.onSeries) o.onSeries(d.s, ev, { source: "mark" });
        else if (o.onBucket) o.onBucket(o.buckets[d.b], ev);
      })
      .on("mousemove", (ev, d) => { if (!el.classList.contains("is-brushing")) tipFor(ev, d.b, d.s.key); })
      .on("mouseleave", hideTip);
    const fy = d => y(Math.max(d.y0, d.y1)), fh = d => Math.max(0, Math.abs(y(d.y0) - y(d.y1)));
    const targetOp = d => fade(d.s, d.b);
    const bars = g.selectAll("rect.seg");
    if (animEnter) {
      tEnterDelay(bars.attr("y", y(0)).attr("height", 0), d => Math.min(d.b * 600 / nb, 450))
        .attr("y", fy).attr("height", fh).style("opacity", targetOp);
    } else if (animUpdate) {
      tFilterUpdate(bars.attr("y", y(0)).attr("height", 0).style("opacity", targetOp))
        .delay(d => Math.min(d.b * (380 / Math.max(1, nb)), 280))
        .attr("y", fy).attr("height", fh);
    } else {
      bars.attr("y", fy).attr("height", fh).style("opacity", targetOp);
    }
  } else {
    // area: y0/y1 per series per bucket
    const clipId = "clip" + Math.random().toString(36).slice(2);
    const cr = svg.append("defs").append("clipPath").attr("id", clipId).append("rect").attr("x", -2).attr("y", -2).attr("height", ih + 4).attr("width", animEnter ? 0 : iw + 4);
    if (animEnter) tEnter(cr).duration(900).ease(EASE_IO).attr("width", iw + 4);
    const ag = g.append("g").attr("clip-path", `url(#${clipId})`);
    for (const [s, si] of vis) {
      const pts = segs.filter(d => d.si === si).sort((a, b) => a.b - b.b);
      const area = d3.area().x(d => x(d.b) + x.bandwidth() / 2).y0(d => y(d.y0)).y1(d => y(d.y1)).curve(d3.curveMonotoneX);
      ag.append("path").attr("d", area(pts)).style("fill", s.color).style("opacity", anySel && !o.sel.series.has(s.key) ? 0.25 : 0.82).attr("class", "seg")
        .on("pointerdown", (ev) => { ev.stopPropagation(); })
        .on("click", ev => {
          if (el.__suppressClick) { ev.stopPropagation(); return; }
          if (s.dim && o.onSeries) o.onSeries(s, ev, { source: "mark" });
        });
    }
  }
  bkG.on("click", (ev, d) => {
    if (el.__suppressClick) { ev.stopPropagation(); return; }
    hideTip(); o.onBucket && o.onBucket(d, ev);
  }).on("mousemove", (ev, d) => { if (!el.classList.contains("is-brushing")) tipFor(ev, o.buckets.indexOf(d)); }).on("mouseleave", hideTip);
  if (o.mode === "area") bkG.raise().select(".bg").style("fill-opacity", 0.35);
  if (yMin < 0) g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0)).style("stroke", "var(--line-2)");
  // line
  if (o.line && !hidden.has("__line")) {
    const pts = o.line.vals.map((v, b) => v == null ? null : [x(b) + x.bandwidth() / 2, y(v)]);
    const lp = g.append("path").attr("d", d3.line().defined(p => p).curve(d3.curveMonotoneX)(pts)).style("fill", "none").style("stroke", o.line.color).style("stroke-width", 2.2).style("pointer-events", "none");
    const dots = g.selectAll("circle.lp").data(pts.filter(p => p)).join("circle").attr("cx", p => p[0]).attr("cy", p => p[1]).attr("r", nb > 40 ? 0 : 2.6).style("fill", o.line.color).style("pointer-events", "none");
    if (animEnter) {
      const L = lp.node().getTotalLength() || 0; lp.attr("stroke-dasharray", `${L} ${L}`).attr("stroke-dashoffset", L);
      tEnter(lp).delay(300).duration(900).ease(EASE_IO).attr("stroke-dashoffset", 0).on("end", function () { d3.select(this).attr("stroke-dasharray", null); });
      dots.style("opacity", 0).transition().delay((p, i) => 300 + i * (900 / Math.max(1, pts.length))).duration(200).ease(EASE_OUT).style("opacity", 1);
    }
  }
  if (o.target) {
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(o.target.v)).attr("y2", y(o.target.v)).style("stroke", "var(--target)").style("stroke-dasharray", "5 4").style("stroke-width", 1.5).style("pointer-events", "none");
    const tl = g.append("g").style("pointer-events", "none"); if (animEnter) tl.style("opacity", 0).transition().delay(600).duration(400).ease(EASE_OUT).style("opacity", 1); const tw = o.target.label.length * 6.3 + 12;
    tl.append("rect").attr("x", 2).attr("y", y(o.target.v) - 17).attr("width", tw).attr("height", 14).attr("rx", 3).style("fill", "var(--panel)").style("stroke", "var(--target)");
    tl.append("text").attr("x", 7).attr("y", y(o.target.v) - 7).style("fill", "var(--target)").style("font-weight", 600).text(o.target.label);
  }
  const xl = g.append("g").attr("class", "axis axis-x").attr("transform", `translate(0,${ih})`);
  xl.append("line").attr("x2", iw).style("stroke", "var(--line-2)");
  o.buckets.forEach((bk, b) => {
    if (b % every) return;
    const t = xl.append("text").attr("class", "xl").attr("text-anchor", "middle")
      .on("click", ev => { if (el.__suppressClick) return; o.onBucket && o.onBucket(bk, ev); });
    const center = Math.max(labels[b].width / 2, Math.min(iw - labels[b].width / 2, x(b) + x.bandwidth() / 2));
    writeAxisLabel(t.node(), labels[b], text.lineHeight, center, text.size + 6);
    if (selB.has(bk.key)) t.style("fill", "var(--text)").style("font-weight", 600);
  });
  text.dispose();
  if (animEnter) xl.selectAll("text.xl").style("opacity", 0).transition().duration(360).delay((d, i) => 80 + i * 18).ease(EASE_OUT).style("opacity", 1);

  /* ---- Horizontal date-range brush (time charts only) ---- */
  if (canBrush) {
    const stepPad = x.step() * x.paddingInner() / 2;
    const bucketAt = px => {
      const clamped = Math.max(0, Math.min(iw - 0.001, px));
      for (let b = 0; b < nb; b++) {
        const left = x(b) - stepPad, right = left + x.step();
        if (clamped >= left && clamped < right) return b;
      }
      return clamped < x(0) ? 0 : nb - 1;
    };
    const bandX = i => x(i) - stepPad;
    const bandRight = i => bandX(i) + x.step();

    // Geometry here, colour in 07-charts.css — the wash has to follow the theme.
    const brushG = g.append("g").attr("class", "brush-layer").style("pointer-events", "none");
    const brushFill = brushG.append("rect").attr("class", "brush-fill").attr("y", 0).attr("height", ih)
      .attr("rx", 3).attr("stroke-width", 1.25);
    const brushEdgeL = brushG.append("line").attr("class", "brush-edge").attr("y1", 0).attr("y2", ih)
      .attr("stroke-width", 2).attr("stroke-linecap", "round");
    const brushEdgeR = brushG.append("line").attr("class", "brush-edge").attr("y1", 0).attr("y2", ih)
      .attr("stroke-width", 2).attr("stroke-linecap", "round");
    const brushTag = brushG.append("g").attr("class", "brush-tag")
      .style("pointer-events", "all")
      .style("cursor", "pointer")
      .attr("role", "button")
      .attr("aria-label", "Clear date range");
    const tagBg = brushTag.append("rect").attr("class", "brush-tag-bg").attr("rx", 5).attr("height", 18).attr("y", -22);
    const tagTxt = brushTag.append("text").attr("class", "brush-tag-label").attr("y", -9.5).attr("text-anchor", "middle")
      .attr("font-size", 10).attr("font-weight", 700).attr("font-family", "Poppins, sans-serif");
    const tagClear = brushTag.append("text").attr("class", "brush-tag-clear").attr("y", -9.5)
      .attr("font-size", 11).attr("font-weight", 700).attr("font-family", "Poppins, sans-serif")
      .text("×");

    const paintBrush = (i0, i1, { live = false, enter = false } = {}) => {
      const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
      const x0 = bandX(lo), x1 = bandRight(hi), w = Math.max(2, x1 - x0), mid = x0 + w / 2;
      const label = brushPeriodLabel(o.buckets, lo, hi);
      // Room for label + clear × (committed selection only — live drag stays label-only).
      const clearW = live ? 0 : 14;
      tagTxt.text(label).attr("x", clearW ? -clearW / 2 : 0);
      const tw = Math.min(iw - 8, Math.max(48, label.length * 6.4 + 16 + clearW));
      tagClear.style("display", live ? "none" : null).attr("x", tw / 2 - 9);
      const setGeom = (withT) => {
        const fill = withT ? brushFill.transition().duration(live ? 0 : 380).ease(EASE_OUT) : brushFill;
        const eL = withT && !live ? brushEdgeL.transition().duration(380).ease(EASE_OUT) : brushEdgeL;
        const eR = withT && !live ? brushEdgeR.transition().duration(380).ease(EASE_OUT) : brushEdgeR;
        const tag = withT && !live ? brushTag.transition().duration(380).ease(EASE_OUT) : brushTag;
        fill.attr("x", x0).attr("width", w);
        eL.attr("x1", x0).attr("x2", x0);
        eR.attr("x1", x1).attr("x2", x1);
        tag.attr("transform", `translate(${mid},0)`);
        tagBg.attr("x", -tw / 2).attr("width", tw);
      };
      brushG.style("display", null);
      if (enter && !REDUCED) {
        brushG.style("opacity", 0);
        const cx = mid;
        brushFill.attr("x", cx).attr("width", 0);
        brushEdgeL.attr("x1", cx).attr("x2", cx);
        brushEdgeR.attr("x1", cx).attr("x2", cx);
        brushTag.attr("transform", `translate(${cx},0)`);
        tagBg.attr("x", -tw / 2).attr("width", tw);
        brushG.transition().duration(280).ease(EASE_OUT).style("opacity", 1);
        setGeom(true);
      } else {
        brushG.style("opacity", 1);
        setGeom(!live && !REDUCED);
      }
    };
    const hideBrush = () => { brushG.style("display", "none"); };

    // committed selection from period filter
    let cLo = Infinity, cHi = -1;
    o.buckets.forEach((bk, i) => { if (selB.has(bk.key)) { cLo = Math.min(cLo, i); cHi = Math.max(cHi, i); } });
    if (cLo !== Infinity) paintBrush(cLo, cHi, { enter: !!animEnter });
    else hideBrush();

    brushTag.on("pointerdown", (ev) => {
      // Don't start a new brush drag from the clear control.
      ev.stopPropagation();
    }).on("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (cLo === Infinity) return;
      el.__suppressClick = true;
      setTimeout(() => { el.__suppressClick = false; }, 40);
      if (typeof o.onClearRange === "function") o.onClearRange(ev);
      else {
        // Same toggle contract as a second click on the range (dashboard setPeriod).
        const from = o.buckets[cLo].from, to = o.buckets[cHi].to;
        const label = brushPeriodLabel(o.buckets, cLo, cHi);
        if (o.onRange) o.onRange(from, to, label, ev);
        else onRangeDefault(from, to, label, ev);
      }
    });

    let brushState = null;
    const svgNode = svg.node();
    const localX = (ev) => {
      const pt = svgNode.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const ctm = g.node().getScreenCTM();
      if (!ctm) return 0;
      return pt.matrixTransform(ctm.inverse()).x;
    };
    const onDown = (ev) => {
      if (ev.button !== 0) return;
      brushState = { x0: localX(ev), active: false, pointerId: ev.pointerId };
      try { svgNode.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
    };
    const onMove = (ev) => {
      if (!brushState) return;
      const x1 = localX(ev);
      if (!brushState.active && Math.abs(x1 - brushState.x0) >= 8) {
        brushState.active = true;
        hideTip();
        el.classList.add("is-brushing");
        brushG.style("display", null).style("opacity", 1);
      }
      if (!brushState.active) return;
      brushState.x1 = x1;
      paintBrush(bucketAt(brushState.x0), bucketAt(x1), { live: true });
    };
    const onUp = (ev) => {
      if (!brushState) return;
      const was = brushState;
      brushState = null;
      el.classList.remove("is-brushing");
      try { svgNode.releasePointerCapture(was.pointerId); } catch (_) { /* ignore */ }
      if (!was.active) {
        // restore committed brush if any
        if (cLo !== Infinity) paintBrush(cLo, cHi, { live: true });
        else hideBrush();
        return;
      }
      el.__suppressClick = true;
      setTimeout(() => { el.__suppressClick = false; }, 40);
      const i0 = bucketAt(was.x0), i1 = bucketAt(was.x1 ?? was.x0);
      const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
      const from = o.buckets[lo].from, to = o.buckets[hi].to;
      const label = brushPeriodLabel(o.buckets, lo, hi);
      paintBrush(lo, hi, { enter: !REDUCED });
      if (o.onRange) o.onRange(from, to, label, ev);
      else onRangeDefault(from, to, label, ev);
    };
    svgNode.addEventListener("pointerdown", onDown);
    svgNode.addEventListener("pointermove", onMove);
    svgNode.addEventListener("pointerup", onUp);
    svgNode.addEventListener("pointercancel", onUp);
    svgNode.style.touchAction = "none";
  }

  function tipFor(ev, b, focus) {
    const bk = o.buckets[b];
    const rows = vis.map(([s, si]) => ({ s, v: o.val(b, si) || 0 })).filter(r => r.v !== 0);
    if (o.stacked !== false && o.mode !== "area" || true) rows.sort((a, c) => Math.abs(c.v) - Math.abs(a.v));
    const shown = rows.slice(0, 12);
    let h = `<div class="t">${esc(bk.label)}</div>`;
    for (const r of shown) h += `<div class="r"${r.s.key === focus ? ' style="font-weight:700"' : ""}><i style="background:${r.s.color}"></i><span>${esc(r.s.label)}</span><b>${(o.tipFmt || o.yFmt || smart)(r.v)}</b></div>`;
    if (rows.length > 12) h += `<div class="h">+ ${rows.length - 12} more</div>`;
    if (rows.length > 1 && o.stacked !== false && o.showTotal !== false) h += `<div class="r" style="border-top:1px solid var(--tip-line);margin-top:3px;padding-top:3px"><span>Total</span><b>${(o.tipFmt || o.yFmt || smart)(tot[b])}</b></div>`;
    if (o.line && o.line.vals[b] != null) h += `<div class="r"><i style="background:${o.line.color}"></i><span>${esc(o.line.label)}</span><b>${smart(o.line.vals[b])}</b></div>`;
    if (o.extraTip) h += o.extraTip(b);
    const brushNote = (o.brush !== false && o.buckets[0]?.from != null) ? " · Drag: select a date range" : "";
    h += `<div class="h">Click: filter ${o.bucketNoun || "this period"}${focus && vis.find(v => v[0].key === focus)?.[0].dim ? " · segment: filter " + esc(vis.find(v => v[0].key === focus)[0].label) : ""}${brushNote}</div>`;
    showTip(ev, h);
  }
}

export function donut(el, o) {
  const animEnter = ANIM.now && ANIM.enter;
  const animUpdate = ANIM.now && ANIM.update;
  const anim = animEnter || animUpdate;
  el.innerHTML = "";
  const items = o.items.filter(d => d.value > 0);
  if (!items.length) { el.innerHTML = `<div class="card-empty">No data for the current filters</div>`; return; }
  // Fit the ring to the host — never floor width (that clipped narrow board tiles).
  const W = Math.max(0, el.clientWidth - 2);
  const H = Math.max(0, el.clientHeight - 2);
  const legendBudget = H > 0 ? Math.min(110, Math.max(48, H * 0.32)) : 80;
  const maxRByW = Math.max(28, (W - 12) / 2 - 6);
  const maxRByH = Math.max(28, (H - legendBudget - 8) / 2);
  const R0 = Math.min(Math.max(28, W * 0.38), 140, maxRByW, maxRByH);
  const pad = Math.max(4, Math.min(8, R0 * 0.08));
  const hoverGrow = Math.min(5, Math.max(2, R0 * 0.04));
  const sel = o.sel || new Set(); const total = d3.sum(items, d => d.value);
  const wrap = d3.select(el).append("div").attr("class", "donut-wrap");
  const svg = wrap.append("svg").attr("width", R0 * 2 + pad * 2).attr("height", R0 * 2 + pad * 2).attr("class", "donut-svg");
  const g = svg.append("g").attr("transform", `translate(${R0 + pad},${R0 + pad})`);
  const arcs = d3.pie().value(d => d.value).sort(null)(items);
  const arc = d3.arc().innerRadius(R0 * 0.56).outerRadius(R0).cornerRadius(2).padAngle(0.012);
  const arcH = d3.arc().innerRadius(R0 * 0.56).outerRadius(R0 + hoverGrow).cornerRadius(2).padAngle(0.012);
  const slices = g.selectAll("path").data(arcs).join("path").attr("class", "pie-slice").style("fill", d => d.data.color)
    .style("opacity", d => sel.size && !sel.has(d.data.key) ? 0.3 : 1).style("cursor", "pointer")
    .on("click", (ev, d) => { hideTip(); o.onClick(d.data, ev, { source: "mark" }); })
    .on("mousemove", (ev, d) => showTip(ev, `<div class="t">${esc(d.data.label)}</div><div class="r"><span>${esc(o.metric)}</span><b>${int(d.data.value)}</b></div><div class="r"><span>Share</span><b>${pct(d.data.value / total)}</b></div><div class="h">Click to filter the dashboard</div>`))
    .on("mouseenter", function (ev, d) {
      if (REDUCED) return;
      d3.select(this).interrupt().transition().duration(160).ease(EASE_OUT).attr("d", arcH(d));
    })
    .on("mouseleave", function (ev, d) {
      d3.select(this).interrupt().transition().duration(180).ease(EASE_OUT).attr("d", arcFor(d)(d));
      hideTip();
    });
  const arcFor = d => sel.has(d.data.key) ? arcH : arc;
  const sliceOp = d => (sel.size && !sel.has(d.data.key) ? 0.3 : 1);
  if (animEnter) {
    slices.attr("d", d => arcFor(d)({ ...d, endAngle: d.startAngle })).transition().duration(800).delay((d, i) => i * 60).ease(EASE_OUT)
      .attrTween("d", d => { const it = d3.interpolate(d.startAngle, d.endAngle); return t => arcFor(d)({ ...d, endAngle: it(t) }); });
  } else {
    slices.attr("d", d => arcFor(d)(d));
    if (animUpdate) {
      slices.style("opacity", 0.45);
      tFilterUpdate(slices).style("opacity", (d) => sliceOp(d));
    } else {
      slices.style("opacity", sliceOp);
    }
  }
  const plG = g.append("g"); if (animEnter) plG.style("opacity", 0).transition().delay(700).duration(300).ease(EASE_OUT).style("opacity", 1);
  // Hide slice % labels on tiny rings — they collide with the hole.
  const showSlicePct = R0 >= 52;
  plG.selectAll("text.pl").data(showSlicePct ? arcs.filter(d => d.endAngle - d.startAngle > 0.4) : []).join("text")
    .attr("transform", d => `translate(${arc.centroid(d)})`).attr("text-anchor", "middle").attr("dy", "0.35em")
    .style("fill", "#fff").style("font-weight", 600).style("font-size", `${Math.max(9, Math.min(12, R0 * 0.12))}px`)
    .style("pointer-events", "none").text(d => pct(d.data.value / total));
  const cv = o.center ?? total;
  const centerPx = Math.max(11, Math.min(20, R0 * 0.24));
  const labelPx = Math.max(9, Math.min(12, R0 * 0.12));
  const ct = g.append("text").attr("text-anchor", "middle").attr("dy", "-0.15em")
    .style("font-size", `${centerPx}px`).style("font-weight", 700).style("fill", "var(--text)").text(int(cv));
  if (animEnter) ct.transition().duration(900).ease(EASE_OUT).tween("text", function () { const it = d3.interpolateNumber(0, cv); return t => { this.textContent = int(Math.round(it(t))); }; });
  let centerLabel = o.centerLabel || "total";
  // Approx char budget for the hole (inner radius ≈ 0.56 R0).
  const maxChars = Math.max(6, Math.floor((R0 * 0.9) / (labelPx * 0.55)));
  if (centerLabel.length > maxChars) centerLabel = centerLabel.slice(0, Math.max(4, maxChars - 1)) + "…";
  g.append("text").attr("text-anchor", "middle").attr("dy", "1.35em")
    .style("font-size", `${labelPx}px`).style("fill", "var(--muted, var(--text-2))")
    .text(centerLabel);
  const lgNode = wrap.append("div").attr("class", "donut-legend").node();
  items.slice().sort((a, b) => b.value - a.value).forEach((d, i) => {
    const row = document.createElement("div");
    row.className = "lg filterable" + (sel.size && !sel.has(d.key) ? " dim" : "");
    const swatch = document.createElement("i");
    swatch.className = "lg-swatch";
    swatch.style.background = d.color;
    const on = sel.has(d.key);
    swatch.setAttribute("aria-pressed", String(on));
    const label = document.createElement("span");
    label.className = "lg-label";
    label.textContent = d.label;
    const count = document.createElement("b");
    count.textContent = int(d.value);
    row.append(swatch, label, count);

    const bindBtn = (node, title, ariaLabel, target) => {
      node.setAttribute("role", "button");
      node.tabIndex = 0;
      node.title = title;
      node.setAttribute("aria-label", ariaLabel);
      node.onclick = ev => { ev.stopPropagation(); o.onClick(d, ev, { source: "legend", target }); };
      node.onkeydown = ev => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        o.onClick(d, ev, { source: "legend", target });
      };
    };
    bindBtn(swatch, on ? "Remove from filters" : "Add to filters", `${d.label}. Color: ${on ? "remove from filters" : "add to filters"}.`, "swatch");
    bindBtn(label, "Show only this value", `${d.label}. Label: show only this value.`, "label");

    lgNode.appendChild(row);
    // Drop the inline opacity afterwards so `.dim` keeps filtered-out rows muted.
    if (animEnter || animUpdate) {
      d3.select(row).style("opacity", animUpdate ? 0.55 : 0).transition()
        .duration(animUpdate ? 260 : 300).delay((animEnter ? 500 : 40) + i * (animEnter ? 28 : 12)).ease(EASE_OUT)
        .style("opacity", 1)
        .on("end interrupt", function () { this.style.removeProperty("opacity"); });
    }
  });
}
