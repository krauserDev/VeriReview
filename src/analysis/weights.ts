/**
 * Model parameters for the on-device fake-review classifier.
 *
 * ⚠️ GENERATED FILE — retrain with `npm run train` (tools/train/train.mjs),
 * which rewrites this file. Hand-edits will be overwritten.
 *
 * Provenance: trained 2026-07-12 on the Ott et al. Deceptive Opinion Spam corpus
 * (v1.4, 1600 hotel reviews, 50/50 deceptive/truthful).
 * Held-out test: accuracy 64.4%, deceptive-class precision 70.0%,
 * recall 51.9%. Behavioral/author weights remain domain priors —
 * a text-only corpus cannot estimate them (see docs/MODEL.md). Bias is
 * recalibrated to the deployment prior (signal-free review ≈ 87/100).
 * Rejected sign-flips vs domain prior: text-depth (trained -0.417, prior 0.28).
 */

/**
 * Logit-space weight per signal id. Negative pushes a review toward "fake";
 * positive toward "genuine".
 */
export const SIGNAL_WEIGHTS: Record<string, number> = {
  /* ---- Author / behavioral (priors — not trainable from text-only corpora) ---- */
  'single-review-author': -1.65,
  'low-history-author': -0.75,
  'near-duplicate': -1.35,
  'repeat-author': -0.9,
  'anonymous-profile': -0.45,
  'established-reviewer': 0.9,
  'verified-purchase': 0.85,
  /* ---- Text heuristics (trained; prior kept for: ai-style, excessive-caps, exclamation-heavy, keyword-stuffing) ---- */
  'ai-style': -1.2,
  'detailed-review': 0.942,
  'emoji-overload': -0.35,
  'emotional-language': -0.55,
  'excessive-caps': -0.4,
  'exclamation-heavy': -0.3,
  'generic-praise': -0.071,
  'keyword-stuffing': -0.8,
  'marketing-language': -1.05,
  'no-specifics': -0.241,
  'repeated-structure': -0.224,
  'short-generic': -0.75,
};

/** Intercept, recalibrated to the deployment prior. */
export const BIAS = 1.809;

/** Coefficient for the continuous text-depth feature (trained). */
export const TEXT_DEPTH_WEIGHT = 0.28;
