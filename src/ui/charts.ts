/**
 * Dependency-free SVG chart builders shared by the floating panel, popup and
 * report page. All functions return SVG markup strings built only from
 * numeric data and escaped labels.
 */
import { escapeHtml } from '../utils/index.js';

// Single source of truth for verdict hues — must stay in sync with the chip /
// outline colors in content.css so panel charts and on-page marks read as one.
export const VERDICT = {
  good: '#1c8a5f',
  ok: '#7c9633',
  warn: '#c07d1c',
  bad: '#c23b40',
} as const;

/** Map a 0–100 trust score to a verdict color. */
export function scoreColor(score: number): string {
  if (score >= 80) return VERDICT.good;
  if (score >= 60) return VERDICT.ok;
  if (score >= 40) return VERDICT.warn;
  return VERDICT.bad;
}

/**
 * Animated circular progress gauge. The arc animates via CSS
 * stroke-dashoffset transition (respects prefers-reduced-motion).
 */
export function gaugeSvg(score: number, size = 148): string {
  const r = 62;
  const c = 2 * Math.PI * r;
  const target = c * (1 - score / 100);
  const color = scoreColor(score);
  return `
<svg class="rs-gauge" viewBox="0 0 148 148" width="${size}" height="${size}" role="img"
     aria-label="Trust index ${score} out of 100">
  <circle cx="74" cy="74" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="11"/>
  <circle class="rs-gauge__arc" cx="74" cy="74" r="${r}" fill="none" stroke="${color}"
          stroke-width="11" stroke-linecap="round" transform="rotate(-90 74 74)"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}"
          data-target="${target.toFixed(1)}"/>
  <text x="74" y="72" text-anchor="middle" class="rs-gauge__num" fill="${color}">${score}</text>
  <text x="74" y="94" text-anchor="middle" class="rs-gauge__sub" fill="currentColor">/ 100</text>
</svg>`;
}

/** Trigger the gauge arc animation after insertion into the DOM. */
export function animateGauges(root: ParentNode): void {
  for (const arc of root.querySelectorAll<SVGCircleElement>('.rs-gauge__arc')) {
    const target = arc.dataset.target ?? '0';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        arc.style.strokeDashoffset = target;
      }),
    );
  }
}

/** Horizontal rating-distribution bars (5★ → 1★). */
export function ratingBarsSvg(dist: Record<1 | 2 | 3 | 4 | 5, number>): string {
  const total = dist[1] + dist[2] + dist[3] + dist[4] + dist[5] || 1;
  const rows = ([5, 4, 3, 2, 1] as const)
    .map((star, i) => {
      const count = dist[star];
      const pct = (count / total) * 100;
      const y = i * 26;
      const color = star >= 4 ? VERDICT.good : star === 3 ? VERDICT.warn : VERDICT.bad;
      return `
  <text x="0" y="${y + 14}" class="rs-chart__label">${star}★</text>
  <rect x="26" y="${y + 4}" width="150" height="12" rx="6" fill="currentColor" fill-opacity="0.1"/>
  <rect x="26" y="${y + 4}" width="${(pct * 1.5).toFixed(1)}" height="12" rx="6" fill="${color}"/>
  <text x="184" y="${y + 14}" class="rs-chart__value">${count}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 220 132" width="100%" role="img" aria-label="Rating distribution">${rows}</svg>`;
}

/** Donut chart of review trust levels. */
export function trustDonutSvg(counts: { genuine: number; mixed: number; suspicious: number }): string {
  const total = counts.genuine + counts.mixed + counts.suspicious || 1;
  const r = 40;
  const c = 2 * Math.PI * r;
  const segs: Array<{ value: number; color: string }> = [
    { value: counts.genuine, color: VERDICT.good },
    { value: counts.mixed, color: VERDICT.warn },
    { value: counts.suspicious, color: VERDICT.bad },
  ];
  let offset = 0;
  const circles = segs
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / total) * c;
      const el = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${s.color}" stroke-width="14"
        stroke-dasharray="${len.toFixed(1)} ${(c - len).toFixed(1)}"
        stroke-dashoffset="${(-offset).toFixed(1)}" transform="rotate(-90 50 50)"/>`;
      offset += len;
      return el;
    })
    .join('');
  return `<svg viewBox="0 0 100 100" width="96" height="96" role="img"
    aria-label="${counts.genuine} trusted, ${counts.mixed} mixed, ${counts.suspicious} suspicious reviews">
    ${circles}
    <text x="50" y="49" text-anchor="middle" class="rs-donut__num">${total}</text>
    <text x="50" y="62" text-anchor="middle" class="rs-donut__sub">reviews</text>
  </svg>`;
}

/**
 * Reviews-per-month bar chart. Reviews are bucketed into real calendar months
 * from the first review through the current month, so the bars show posting
 * volume and trend (a burst month is immediately visible). The busiest month is
 * highlighted and labeled, and a faint max gridline gives scale.
 */
export function timelineSvg(points: Array<{ day: string; count: number }>): string {
  const dated = points
    .map((p) => ({ t: Date.parse(p.day), count: p.count }))
    .filter((p) => Number.isFinite(p.t));
  const withReviews = dated.filter((d) => d.count > 0);
  if (withReviews.length === 0) {
    return `<div class="rs-empty">Not enough dated reviews for a timeline.</div>`;
  }

  // Calendar buckets: first review's month → last point's month (the analyzer
  // appends today, so the range always reaches the current period).
  const start = new Date(Math.min(...withReviews.map((d) => d.t)));
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(Math.max(...dated.map((d) => d.t)));

  const monthDiff = (a: Date, b: Date): number =>
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const spanMonths = Math.max(0, monthDiff(start, end));

  // Adaptive granularity. A fixed month cap would silently DROP every review
  // past the cap (an 8-year history left 95% of reviews uncounted); widening
  // the bucket instead keeps every review AND keeps the chart readable.
  const step = spanMonths <= 24 ? 1 : spanMonths <= 72 ? 3 : spanMonths <= 144 ? 6 : 12;
  const months = Array.from({ length: Math.floor(spanMonths / step) + 1 }, (_, i) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i * step);
    return { t: d.getTime(), count: 0 };
  });

  for (const d of dated) {
    const idx = Math.floor(monthDiff(start, new Date(d.t)) / step);
    if (idx >= 0 && idx < months.length) months[idx]!.count += d.count;
  }

  const maxB = Math.max(1, ...months.map((m) => m.count));
  const peak = months.findIndex((m) => m.count === maxB);
  const unit = step === 1 ? 'mo' : step === 12 ? 'yr' : `${step}mo`;

  const W = 260, H = 96, x0 = 6, x1 = 254;
  const topPad = 12, baseline = 70;
  const plotH = baseline - topPad;
  const N = months.length;
  const slot = (x1 - x0) / N;
  const barW = Math.min(22, slot * 0.68);

  const bars = months
    .map((m, i) => {
      const bh = (m.count / maxB) * plotH;
      const x = x0 + i * slot + (slot - barW) / 2;
      const y = baseline - bh;
      const isPeak = i === peak && m.count > 0;
      const opacity = isPeak ? '0.95' : '0.45';
      const label = isPeak
        ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" class="rs-chart__value">${m.count}</text>`
        : '';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="2" fill="${VERDICT.warn}" fill-opacity="${opacity}"/>${label}`;
    })
    .join('');

  // The peak bar reaches the top line, so its value label sits at the same
  // height as the "max N/unit" reference label. Pinning that reference to the
  // side OPPOSITE the peak keeps the two apart no matter the font metrics — a
  // fixed corner would collide whenever the peak landed under it ("29max 29").
  const peakCenterX = x0 + peak * slot + slot / 2;
  const peakOnLeft = peakCenterX < (x0 + x1) / 2;
  const maxLabel = peakOnLeft
    ? `<text x="${x1}" y="${topPad - 3}" text-anchor="end" class="rs-chart__label">max ${maxB}/${unit}</text>`
    : `<text x="${x0}" y="${topPad - 3}" text-anchor="start" class="rs-chart__label">max ${maxB}/${unit}</text>`;

  // Which buckets get an x-axis label. Anchoring from the END and stepping back
  // by a fixed stride guarantees the most recent bucket is always labelled and
  // that no two labels are closer than one stride apart — so they never overlap
  // (a forced last label colliding with a regular one caused "jul ’25" and
  // "jul ’26" to print on top of each other). The first bucket is added only if
  // there is room, to keep both ends of the range visible.
  const stride = Math.ceil(N / 6);
  const shown = new Set<number>();
  for (let i = N - 1; i >= 0; i -= stride) shown.add(i);
  if (Math.min(...shown) >= stride) shown.add(0);

  const monthName = (t: number): string => {
    const d = new Date(t);
    if (step >= 12) return String(d.getFullYear());
    const name = d.toLocaleDateString(undefined, { month: 'short' }).replace('.', '');
    // Multi-month buckets (and each January) need the year for context.
    return step >= 3 || d.getMonth() === 0
      ? `${name} ’${String(d.getFullYear()).slice(2)}`
      : name;
  };
  // Labels are sparse (one every `stride` buckets), so without a mark on the
  // axis it is unclear which x each month names — it reads as "the label doesn't
  // line up with a bar". A short tick at the exact label x anchors it to the
  // axis, so the eye maps "oct ’22" to that precise position (bar or gap).
  const ticks = months
    .map((m, i) => {
      if (!shown.has(i)) return '';
      const x = x0 + i * slot + slot / 2;
      return `<line x1="${x.toFixed(1)}" y1="${baseline}" x2="${x.toFixed(1)}" y2="${baseline + 3}" stroke="currentColor" stroke-opacity="0.4"/><text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="rs-chart__label">${escapeHtml(monthName(m.t))}</text>`;
    })
    .join('');

  const total = months.reduce((sum, m) => sum + m.count, 0);
  return `
<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${total} dated reviews over time, busiest period has ${maxB}">
  <line x1="${x0}" y1="${topPad}" x2="${x1}" y2="${topPad}" stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="3 3"/>
  ${maxLabel}
  <line x1="${x0}" y1="${baseline}" x2="${x1}" y2="${baseline}" stroke="currentColor" stroke-opacity="0.22"/>
  ${bars}
  ${ticks}
</svg>`;
}
