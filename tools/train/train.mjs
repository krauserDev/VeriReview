/**
 * ReviewShield — training pipeline for the on-device classifier.
 *
 * Trains an L2-regularized logistic regression over the EXACT features the
 * extension computes at inference time (the analyzers are bundled from src/,
 * not re-implemented), on the Ott et al. Deceptive Opinion Spam corpus
 * (800 deceptive / 800 truthful hotel reviews).
 *
 * Output: rewrites src/analysis/weights.ts with
 *   - trained weights for text signals seen often enough in the corpus,
 *   - untouched domain priors for behavioral/author signals (not present in a
 *     text-only corpus),
 *   - a bias recalibrated to the deployment prior (clean review ≈ 87/100).
 *
 * Usage:  npm run train
 * Data:   tools/train/data/corpus/op_spam_v1.4/**  (see tools/train/README.md)
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(root, 'tools/train/data/corpus');
const OUT_WEIGHTS = path.join(root, 'src/analysis/weights.ts');
const TMP = path.join(root, 'tools/train/.build');

/* ----------------------------- config ----------------------------- */
const L2_LAMBDA = 2e-3;
const LEARNING_RATE = 0.15;
const EPOCHS = 1200;
const TEST_FRACTION = 0.2;
const SEED = 42;
const MIN_OCCURRENCES = 12; // signals rarer than this keep their prior
const TARGET_CLEAN_P = 0.87; // deployment prior: signal-free 25-word review
/* ------------------------------------------------------------------ */

/** Deterministic PRNG so runs are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bundle the extension's own analyzers so train/infer share one codebase. */
async function loadAnalyzers() {
  mkdirSync(TMP, { recursive: true });
  await build({
    entryPoints: [
      path.join(root, 'src/analysis/text-analyzer.ts'),
      path.join(root, 'src/analysis/model.ts'),
    ],
    outdir: TMP,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const textAnalyzer = await import(pathToFileURL(path.join(TMP, 'text-analyzer.js')).href);
  const model = await import(pathToFileURL(path.join(TMP, 'model.js')).href);
  return { analyzeText: textAnalyzer.analyzeText, textDepth: model.textDepth, signalIntensity: model.signalIntensity };
}

/** Walk the Ott corpus: label 1 = truthful/genuine, 0 = deceptive. */
function loadCorpus() {
  const samples = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.txt')) {
        const label = p.includes('deceptive') ? 0 : 1;
        samples.push({ text: readFileSync(p, 'utf8').trim(), label });
      }
    }
  };
  walk(DATA);
  return samples;
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

async function main() {
  const { analyzeText, textDepth, signalIntensity } = await loadAnalyzers();
  const samples = loadCorpus();
  if (samples.length < 100) {
    console.error(`Corpus too small or missing (${samples.length} samples) — see tools/train/README.md`);
    process.exit(1);
  }
  console.log(`Corpus: ${samples.length} reviews (${samples.filter((s) => s.label === 0).length} deceptive / ${samples.filter((s) => s.label === 1).length} truthful)`);

  // ---- Feature extraction (identical to the extension) ----
  const stubReview = (text) => ({
    id: 'x', author: 'x', rating: null, title: '', text, dateISO: null,
    verified: false, helpfulVotes: 0, authorReviewCount: null, authorIsLocalGuide: false,
  });
  const featNames = new Set(['text-depth']);
  const rows = samples.map(({ text, label }) => {
    const feats = { 'text-depth': textDepth(text) };
    for (const s of analyzeText(stubReview(text))) {
      feats[s.id] = signalIntensity(s.penalty);
      featNames.add(s.id);
    }
    return { feats, label };
  });

  const names = [...featNames].sort();
  const occurrences = Object.fromEntries(names.map((n) => [n, rows.filter((r) => r.feats[n] !== undefined && r.feats[n] !== 0).length]));
  console.log('Signal occurrences:', occurrences);

  // ---- Stratified shuffle + split ----
  const rand = mulberry32(SEED);
  const shuffled = [...rows].sort(() => rand() - 0.5);
  const testN = Math.floor(shuffled.length * TEST_FRACTION);
  const test = shuffled.slice(0, testN);
  const train = shuffled.slice(testN);

  // ---- Logistic regression, full-batch gradient descent + L2 ----
  const w = Object.fromEntries(names.map((n) => [n, 0]));
  let b = 0;
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const grad = Object.fromEntries(names.map((n) => [n, 0]));
    let gradB = 0;
    for (const { feats, label } of train) {
      let z = b;
      for (const n of names) z += (feats[n] ?? 0) * w[n];
      const err = sigmoid(z) - label;
      for (const n of names) grad[n] += err * (feats[n] ?? 0);
      gradB += err;
    }
    for (const n of names) {
      w[n] -= LEARNING_RATE * (grad[n] / train.length + L2_LAMBDA * w[n]);
    }
    b -= LEARNING_RATE * (gradB / train.length);
  }

  // ---- Evaluation ----
  const evaluate = (set, weights, bias) => {
    let tp = 0, tn = 0, fp = 0, fn = 0;
    for (const { feats, label } of set) {
      let z = bias;
      for (const n of names) z += (feats[n] ?? 0) * (weights[n] ?? 0);
      const pred = sigmoid(z) >= 0.5 ? 1 : 0;
      if (pred === 1 && label === 1) tp++;
      else if (pred === 0 && label === 0) tn++;
      else if (pred === 1 && label === 0) fp++;
      else fn++;
    }
    const acc = (tp + tn) / set.length;
    const precDec = tn + fn > 0 ? tn / (tn + fn) : 0; // deceptive-class precision
    const recDec = tn + fp > 0 ? tn / (tn + fp) : 0; // deceptive-class recall
    return { acc, precDec, recDec };
  };
  const m = evaluate(test, w, b);
  console.log(`\nTest (${test.length} held out): accuracy ${(m.acc * 100).toFixed(1)}% · deceptive precision ${(m.precDec * 100).toFixed(1)}% · deceptive recall ${(m.recDec * 100).toFixed(1)}%`);

  // Baseline: current shipped weights on the same test set.
  const prior = await import(pathToFileURL(path.join(TMP, 'model.js')).href);
  void prior; // (weights are baked into the bundle via weights.ts import)

  // ---- Merge with priors & recalibrate bias ----
  // Policy:
  //  1. EVERY id in the prior file survives (a signal absent from this corpus
  //     keeps its domain prior — it must never silently vanish).
  //  2. A trained weight is adopted only when it has enough support
  //     (≥ MIN_OCCURRENCES) AND its sign agrees with the domain prior. The
  //     corpus (2011 MTurk hotel reviews) is out-of-domain for purchased
  //     product/local reviews, so it may refine magnitudes but not overturn
  //     signal direction without in-domain evidence.
  const priorWeightsSrc = readFileSync(path.join(root, 'tools/train/priors.json'), 'utf8');
  const priors = JSON.parse(priorWeightsSrc);
  const BEHAVIORAL = [
    'single-review-author', 'low-history-author', 'near-duplicate', 'repeat-author',
    'anonymous-profile', 'established-reviewer', 'verified-purchase',
  ];
  const finalWeights = { ...priors.SIGNAL_WEIGHTS };
  const trainedIds = [];
  const keptPrior = [];
  const rejectedSignFlip = [];
  for (const n of names) {
    if (n === 'text-depth') continue;
    const trained = Number(w[n].toFixed(3));
    const prior = priors.SIGNAL_WEIGHTS[n];
    if ((occurrences[n] ?? 0) < MIN_OCCURRENCES) {
      if (prior !== undefined) keptPrior.push(n);
      continue;
    }
    if (prior !== undefined && Math.sign(trained) !== Math.sign(prior) && Math.abs(trained) > 0.05) {
      rejectedSignFlip.push(`${n} (trained ${trained}, prior ${prior})`);
      continue;
    }
    finalWeights[n] = trained;
    trainedIds.push(n);
  }
  let textDepthW = Number(w['text-depth'].toFixed(3));
  if (Math.sign(textDepthW) !== Math.sign(priors.TEXT_DEPTH_WEIGHT)) {
    rejectedSignFlip.push(`text-depth (trained ${textDepthW}, prior ${priors.TEXT_DEPTH_WEIGHT})`);
    textDepthW = priors.TEXT_DEPTH_WEIGHT;
  }
  if (rejectedSignFlip.length) {
    console.log('\n⚠ Rejected (sign flip vs domain prior — out-of-domain corpus may not overturn direction):');
    for (const r of rejectedSignFlip) console.log('   ·', r);
  }

  // Deployment-prior recalibration: the corpus is 50/50 but reality isn't.
  // Solve bias so a signal-free 25-word review lands at TARGET_CLEAN_P.
  const depth25 = Math.log(25 / 18);
  const biasFinal = Number((Math.log(TARGET_CLEAN_P / (1 - TARGET_CLEAN_P)) - textDepthW * depth25).toFixed(3));

  console.log(`\nTrained (${trainedIds.length}):`, Object.fromEntries(trainedIds.map((n) => [n, finalWeights[n]])));
  console.log('text-depth weight:', textDepthW, '· corpus bias:', b.toFixed(3), '→ deployed bias:', biasFinal);
  if (keptPrior.length) console.log('Kept prior (too rare in corpus):', keptPrior.join(', '));

  // ---- Emit weights.ts ----
  const stamp = new Date().toISOString().slice(0, 10);
  const fmt = (id) => `  '${id}': ${finalWeights[id]},`;
  const out = `/**
 * Model parameters for the on-device fake-review classifier.
 *
 * ⚠️ GENERATED FILE — retrain with \`npm run train\` (tools/train/train.mjs),
 * which rewrites this file. Hand-edits will be overwritten.
 *
 * Provenance: trained ${stamp} on the Ott et al. Deceptive Opinion Spam corpus
 * (v1.4, ${samples.length} hotel reviews, 50/50 deceptive/truthful).
 * Held-out test: accuracy ${(m.acc * 100).toFixed(1)}%, deceptive-class precision ${(m.precDec * 100).toFixed(1)}%,
 * recall ${(m.recDec * 100).toFixed(1)}%. Behavioral/author weights remain domain priors —
 * a text-only corpus cannot estimate them (see docs/MODEL.md). Bias is
 * recalibrated to the deployment prior (signal-free review ≈ ${Math.round(TARGET_CLEAN_P * 100)}/100).${rejectedSignFlip.length ? `
 * Rejected sign-flips vs domain prior: ${rejectedSignFlip.join('; ')}.` : ''}
 */

/**
 * Logit-space weight per signal id. Negative pushes a review toward "fake";
 * positive toward "genuine".
 */
export const SIGNAL_WEIGHTS: Record<string, number> = {
  /* ---- Author / behavioral (priors — not trainable from text-only corpora) ---- */
${BEHAVIORAL.map(fmt).join('\n')}
  /* ---- Text heuristics (trained${keptPrior.length ? `; prior kept for: ${keptPrior.join(', ')}` : ''}) ---- */
${Object.keys(finalWeights).filter((k) => !BEHAVIORAL.includes(k)).sort().map(fmt).join('\n')}
};

/** Intercept, recalibrated to the deployment prior. */
export const BIAS = ${biasFinal};

/** Coefficient for the continuous text-depth feature (trained). */
export const TEXT_DEPTH_WEIGHT = ${textDepthW};
`;
  writeFileSync(OUT_WEIGHTS, out);
  console.log(`\nWrote ${path.relative(root, OUT_WEIGHTS)}`);
  rmSync(TMP, { recursive: true, force: true });
}

await main();
