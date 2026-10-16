import { dayOf, fmtDay } from "../../vendor/dash-kit/js/time.js";
export type BoardPeriod = { from: number; to: number; label: string };
export function formatPeriodLabel(from: number, to: number) {
  return to === from + 1 ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to - 1)}`;
}
export function dayRangeFromLabel(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const from = dayOf(raw);
  return Number.isFinite(from) ? { from, to: from + 1 } : null;
}
export function toggleBoardPeriod(
  current: BoardPeriod | null,
  next: BoardPeriod,
) {
  return current?.from === next.from && current?.to === next.to ? null : next;
}
