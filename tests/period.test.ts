import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayRangeFromLabel } from '../frontend/src/board/period.ts';

const day = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86400000;

test('time buckets include complete days, weeks and calendar months', () => {
  assert.deepEqual(dayRangeFromLabel('2026-03-08'), { from: day('2026-03-08'), to: day('2026-03-09') });
  assert.deepEqual(dayRangeFromLabel('2026-03-08', 'week'), { from: day('2026-03-08'), to: day('2026-03-15') });
  for (const [start, end] of [['2024-02-01', '2024-03-01'], ['2026-02-01', '2026-03-01'], ['2026-12-01', '2027-01-01']]) {
    assert.deepEqual(dayRangeFromLabel(start, 'month'), { from: day(start), to: day(end) });
  }
  for (const label of ['Organic', '2026-02-30', '2026-13-01', '2026-2-01']) assert.equal(dayRangeFromLabel(label), null);
});
