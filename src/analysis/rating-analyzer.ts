/**
 * Page-level rating distribution and timing analysis.
 */
import type { PagePattern, ParsedReview, ReviewSubject } from '../types/index.js';

export interface RatingStats {
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  average: number | null;
  timeline: Array<{ day: string; count: number }>;
  patterns: PagePattern[];
}

export function analyzeRatings(reviews: ParsedReview[], subject: ReviewSubject = 'product'): RatingStats {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratedCount = 0;
  let ratingSum = 0;

  for (const r of reviews) {
    if (r.rating !== null && r.rating >= 1 && r.rating <= 5) {
      distribution[Math.round(r.rating) as 1 | 2 | 3 | 4 | 5]++;
      ratedCount++;
      ratingSum += r.rating;
    }
  }

  const patterns: PagePattern[] = [];
  const pct = (n: number) => (ratedCount ? Math.round((n / ratedCount) * 100) : 0);
  const isPlace = subject === 'place';

  // Extreme 5-star share. The baseline differs by subject: physical products on
  // a marketplace rarely clear ~75% 5-star organically, but a service people
  // actively choose (a clinic, a restaurant) legitimately sits at 90%+ — those
  // who bother to review a service they sought out are mostly satisfied. Using
  // the product threshold on a place flagged genuine local businesses as
  // suspicious, so places are held to a much higher bar and a gentler penalty.
  const fivePct = pct(distribution[5]);
  const skewMin = isPlace ? 95 : 85;
  const skewHigh = isPlace ? 98 : 93;
  if (ratedCount >= 8 && fivePct >= skewMin) {
    const high = fivePct >= skewHigh;
    patterns.push({
      id: 'five-star-skew',
      label: 'Unusually high 5-star share',
      detail: isPlace
        ? `${fivePct}% of the ${ratedCount} visible reviews are 5-star — very positive even for a well-liked local business. Genuine satisfaction looks like this, but so does review-gating (asking only happy customers to review), so weigh the rating accordingly.`
        : `${fivePct}% of the ${ratedCount} visible reviews are 5-star. Organic products rarely exceed ~75%.`,
      severity: high ? 'high' : 'medium',
      penalty: isPlace ? (high ? 8 : 5) : high ? 14 : 9,
    });
  }

  // Review bombing (1-star flood)
  const onePct = pct(distribution[1]);
  if (ratedCount >= 8 && onePct >= 60) {
    patterns.push({
      id: 'review-bombing',
      label: 'Possible review bombing',
      detail: `${onePct}% of visible reviews are 1-star — may indicate a coordinated negative campaign rather than product quality.`,
      severity: 'medium',
      penalty: 8,
    });
  }

  // Polarized J-shape: a hollow middle AND both tails substantial. Requiring a
  // real 1-star tail (not just its presence) is what separates a genuine
  // promotion-plus-attack J-shape from a business that is simply well-liked with
  // a handful of detractors — the latter also has an empty middle but is not
  // suspicious, and used to be mislabelled an "attack campaign".
  const middle = distribution[2] + distribution[3] + distribution[4];
  const oneShare = distribution[1] / ratedCount;
  const fiveShare = distribution[5] / ratedCount;
  if (ratedCount >= 12 && middle / ratedCount < 0.1 && oneShare >= 0.15 && fiveShare >= 0.15) {
    patterns.push({
      id: 'polarized-distribution',
      label: 'Unnatural rating distribution',
      detail: `Almost no 2–4 star reviews, with sizeable 1-star (${pct(distribution[1])}%) and 5-star (${pct(distribution[5])}%) camps. Heavily polarized distributions often mix promotion and attack campaigns.`,
      severity: 'medium',
      penalty: 8,
    });
  }

  // Timeline: reviews per day + burst detection
  const byDay = new Map<string, number>();
  const dated: number[] = [];
  for (const r of reviews) {
    if (!r.dateISO) continue;
    const day = r.dateISO.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    dated.push(Date.parse(r.dateISO));
  }
  const timeline = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));

  // Extend the axis to today so the chart shows recency: if the newest review
  // is weeks old, the line visibly drops to zero at "now" instead of stopping
  // mid-chart and looking like the data just ends.
  const today = new Date().toISOString().slice(0, 10);
  if (timeline.length > 0 && timeline[timeline.length - 1]!.day < today) {
    timeline.push({ day: today, count: 0 });
  }

  if (dated.length >= 8) {
    dated.sort((a, b) => a - b);
    const spanDays = (dated[dated.length - 1]! - dated[0]!) / 86_400_000;

    // Burst: large share of reviews inside any 3-day window
    const windowMs = 3 * 86_400_000;
    let maxInWindow = 0;
    let windowStart = 0;
    for (let i = 0, j = 0; i < dated.length; i++) {
      while (dated[i]! - dated[j]! > windowMs) j++;
      if (i - j + 1 > maxInWindow) {
        maxInWindow = i - j + 1;
        windowStart = dated[j]!;
      }
    }
    if (spanDays > 30 && maxInWindow / dated.length >= 0.5) {
      const when = new Date(windowStart).toLocaleDateString();
      patterns.push({
        id: 'review-burst',
        label: 'Review spike detected',
        detail: `${maxInWindow} of ${dated.length} dated reviews were posted within a 3-day window around ${when} — a pattern typical of purchased review batches.`,
        severity: 'high',
        penalty: 14,
      });
    } else if (spanDays <= 14 && dated.length >= 10) {
      patterns.push({
        id: 'compressed-timeline',
        label: 'Many reviews in a short period',
        detail: `${dated.length} reviews were all posted within ${Math.max(1, Math.round(spanDays))} day(s) — unusually compressed timing.`,
        severity: 'medium',
        penalty: 9,
      });
    }
  }

  return {
    distribution,
    average: ratedCount ? Math.round((ratingSum / ratedCount) * 10) / 10 : null,
    timeline,
    patterns,
  };
}
