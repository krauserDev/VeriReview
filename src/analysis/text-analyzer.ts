/**
 * Text heuristics applied to a single review. Every detector returns a
 * ReviewSignal explaining WHY it fired — the UI never says "fake" without
 * showing these reasons.
 */
import type { ParsedReview, ReviewSignal } from '../types/index.js';
import { tokenize } from '../utils/index.js';

const GENERIC_PHRASES = [
  'great product', 'good product', 'nice product', 'amazing product',
  'highly recommend', 'highly recommended', 'must buy', 'best purchase',
  'value for money', 'five stars', '5 stars', 'works great', 'love it',
  'good quality', 'great quality', 'as described', 'fast shipping',
  'perfect', 'awesome', 'excellent product', 'worth every penny',
  'exceeded my expectations', 'game changer', 'life changer', 'best ever',
];

const MARKETING_WORDS = [
  'revolutionary', 'unbeatable', 'premium', 'top-notch', 'cutting-edge',
  'state of the art', 'best in class', 'unmatched', 'superior', 'flawless',
  'guaranteed', 'must-have', 'incredible value', 'limited time', 'exclusive',
  'discount code', 'coupon', 'promo', 'sponsored', 'brand ambassador',
];

const AI_STYLE_PHRASES = [
  'in conclusion', 'overall, this product', 'in summary', 'to summarize',
  'first and foremost', 'it is worth noting', 'without a doubt',
  'i recently purchased this product', 'this product offers', 'in terms of',
  'whether you are', 'look no further', 'delve', 'furthermore', 'moreover',
  'additionally, the', 'seamlessly', 'elevate your', 'a testament to',
];

const SUPERLATIVES = [
  'best', 'greatest', 'perfect', 'amazing', 'incredible', 'awesome',
  'fantastic', 'wonderful', 'excellent', 'outstanding', 'phenomenal',
  'unbelievable', 'stunning', 'flawless', 'brilliant',
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function count(haystack: string, needles: string[]): { n: number; hits: string[] } {
  const hits: string[] = [];
  for (const needle of needles) if (haystack.includes(needle)) hits.push(needle);
  return { n: hits.length, hits };
}

/** Run all text detectors for one review. */
export function analyzeText(review: ParsedReview): ReviewSignal[] {
  const signals: ReviewSignal[] = [];
  const raw = `${review.title} ${review.text}`.trim();
  const lower = raw.toLowerCase();
  const tokens = tokenize(raw);
  const words = tokens.length;

  // Very short generic review
  if (words > 0 && words <= 8) {
    signals.push({
      id: 'short-generic',
      label: 'Very short review',
      detail: `Only ${words} word${words === 1 ? '' : 's'} — too brief to describe real product experience.`,
      severity: 'medium',
      penalty: 10,
    });
  }

  // Generic praise with no specifics
  const generic = count(lower, GENERIC_PHRASES);
  if (generic.n >= 2 || (generic.n >= 1 && words < 25)) {
    signals.push({
      id: 'generic-praise',
      label: 'Generic wording',
      detail: `Uses stock phrases (“${generic.hits.slice(0, 3).join('”, “')}”) common in template reviews.`,
      severity: 'medium',
      penalty: 8 + generic.n * 2,
    });
  }

  // Marketing-like wording
  const marketing = count(lower, MARKETING_WORDS);
  if (marketing.n >= 2) {
    signals.push({
      id: 'marketing-language',
      label: 'Promotional language',
      detail: `Reads like ad copy: “${marketing.hits.slice(0, 3).join('”, “')}”.`,
      severity: 'high',
      penalty: 12,
    });
  }

  // AI-generated style indicators
  const ai = count(lower, AI_STYLE_PHRASES);
  if (ai.n >= 2) {
    signals.push({
      id: 'ai-style',
      label: 'AI-like writing style',
      detail: `Contains structured, essay-like phrasing (“${ai.hits.slice(0, 3).join('”, “')}”) typical of generated text.`,
      severity: 'high',
      penalty: 14,
    });
  }

  // Overly emotional / superlative-heavy language
  const superlativeHits = tokens.filter((t) => SUPERLATIVES.includes(t)).length;
  if (words >= 10 && superlativeHits / words > 0.12) {
    signals.push({
      id: 'emotional-language',
      label: 'Overly emotional language',
      detail: `${superlativeHits} superlatives in ${words} words — enthusiasm without substance.`,
      severity: 'medium',
      penalty: 8,
    });
  }

  // Excessive capitalization
  const letters = raw.replace(/[^a-zA-Z]/g, '');
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (letters.length >= 20 && upper / letters.length > 0.5) {
    signals.push({
      id: 'excessive-caps',
      label: 'Excessive capitalization',
      detail: 'More than half the text is uppercase — a common attention-grab in spam reviews.',
      severity: 'low',
      penalty: 6,
    });
  }

  // Exclamation density
  const bangs = (raw.match(/!/g) ?? []).length;
  if (bangs >= 4 && words < 60) {
    signals.push({
      id: 'exclamation-heavy',
      label: 'Excessive exclamation marks',
      detail: `${bangs} exclamation marks in a short review.`,
      severity: 'low',
      penalty: 4,
    });
  }

  // Emoji overload
  const emojis = (raw.match(EMOJI_RE) ?? []).length;
  if (emojis >= 5) {
    signals.push({
      id: 'emoji-overload',
      label: 'Too many emojis',
      detail: `${emojis} emojis — decorative rather than descriptive.`,
      severity: 'low',
      penalty: 5,
    });
  }

  // Keyword stuffing: one non-trivial word repeated unusually often
  if (words >= 15) {
    const freq = new Map<string, number>();
    for (const t of tokens) if (t.length >= 5) freq.set(t, (freq.get(t) ?? 0) + 1);
    let topWord = '';
    let topCount = 0;
    for (const [w, c] of freq) if (c > topCount) { topWord = w; topCount = c; }
    if (topCount >= 4 && topCount / words > 0.08) {
      signals.push({
        id: 'keyword-stuffing',
        label: 'Keyword stuffing',
        detail: `The word “${topWord}” appears ${topCount} times — a pattern used to game search ranking.`,
        severity: 'medium',
        penalty: 9,
      });
    }
  }

  // Repeated sentence structures (identical sentence openers)
  const sentences = raw.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 3);
  if (sentences.length >= 4) {
    const openers = sentences.map((s) => tokenize(s).slice(0, 2).join(' '));
    const openerFreq = new Map<string, number>();
    for (const o of openers) if (o) openerFreq.set(o, (openerFreq.get(o) ?? 0) + 1);
    const maxOpener = Math.max(0, ...openerFreq.values());
    if (maxOpener >= 3) {
      signals.push({
        id: 'repeated-structure',
        label: 'Repetitive sentence structure',
        detail: `${maxOpener} sentences start with the same words — mechanical writing pattern.`,
        severity: 'medium',
        penalty: 7,
      });
    }
  }

  // No product-specific details in a rated review (no numbers, sizes, model refs)
  const hasSpecifics = /\d/.test(raw) || /\b(size|fit|battery|screen|material|color|colour|weight|month|week|day|model|version)\b/i.test(raw);
  if (words >= 12 && words <= 60 && !hasSpecifics && generic.n >= 1) {
    signals.push({
      id: 'no-specifics',
      label: 'No product-specific details',
      detail: 'Mentions nothing concrete (features, dimensions, duration of use) that indicates real usage.',
      severity: 'medium',
      penalty: 8,
    });
  }

  // Trust bonus: long, detailed review
  if (words >= 80 && hasSpecifics) {
    signals.push({
      id: 'detailed-review',
      label: 'Detailed first-hand account',
      detail: 'Long review with concrete details — consistent with genuine experience.',
      severity: 'low',
      penalty: -8,
    });
  }

  return signals;
}
