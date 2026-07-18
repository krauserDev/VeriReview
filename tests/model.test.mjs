/**
 * Classifier invariants: calibration, monotonicity and sensitivity behavior.
 * These pin the model's contract regardless of retrained weight values.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReview } from './.build/model.js';
import { analyzePage, trustLevel } from './.build/engine.js';

const words = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
const review = (text, extra = {}) => ({
  id: 'x', author: 'Test Author', rating: 5, title: '', text, dateISO: null,
  verified: false, helpfulVotes: 0, authorReviewCount: null, authorIsLocalGuide: false,
  ...extra,
});
const signal = (id, penalty) => ({ id, label: id, detail: '', severity: 'medium', penalty });

test('calibration: signal-free ~25-word review scores in the high 80s', () => {
  const { score } = classifyReview(review(words(25)), [], 1.0);
  assert.ok(score >= 83 && score <= 91, `got ${score}`);
});

test('bought-style profile scores deep in suspicious territory (<35)', () => {
  const { score } = classifyReview(
    review(words(7), { authorReviewCount: 1 }),
    [signal('single-review-author', 18), signal('short-generic', 10), signal('generic-praise', 10)],
    1.0,
  );
  assert.ok(score < 35, `got ${score}`);
});

test('monotonic: adding a fraud signal never raises the score', () => {
  const base = classifyReview(review(words(30)), [signal('repeat-author', 10)], 1.0).score;
  const worse = classifyReview(
    review(words(30)),
    [signal('repeat-author', 10), signal('near-duplicate', 16)],
    1.0,
  ).score;
  assert.ok(worse < base, `${worse} should be < ${base}`);
});

test('longer text scores higher than a blurb, all else equal', () => {
  const short = classifyReview(review(words(8)), [], 1.0).score;
  const long = classifyReview(review(words(90)), [], 1.0).score;
  assert.ok(long > short, `${long} should be > ${short}`);
});

test('sensitivity scales fraud evidence only', () => {
  const signals = [signal('single-review-author', 18)];
  const lenient = classifyReview(review(words(25), { authorReviewCount: 1 }), signals, 0.7).score;
  const strict = classifyReview(review(words(25), { authorReviewCount: 1 }), signals, 1.3).score;
  assert.ok(strict < lenient, `strict ${strict} should be < lenient ${lenient}`);
  // A clean review must be unaffected by sensitivity.
  const cleanA = classifyReview(review(words(25)), [], 0.7).score;
  const cleanB = classifyReview(review(words(25)), [], 1.3).score;
  assert.equal(cleanA, cleanB);
});

test('contributions explain the verdict and sort by magnitude', () => {
  const { contributions } = classifyReview(
    review(words(40)),
    [signal('near-duplicate', 16), signal('exclamation-heavy', 4)],
    1.0,
  );
  assert.ok(contributions.length >= 2);
  for (let i = 1; i < contributions.length; i++) {
    assert.ok(Math.abs(contributions[i - 1].weight) >= Math.abs(contributions[i].weight));
  }
  assert.ok(contributions.some((c) => c.id === 'near-duplicate' && c.weight < 0));
});

test('trustLevel bands are exhaustive at their edges', () => {
  assert.equal(trustLevel(80), 'genuine');
  assert.equal(trustLevel(79), 'possibly-genuine');
  assert.equal(trustLevel(60), 'possibly-genuine');
  assert.equal(trustLevel(59), 'attention');
  assert.equal(trustLevel(40), 'attention');
  assert.equal(trustLevel(39), 'suspicious');
});

/* ---------------- engine: trust-index breakdown ---------------- */

const SETTINGS = {
  enabledSites: { amazon: true, google: true },
  sensitivity: 50, analysisDepth: 'standard', theme: 'auto', autoScan: false,
  notifications: false, highlightReviews: true, notifyBelowScore: 40,
  language: 'en',
};
const META = { url: 'https://x.test', site: 'Test', pageTitle: 'T', subject: 'product' };
const META_PLACE = { ...META, subject: 'place' };

test('engine: with no page patterns, trustIndex equals the review average', () => {
  // Two clean, distinct, undated reviews with different ratings → no patterns.
  const reviews = [
    review(words(40), { id: 'a', author: 'Ana García', rating: 4 }),
    review('Producto correcto aunque esperaba algo más de batería y pantalla en este rango de precio.', { id: 'b', author: 'Luis Pérez', rating: 2 }),
  ];
  const a = analyzePage(reviews, META, SETTINGS);
  assert.equal(a.patterns.length, 0);
  assert.equal(a.patternPenalty, 0);
  assert.equal(a.trustIndex, a.reviewScoreAvg);
});

/* ---- Recommendations must match what the page actually is ---- */

/** A page with enough 5-star reviews to land in a "manipulation signals" band. */
const skewedPage = () =>
  Array.from({ length: 12 }, (_, i) =>
    review(`${words(6)} n${i}`, { id: `s${i}`, author: `Autor ${i}`, rating: 5, authorReviewCount: 1 }),
  );

/** ~98% 5-star (fires the skew pattern for both subjects) with one genuine low. */
const skewedPageWithLows = () => [
  ...Array.from({ length: 39 }, (_, i) =>
    review(`${words(8)} n${i}`, { id: `h${i}`, author: `Autor ${i}`, rating: 5 }),
  ),
  review(`${words(8)} low`, { id: 'low1', author: 'Detractor', rating: 1 }),
];

test('a Google place never gets purchase advice ("seller", "buying")', () => {
  const a = analyzePage(skewedPage(), META_PLACE, SETTINGS);
  const text = a.recommendations.join(' ');
  assert.doesNotMatch(text, /seller|buying|purchas|product/i,
    `a clinic must not be told to compare sellers: ${text}`);
  assert.ok(a.recommendations.length > 0, 'it still gives usable advice');
});

test('an Amazon product does get purchase advice', () => {
  const a = analyzePage(skewedPage(), META, SETTINGS);
  const text = a.recommendations.join(' ');
  assert.match(text, /buying|seller|listing|purchase/i, `expected product advice: ${text}`);
});

test('the "read low-star reviews" tip appears only when low-star reviews exist', () => {
  // All 5-star → nothing low to read → the tip must be suppressed (pointing the
  // user at reviews that aren't there read as a canned, untrustworthy tip).
  const allFive = analyzePage(skewedPage(), META, SETTINGS).recommendations.join(' ');
  assert.doesNotMatch(allFive, /1–3 star reviews/, 'no tip when no low-star reviews exist');

  // Skew + a genuine low-star review → tip fires, for either subject.
  for (const meta of [META, META_PLACE]) {
    const text = analyzePage(skewedPageWithLows(), meta, SETTINGS).recommendations.join(' ');
    assert.match(text, /1–3 star reviews/, 'tip fires when low-star reviews are present');
  }
});

/* ---- Rating patterns are calibrated to the subject ---- */

test('a service at 90% 5-star is organic (place), but flagged for a product', () => {
  // 90% 5-star: normal for a clinic/restaurant people choose, high for a product.
  const reviews = [
    ...Array.from({ length: 9 }, (_, i) =>
      review(`${words(20)} a${i}`, { id: `f${i}`, author: `A${i}`, rating: 5 }),
    ),
    review(`${words(20)} mid`, { id: 'mid', author: 'B', rating: 3 }),
  ];
  const place = analyzePage(reviews, META_PLACE, SETTINGS);
  const product = analyzePage(reviews, META, SETTINGS);
  assert.ok(!place.patterns.some((p) => p.id === 'five-star-skew'), 'place: 90% is organic');
  assert.ok(product.patterns.some((p) => p.id === 'five-star-skew'), 'product: 90% exceeds baseline');
});

test('a well-liked place with a few detractors is not called polarized', () => {
  // 20 fives + 1 one, hollow middle: overwhelmingly positive, NOT an attack mix.
  const reviews = [
    ...Array.from({ length: 20 }, (_, i) =>
      review(`${words(15)} p${i}`, { id: `p${i}`, author: `A${i}`, rating: 5 }),
    ),
    review(`${words(15)} neg`, { id: 'neg', author: 'Z', rating: 1 }),
  ];
  const a = analyzePage(reviews, META_PLACE, SETTINGS);
  assert.ok(
    !a.patterns.some((p) => p.id === 'polarized-distribution'),
    'a handful of detractors is not polarization',
  );
});

test('a genuine J-shape (both camps substantial) still flags polarized', () => {
  const reviews = [
    ...Array.from({ length: 15 }, (_, i) =>
      review(`${words(15)} a${i}`, { id: `a${i}`, author: `A${i}`, rating: 5 }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      review(`${words(15)} b${i}`, { id: `b${i}`, author: `B${i}`, rating: 1 }),
    ),
  ];
  const a = analyzePage(reviews, META, SETTINGS);
  assert.ok(
    a.patterns.some((p) => p.id === 'polarized-distribution'),
    'a balanced 5/1 J-shape is genuinely polarized',
  );
});

test('engine: page patterns subtract visibly (breakdown fields consistent)', () => {
  // 10 five-star reviews from distinct authors → five-star-skew pattern fires.
  const reviews = Array.from({ length: 10 }, (_, i) =>
    review(`${words(25)} extra${i}`, { id: `r${i}`, author: `Autor Distinto ${i}`, rating: 5 }),
  );
  const a = analyzePage(reviews, META, SETTINGS);
  assert.ok(a.patterns.some((p) => p.id === 'five-star-skew'), 'skew pattern fires');
  assert.ok(a.patternPenalty > 0);
  assert.ok(a.trustIndex < a.reviewScoreAvg);
  assert.ok(Math.abs(a.reviewScoreAvg - a.patternPenalty - a.trustIndex) <= 1, 'breakdown adds up (±1 rounding)');
});
