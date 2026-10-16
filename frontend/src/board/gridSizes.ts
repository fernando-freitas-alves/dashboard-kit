/**
 * Datadog-like discrete board sizes on a 12-column grid.
 * Widgets snap to these widths/heights on resize stop (and when added).
 */

export const BOARD_COLS = 12;
export const BOARD_ROW_H = 40;
/** Gap between tiles — a bit roomier than default RGL 10px, closer to dash-kit card gutters. */
export const BOARD_MARGIN: [number, number] = [16, 16];

/** Allowed widths in grid units (¼, ⅓, ½, ⅔, full). Skip ⅙ — too narrow for prompts. */
export const WIDTH_STEPS = [3, 4, 6, 8, 12] as const;

/** Allowed heights in grid rows. */
export const HEIGHT_STEPS = [4, 6, 8, 10, 12, 14, 16] as const;

export const DEFAULT_SIZE = {
  w: 6,
  h: 8,
  minW: 3,
  minH: 4,
  maxW: 12,
  maxH: 16,
};

function nearest(steps: readonly number[], value: number): number {
  let best = steps[0];
  let bestDist = Math.abs(value - best);
  for (const step of steps) {
    const d = Math.abs(value - step);
    if (d < bestDist) {
      best = step;
      bestDist = d;
    }
  }
  return best;
}

/** Snap a layout item to the allowed Datadog-like size ladder. */
export function snapLayoutItem<
  T extends {
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    maxW?: number;
    maxH?: number;
  },
>(item: T): T {
  const w = nearest(WIDTH_STEPS, item.w);
  const h = nearest(HEIGHT_STEPS, item.h);
  return {
    ...item,
    w,
    h,
    minW: WIDTH_STEPS[0],
    minH: HEIGHT_STEPS[0],
    maxW: WIDTH_STEPS[WIDTH_STEPS.length - 1],
    maxH: HEIGHT_STEPS[HEIGHT_STEPS.length - 1],
  };
}

export function snapLayouts<T extends { w: number; h: number }>(
  layouts: T[],
): T[] {
  return layouts.map((l) => snapLayoutItem(l));
}
