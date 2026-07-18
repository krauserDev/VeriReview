/**
 * The analysis engine: orchestrates text, rating and behavioral analyzers,
 * computes per-review scores and the global Trust Index, and produces
 * human-readable recommendations. Runs 100% locally — no network calls.
 */
import type {
  PageAnalysis,
  PagePattern,
  ParsedReview,
  ReviewAnalysis,
  ReviewSignal,
  ReviewSubject,
  RiskLabel,
  Settings,
  TrustLevel,
} from '../types/index.js';
import { clamp } from '../utils/index.js';
import { analyzeText } from './text-analyzer.js';
import { analyzeRatings } from './rating-analyzer.js';
import { analyzeBehavior } from './behavior-analyzer.js';
import { classifyReview } from './model.js';

export function trustLevel(score: number): TrustLevel {
  if (score >= 80) return 'genuine';
  if (score >= 60) return 'possibly-genuine';
  if (score >= 40) return 'attention';
  return 'suspicious';
}

/**
 * Verdict wording is deliberately probabilistic and never accusatory: these
 * labels describe our confidence in a review, not a finding of fraud against
 * the person who wrote it. "High risk" (not "fake") keeps the claim honest —
 * the model detects statistical patterns, it cannot know intent.
 */
export const LEVEL_LABEL: Record<TrustLevel, string> = {
  genuine: 'Trusted',
  'possibly-genuine': 'Probably real',
  attention: 'Questionable',
  suspicious: 'High risk',
};

export function riskLabel(trustIndex: number): RiskLabel {
  if (trustIndex >= 85) return 'Very Trustworthy';
  if (trustIndex >= 70) return 'Trustworthy';
  if (trustIndex >= 50) return 'Moderate Risk';
  if (trustIndex >= 30) return 'High Risk';
  return 'Very High Risk';
}

function scoreReview(
  review: ParsedReview,
  signals: ReviewSignal[],
  sensitivityFactor: number,
): number {
  // Scoring is delegated to the on-device logistic classifier, which combines
  // all detected signals (plus continuous author/helpfulness features) with
  // learned weights. Verified-purchase and helpful-vote effects are handled
  // inside the model, so they are not re-applied here.
  return classifyReview(review, signals, sensitivityFactor).score;
}

/**
 * Verdict wording per subject. Purchase advice ("compare with another seller")
 * is actively harmful on a physiotherapy clinic: it tells the user we don't
 * understand what they're looking at, which discredits the whole analysis.
 *
 * The `place` copy stays decision-neutral rather than saying "business", so it
 * reads correctly for a clinic, a restaurant, a shop or any other Google
 * listing.
 */
const VERDICT_ADVICE: Record<ReviewSubject, Record<'high' | 'good' | 'mixed' | 'bad', string[]>> = {
  product: {
    high: ['These reviews appear trustworthy overall.'],
    good: ['Reviews look mostly genuine, but read critically before buying.'],
    mixed: [
      'Wait before buying — several manipulation signals were detected.',
      'Compare this product with alternatives from other sellers.',
    ],
    bad: [
      'Strong manipulation signals detected — consider avoiding this listing.',
      'Check independent review sites before trusting this rating.',
    ],
  },
  place: {
    high: ['These reviews appear trustworthy overall.'],
    good: ['Reviews look mostly genuine, but read them critically.'],
    mixed: [
      'Several manipulation signals were detected — don’t rely on the star rating alone.',
      'Check other review sites before deciding.',
    ],
    bad: [
      'Strong manipulation signals detected — treat this rating with caution.',
      'Look for independent sources before trusting these reviews.',
    ],
  },
};

function buildRecommendations(
  subject: ReviewSubject,
  trustIndex: number,
  patterns: PagePattern[],
  reviews: ReviewAnalysis[],
  verifiedCount: number,
): string[] {
  const band = trustIndex >= 80 ? 'high' : trustIndex >= 60 ? 'good' : trustIndex >= 40 ? 'mixed' : 'bad';
  const recs: string[] = [...VERDICT_ADVICE[subject][band]];
  const suspicious = reviews.filter((r) => r.level === 'suspicious').length;

  // The rest is subject-agnostic: it talks about the reviews themselves.
  // Only suggest reading the low-star reviews when some were actually analyzed —
  // on a heavily 5-star page there may be none to read, and pointing the user at
  // reviews that aren't there reads as a canned, untrustworthy tip.
  const hasLowStar = reviews.some((r) => r.review.rating !== null && r.review.rating <= 3);
  if (patterns.some((p) => p.id === 'five-star-skew') && hasLowStar) {
    recs.push('Read the 1–3 star reviews first; they are more likely to be organic here.');
  }
  if (patterns.some((p) => p.id === 'review-burst' || p.id === 'compressed-timeline')) {
    recs.push('Ignore reviews from the spike period and focus on older, spread-out reviews.');
  }
  if (patterns.some((p) => p.id === 'many-first-time-reviewers')) {
    recs.push('Give more weight to reviewers with a long review history.');
  }
  if (suspicious >= 3) {
    recs.push(`Filter out the ${suspicious} high-risk reviews and re-read the rest.`);
  }
  // Verified purchases only exist where the site reports them (Amazon).
  if (verifiedCount > 0 && verifiedCount < reviews.length / 3) {
    recs.push('Prioritize verified-purchase reviews — few reviews here are verified.');
  }
  return recs.slice(0, 5);
}

/** Analyze all parsed reviews from a page and return the full result. */
export function analyzePage(
  reviews: ParsedReview[],
  meta: { url: string; site: string; pageTitle: string; subject: ReviewSubject },
  settings: Settings,
): PageAnalysis {
  // Sensitivity 0–100 → penalty multiplier 0.7–1.3
  const sensitivityFactor = 0.7 + (settings.sensitivity / 100) * 0.6;
  const deep = settings.analysisDepth !== 'quick';

  const behavior = deep
    ? analyzeBehavior(reviews)
    : { perReview: new Map<string, ReviewSignal[]>(), similarity: new Map<string, string[]>(), patterns: [] as PagePattern[] };
  const ratings = analyzeRatings(reviews, meta.subject);

  const analyzed: ReviewAnalysis[] = reviews.map((review) => {
    const signals: ReviewSignal[] = [
      ...analyzeText(review),
      ...(behavior.perReview.get(review.id) ?? []),
    ];
    if (review.verified) {
      signals.push({
        id: 'verified-purchase',
        label: 'Verified purchase',
        detail: 'The platform confirmed this reviewer bought the product.',
        severity: 'low',
        penalty: -6,
      });
    }
    const score = scoreReview(review, signals, sensitivityFactor);
    return {
      review,
      score,
      level: trustLevel(score),
      signals,
      similarTo: behavior.similarity.get(review.id) ?? [],
    };
  });

  /* ---------- Global Trust Index ---------- */
  // The index is NOT the plain review average: page-level patterns (rating
  // skew, bursts) subtract from it, because a wall of individually-clean
  // 5-star reviews is itself a bought-campaign signature. Both components are
  // kept on the result so the UI can show the breakdown transparently.
  const patterns: PagePattern[] = [...ratings.patterns, ...behavior.patterns];
  let trustIndex = 50; // neutral fallback when no reviews are visible
  let reviewScoreAvg = 50;
  let patternPenalty = 0;

  if (analyzed.length > 0) {
    let weighted = 0;
    let weightSum = 0;
    for (const r of analyzed) {
      const w = 1 + Math.min(1, r.review.helpfulVotes * 0.05) + (r.review.verified ? 0.3 : 0);
      weighted += r.score * w;
      weightSum += w;
    }
    const avg = weighted / weightSum;
    reviewScoreAvg = Math.round(avg);
    const rawPenalty = patterns.reduce((sum, p) => sum + p.penalty, 0) * sensitivityFactor;
    patternPenalty = Math.round(rawPenalty);
    trustIndex = Math.round(clamp(avg - rawPenalty, 0, 100));
  }

  const verifiedCount = reviews.filter((r) => r.verified).length;
  const confidence = analyzed.length >= 20 ? 'high' : analyzed.length >= 8 ? 'medium' : 'low';

  return {
    url: meta.url,
    site: meta.site,
    subject: meta.subject,
    pageTitle: meta.pageTitle,
    scannedAt: Date.now(),
    trustIndex,
    reviewScoreAvg,
    patternPenalty,
    riskLabel: riskLabel(trustIndex),
    confidence,
    reviewCount: analyzed.length,
    verifiedCount,
    averageRating: ratings.average,
    ratingDistribution: ratings.distribution,
    timeline: ratings.timeline,
    reviews: analyzed,
    patterns,
    recommendations: buildRecommendations(meta.subject, trustIndex, patterns, analyzed, verifiedCount),
  };
}
