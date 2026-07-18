/**
 * Timeline chart: must bucket reviews into real calendar months. Regression
 * guard for the "max 1 with 59 reviews" bug, where the chart looked broken
 * because dates were missing / bucketing was not per-month.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { timelineSvg } from './.build/charts.js';

/** ISO day, `monthsAgo` calendar months back from today. */
const monthsAgo = (n, dayOfMonth = 15) => {
  const d = new Date();
  d.setDate(dayOfMonth);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

test('buckets reviews per calendar month and reports the real max', () => {
  // 3 months of activity: 12, 20 and 9 reviews (same-day clustering, as
  // relative dates produce), plus the analyzer's today boundary.
  const svg = timelineSvg([
    { day: monthsAgo(3), count: 12 },
    { day: monthsAgo(2), count: 20 },
    { day: monthsAgo(1), count: 9 },
    { day: today(), count: 0 },
  ]);
  assert.match(svg, /max 20\/mo/, 'max must reflect the busiest month, not 1');
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test('same-month reviews on different days are summed into one bar', () => {
  const d = new Date();
  d.setDate(3);
  const day3 = new Date(d);
  d.setDate(20);
  const day20 = new Date(d);
  const svg = timelineSvg([
    { day: day3.toISOString().slice(0, 10), count: 30 },
    { day: day20.toISOString().slice(0, 10), count: 29 },
  ]);
  assert.match(svg, /max 59\/mo/, '30 + 29 in the same month must total 59');
});

test('renders one bar per month across the span', () => {
  const svg = timelineSvg([
    { day: monthsAgo(4), count: 5 },
    { day: today(), count: 0 },
  ]);
  // months spanned: 4 months ago → this month = 5 buckets
  assert.equal((svg.match(/<rect/g) ?? []).length, 5);
});

test('long histories (years) keep EVERY review — no silent truncation', () => {
  // Regression: a fixed 24-month cap dropped everything past it, so an 8-year
  // history showed "max 1/mo" while 80+ reviews went uncounted.
  const svg = timelineSvg([
    { day: monthsAgo(96), count: 3 },   // 8 years ago
    { day: monthsAgo(60), count: 30 },  // 5 years ago — the real peak
    { day: monthsAgo(12), count: 7 },
    { day: today(), count: 0 },
  ]);
  assert.match(svg, /max 30\//, 'peak must be the real busiest period, not a truncated 1');
  assert.doesNotMatch(svg, /max 1\//);
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test('long spans widen the bucket instead of exploding the bar count', () => {
  const svg = timelineSvg([
    { day: monthsAgo(96), count: 3 },
    { day: today(), count: 0 },
  ]);
  const bars = (svg.match(/<rect/g) ?? []).length;
  assert.ok(bars > 0 && bars <= 24, `expected a readable bar count, got ${bars}`);
  assert.doesNotMatch(svg, /max \d+\/mo/, 'an 8-year span must not be labelled per-month');
});

test('no dated reviews → explicit empty state, never a broken chart', () => {
  assert.match(timelineSvg([]), /Not enough dated reviews/);
  assert.match(timelineSvg([{ day: today(), count: 0 }]), /Not enough dated reviews/);
});

test('x-axis labels never overlap on a multi-year history', () => {
  // The screenshot bug: a 9-year span printed "jul ’25" and "jul ’26" on top of
  // each other because the forced last label collided with a regular one.
  const svg = timelineSvg([
    { day: monthsAgo(108), count: 4 }, // 9 years ago
    { day: monthsAgo(60), count: 30 },
    { day: monthsAgo(24), count: 12 },
    { day: today(), count: 0 },
  ]);
  // Axis labels sit on the baseline row (y = H - 6 = 90); the "max N" label is
  // higher up, so filtering by y isolates the tick labels.
  const xs = [...svg.matchAll(/<text x="([\d.]+)" y="90"[^>]*class="rs-chart__label"/g)].map(
    (m) => Number(m[1]),
  );
  assert.ok(xs.length >= 2, `expected several axis labels, got ${xs.length}`);
  const sorted = [...xs].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i] - sorted[i - 1] >= 24,
      `labels too close (${sorted[i - 1]} → ${sorted[i]}) — they would overlap`,
    );
  }
});

test('a right-side peak sends the "max" label to the left, avoiding overlap', () => {
  // Screenshot bug: the peak value "29" printed on top of "max 29/6mo" because
  // both sit on the top line and the peak bar was near the right edge. The max
  // label must move to the opposite side of the peak.
  const svg = timelineSvg([
    { day: monthsAgo(108), count: 2 },
    { day: monthsAgo(60), count: 10 },
    { day: monthsAgo(6), count: 29 }, // recent peak, near the right edge
    { day: today(), count: 0 },
  ]);
  assert.match(svg, /max 29\//, 'the max is still reported');
  assert.match(svg, /rs-chart__value">29</, 'the peak value stays visible');
  // Peak is on the right, so the max label is anchored to the left edge.
  assert.match(svg, /text-anchor="start" class="rs-chart__label">max 29/, 'max label moved left');
});

test('a left-side peak keeps the "max" label on the right', () => {
  const svg = timelineSvg([
    { day: monthsAgo(108), count: 40 }, // peak at the far left
    { day: monthsAgo(12), count: 6 },
    { day: today(), count: 0 },
  ]);
  assert.match(svg, /text-anchor="end" class="rs-chart__label">max 40/, 'max label stays right');
});

test('the most recent bucket is always labelled', () => {
  const svg = timelineSvg([
    { day: monthsAgo(108), count: 4 },
    { day: today(), count: 0 },
  ]);
  // Last bar's centre x must have a label under it.
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" [^>]*width="([\d.]+)"/g)];
  const last = rects[rects.length - 1];
  const centre = Number(last[1]) + Number(last[2]) / 2;
  const labelXs = [...svg.matchAll(/<text x="([\d.]+)" y="90"/g)].map((m) => Number(m[1]));
  assert.ok(
    labelXs.some((x) => Math.abs(x - centre) <= 6),
    'the final bucket must carry an x-axis label',
  );
});

test('labels the busiest month with its count', () => {
  const svg = timelineSvg([
    { day: monthsAgo(2), count: 7 },
    { day: monthsAgo(1), count: 41 },
    { day: today(), count: 0 },
  ]);
  assert.match(svg, /rs-chart__value">41</, 'peak month shows its count');
});
