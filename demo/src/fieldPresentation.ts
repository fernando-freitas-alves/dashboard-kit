import type { DashboardOptions } from '@loadsmart/dashboard-kit';
import { parseQuery } from './browserAdapter';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dollarTicks = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
const counts = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const score = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const labels = { revenue: 'Revenue', orders: 'Orders', tickets: 'Support tickets', satisfaction: 'Customer satisfaction', date: 'Date', month: 'Month', channel: 'Channel', region: 'Region', country: 'Country', product: 'Product', none: 'Total' };

export const demoFieldPresentation: NonNullable<DashboardOptions['fieldPresentation']> = (spec, field) => {
  if (!spec.query) return;
  const { metric, group, series } = parseQuery(spec.query);
  if (field === 'label') return { label: labels[group] };
  if (field === 'series' && series) return { label: labels[series] };
  if (field !== 'value') return;
  return metric === 'revenue'
    ? { label: labels[metric], format: dollars.format, axisFormat: dollarTicks.format }
    : { label: labels[metric], format: metric === 'satisfaction' ? score.format : counts.format };
};
