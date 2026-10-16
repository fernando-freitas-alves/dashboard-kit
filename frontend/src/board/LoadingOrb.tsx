import { useEffect, useRef } from "react";

const SEGMENTS = 120;
/** One full grow-and-shrink cycle of the ring. */
const PULSE_SECONDS = 3.2;

/**
 * Loading visual for board tiles: a single neon ring that slowly wobbles and
 * pulses (grows and shrinks, glow brightening as it grows), with a Techie Blue →
 * Smart Green → lime gradient rotating around it.
 *
 * Canvas-drawn (one element per tile), sized from its box via ResizeObserver and
 * capped at 2× DPR. Glow blends additively on the dark theme and normally on the
 * light theme (additive light vanishes on white). Skips drawing while scrolled out
 * of view. Each mount starts at a random point in the animation. Under
 * `prefers-reduced-motion` it paints a single still frame.
 */
export function LoadingOrb() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Wobble, spin and pulse have unrelated periods, so a random time offset
    // gives every mount (and each tile loading side by side) its own phase.
    const offset = Math.random() * 60;

    let w = 0;
    let h = 0;
    let visible = true;

    /** Closed, gently deformed circle — the organic wobble of the ring. */
    const ringPath = (cx: number, cy: number, R: number, t: number) => {
      ctx.beginPath();
      for (let i = 0; i <= SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        const r =
          R *
          (1 +
            0.035 * Math.sin(2 * a + t * 1.1) +
            0.025 * Math.sin(3 * a - t * 1.7) +
            0.012 * Math.sin(5 * a + t * 2.3));
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const draw = (t: number) => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      const dark =
        document.documentElement.getAttribute("data-theme") !== "light";
      const cx = w / 2;
      const cy = h / 2;
      const breath = (1 - Math.cos((t * Math.PI * 2) / PULSE_SECONDS)) / 2;
      const R = Math.min(w, h) * 0.28 * (0.93 + breath * 0.14);
      if (R < 4) return;

      const spin = t * 0.7;
      const grad = ctx.createLinearGradient(
        cx + Math.cos(spin) * R,
        cy + Math.sin(spin) * R,
        cx - Math.cos(spin) * R,
        cy - Math.sin(spin) * R,
      );
      grad.addColorStop(
        0,
        getComputedStyle(canvas).getPropertyValue("--blue").trim() || "#71c7d5",
      );
      grad.addColorStop(
        0.5,
        getComputedStyle(canvas).getPropertyValue("--teal").trim() || "#78d7a5",
      );
      grad.addColorStop(1, "#b5d996");

      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      ctx.lineJoin = "round";

      const haze = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.9);
      haze.addColorStop(0, "rgba(0,214,214,0)");
      haze.addColorStop(
        0.2,
        dark ? "rgba(0,214,214,0.1)" : "rgba(0,214,214,0.07)",
      );
      haze.addColorStop(
        0.34,
        dark ? "rgba(20,214,77,0.3)" : "rgba(20,214,77,0.18)",
      );
      haze.addColorStop(
        0.62,
        dark ? "rgba(20,214,77,0.09)" : "rgba(20,214,77,0.05)",
      );
      haze.addColorStop(1, "rgba(20,214,77,0)");
      ctx.fillStyle = haze;
      ctx.globalAlpha = 0.75 + breath * 0.25;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.shadowColor = dark ? "rgba(20,214,77,0.9)" : "rgba(20,214,77,0.55)";
      ctx.strokeStyle = grad;

      ringPath(cx, cy, R, t);
      ctx.shadowBlur = R * 0.9;
      ctx.lineWidth = R * 0.34;
      ctx.globalAlpha = (dark ? 0.1 : 0.08) * (0.7 + breath * 0.3);
      ctx.stroke();

      ctx.shadowColor = dark ? "rgba(0,214,214,0.8)" : "rgba(0,214,214,0.4)";
      ringPath(cx, cy, R * 0.93, t + 0.4);
      ctx.shadowBlur = R * 0.3;
      ctx.lineWidth = R * 0.06;
      ctx.globalAlpha = dark ? 0.35 : 0.25;
      ctx.stroke();

      ctx.shadowColor = dark ? "rgba(20,214,77,0.95)" : "rgba(20,214,77,0.6)";
      ringPath(cx, cy, R, t);
      ctx.shadowBlur = R * 0.45;
      ctx.lineWidth = R * 0.14;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.restore();

      if (dark) {
        ringPath(cx, cy, R, t);
        ctx.lineWidth = R * 0.05;
        ctx.strokeStyle = "rgba(225,255,235,0.55)";
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduced) draw(offset);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    io.observe(canvas);

    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      if (visible) draw(offset + (now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    if (!reduced) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="aie-orb" aria-hidden="true" />;
}
