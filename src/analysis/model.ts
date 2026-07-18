/**
 * On-device fake-review classifier.
 *
 * A logistic-regression model over interpretable features. Each fraud/trust
 * signal detected for a review (text heuristics, behavioral signals, author
 * history) is a feature; the model combines them in logit space and applies a
 * sigmoid to produce P(genuine), then a 0–100 score. Because it is linear, the
 * contribution of every feature is exactly `weight`, so the UI can always
 * explain *why* a review scored the way it did.
 *
 * Runs 100% locally — no network, no per-use cost, Chrome-Web-Store friendly.
 *
 * ─── Weights ──────────────────────────────────────────────────────────────
 * `SIGNAL_WEIGHTS` and `BIAS` are the model's only learned parameters. The v0
 * values here are calibrated from domain priors so the classifier behaves
 * sensibly out of the box; they are structured to be replaced wholesale by
 * values trained on a labeled corpus (see docs/MODEL.md). Retraining does not
 * touch any other code — only these numbers change.
 */
import type { ParsedReview, ReviewSignal } from '../types/index.js';
import { clamp } from '../utils/index.js';
import { BIAS, SIGNAL_WEIGHTS, TEXT_DEPTH_WEIGHT } from './weights.js';

/** Fallback scale to turn an unknown signal's declared penalty into a weight. */
const UNKNOWN_PENALTY_SCALE = 12;

export interface FeatureContribution {
  id: string;
  label: string;
  /** Signed logit contribution: negative = toward fake, positive = toward genuine. */
  weight: number;
}

export interface Classification {
  /** 0–100, higher = more likely genuine. */
  score: number;
  /** P(review is genuine), 0–1. */
  pGenuine: number;
  /** Per-feature contributions, largest magnitude first (for "explain this"). */
  contributions: FeatureContribution[];
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/**
 * Continuous text-depth feature: clamped log of word count relative to a
 * ~18-word pivot. Exported so the training pipeline computes the exact same
 * feature value the extension uses at inference time.
 */
export function textDepth(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  // Fixed clamp bounds: the feature definition must not depend on the learned
  // weight, or retraining would silently change the feature space.
  return clamp(Math.log(words / 18), -1.79, 1.96);
}

/**
 * Signal intensity: scales a learned weight by the detector-reported penalty
 * magnitude. Exported for training parity.
 */
export function signalIntensity(penalty: number): number {
  return Math.min(1.3, Math.max(0.6, Math.abs(penalty) / 10));
}

/**
 * Classify a single review from its detected signals and metadata.
 * `sensitivityFactor` (0.7–1.3) scales only the fraud side, so the user's
 * strictness setting makes suspicious signals count for more/less without ever
 * penalizing genuine-leaning evidence.
 */
export function classifyReview(
  review: ParsedReview,
  signals: ReviewSignal[],
  sensitivityFactor: number,
): Classification {
  const contributions: FeatureContribution[] = [];
  let logit = BIAS;

  for (const s of signals) {
    let w = SIGNAL_WEIGHTS[s.id];
    if (w === undefined) {
      // Unknown/experimental signal: derive a weight from its declared penalty
      // so new detectors contribute before they earn a trained weight.
      w = -s.penalty / UNKNOWN_PENALTY_SCALE;
    } else {
      // Detectors report variable penalties (e.g. generic-praise grows with the
      // number of stock phrases, near-duplicate with the cluster size). Scale
      // the learned weight by that intensity so two reviews firing the same
      // signal at different strengths get different scores — this is real
      // evidence, not noise, and it widens the score distribution.
      w *= signalIntensity(s.penalty);
    }
    if (w < 0) w *= sensitivityFactor;
    logit += w;
    contributions.push({ id: s.id, label: s.label, weight: w });
  }

  // Text depth — continuous. Length/detail correlates with genuine first-hand
  // experience; a 6-word blurb and a 120-word account should never tie. Smooth
  // log curve, bounded so it can nudge but never dominate the fraud signals.
  const w = TEXT_DEPTH_WEIGHT * textDepth(review.text);
  if (Math.abs(w) >= 0.03) {
    logit += w;
    contributions.push({ id: 'text-depth', label: 'Review length & depth', weight: w });
  }

  // Continuous author-history feature (a smooth complement to the discrete
  // single/low-history signals): a bounded bonus that grows with track record.
  const count = review.authorReviewCount;
  if (count !== null && count > 3) {
    const w = Math.min(0.6, Math.log10(count) * 0.3);
    logit += w;
    contributions.push({ id: 'author-history', label: 'Reviewer track record', weight: w });
  }

  // Helpful votes are a weak positive signal (peers found it useful).
  if (review.helpfulVotes >= 3) {
    const w = Math.min(0.35, review.helpfulVotes * 0.03);
    logit += w;
    contributions.push({ id: 'helpful-votes', label: 'Voted helpful by others', weight: w });
  }

  const pGenuine = sigmoid(logit);
  const score = Math.round(pGenuine * 100);
  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return { score, pGenuine, contributions };
}
