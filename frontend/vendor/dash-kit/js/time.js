/**
 * dash-kit — day-number time helpers.
 *
 * Dashboards bucket by day far more often than by millisecond, so the kit's
 * unit of time is a **day number**: whole UTC days since the epoch. It is a
 * small integer, so it packs into typed arrays and compares without allocating
 * a Date. Everything here converts to or from that unit; all arithmetic is UTC,
 * which keeps buckets stable regardless of the viewer's timezone.
 */

/** Milliseconds in a day. */
export const DAY = 864e5;

/** Day number from an ISO date or datetime string. */
export const dayOf = s => Math.floor(Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / DAY);

/** ISO date (YYYY-MM-DD) from a day number. */
export const iso = d => new Date(d * DAY).toISOString().slice(0, 10);

/** Day of week for a day number: 0 = Sunday. */
export const dow = d => new Date(d * DAY).getUTCDay();

/** Day number of the Monday that starts this day's week. */
export const wkStart = d => d - ((dow(d) + 6) % 7);

/** Sortable month key (year * 12 + month index) from a day number. */
export const monKey = d => {
  const x = new Date(d * DAY);
  return x.getUTCFullYear() * 12 + x.getUTCMonth();
};

/** Day number of the first day of a month key. */
export const monStart = k => Math.floor(Date.UTC(Math.floor(k / 12), k % 12, 1) / DAY);

export const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekdays in reading order for charts — the working week first. */
export const WD_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2026" from a month key. */
export const fmtMon = k => `${MON[k % 12]} ${Math.floor(k / 12)}`;

/** "Sep 24" from a day number. */
export const fmtDay = d => {
  const x = new Date(d * DAY);
  return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}`;
};

/** Today as a day number, taken from the viewer's local calendar date. */
export const todayDay = () => {
  const n = new Date();
  return Math.floor(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY);
};
