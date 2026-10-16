import { dayOf, fmtDay } from "../../vendor/dash-kit/js/time.js";
export type BoardPeriod = { from: number; to: number; label: string };
export function formatPeriodLabel(from: number, to: number) {
  return to === from + 1 ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to - 1)}`;
}
export function dayRangeFromLabel(raw: string, unit: "day" | "week" | "month" = "day") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const from = dayOf(raw);
  if (!Number.isFinite(from) || new Date(from * 86400000).toISOString().slice(0, 10) !== raw) return null;
  const date = new Date(from * 86400000);
  const to = unit === "month"
    ? Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 86400000)
    : from + (unit === "week" ? 7 : 1);
  return { from, to };
}
export function toggleBoardPeriod(
  current: BoardPeriod | null,
  next: BoardPeriod,
) {
  return current?.from === next.from && current?.to === next.to ? null : next;
}
