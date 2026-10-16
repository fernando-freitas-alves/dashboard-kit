import type { ChartSpec, DashboardOptions } from "../contracts";

export function formatNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 1000 ? 1 : 2 });
}

export function fieldPresentation(
  resolver: DashboardOptions["fieldPresentation"], spec: ChartSpec, field: string,
) {
  const configured = resolver?.(spec, field);
  const format = configured?.format ?? formatNum;
  return { label: configured?.label ?? field, format, axisFormat: configured?.axisFormat ?? format };
}
