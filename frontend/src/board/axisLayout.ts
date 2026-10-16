export type AxisLabel = { text: string; lines: string[]; width: number; height: number };

/** Measure the themed SVG font, keeping full labels at a readable size. */
export function axisText(el: HTMLElement) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0";
  const probe = document.createElementNS(ns, "text");
  probe.setAttribute("class", "xl");
  svg.append(probe);
  el.append(svg);
  const font = getComputedStyle(probe);
  const size = parseFloat(font.fontSize) || 11;
  const lineHeight = Math.ceil(size * 1.35);
  const cache = new Map<string, number>();
  const measure = (text: string) => {
    if (cache.has(text)) return cache.get(text)!;
    probe.textContent = text;
    const width = probe.getComputedTextLength?.() || Array.from(text).length * size * 0.65;
    cache.set(text, width);
    return width;
  };
  const wrap = (text: string, width: number): AxisLabel => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      // Long identifiers also wrap; no ellipsis or hidden suffix.
      for (const char of Array.from(word)) {
        if (line && measure(line + char) > width) { lines.push(line); line = ""; }
        line += char;
      }
    }
    if (line || !lines.length) lines.push(line);
    return { text, lines, width: Math.max(0, ...lines.map(measure)), height: lines.length * lineHeight };
  };
  return { measure, wrap, size, lineHeight, dispose: () => svg.remove() };
}

export function writeAxisLabel(node: SVGTextElement, label: AxisLabel, lineHeight: number, x = 0, y = 0) {
  node.textContent = "";
  node.setAttribute("aria-label", label.text);
  node.removeAttribute("dy");
  node.setAttribute("x", String(x));
  node.setAttribute("y", String(y));
  label.lines.forEach((line, index) => {
    const span = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    span.setAttribute("x", String(x));
    span.setAttribute("dy", String(index ? lineHeight : 0));
    span.textContent = line;
    node.append(span);
  });
}

/** Subtract actual wrapping legends and padding, not an estimated row count. */
export function chartViewport(el: HTMLElement) {
  el.classList.add("ldk-chart-axes");
  const style = getComputedStyle(el);
  const px = (value: string) => parseFloat(value) || 0;
  const used = [...el.children].reduce((total, child) => {
    const css = getComputedStyle(child);
    return total + (child as HTMLElement).getBoundingClientRect().height + px(css.marginTop) + px(css.marginBottom);
  }, 0);
  return {
    W: Math.max(40, el.clientWidth - px(style.paddingLeft) - px(style.paddingRight)),
    H: Math.max(20, el.clientHeight - px(style.paddingTop) - px(style.paddingBottom) - used - 2),
  };
}
