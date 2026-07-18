# Training pipeline

Retrains the on-device classifier's weights (`src/analysis/weights.ts`).

## Run

```bash
npm run train
```

## Data

Expects the Ott et al. *Deceptive Opinion Spam* corpus v1.4 extracted at
`tools/train/data/corpus/op_spam_v1.4/` (1600 hotel reviews, 800 deceptive
from MTurk / 800 truthful). Download: https://myleott.com/op_spam_v1.4.zip
(the `data/` directory is git-ignored).

## How it works

1. Bundles the extension's **own analyzers** (`text-analyzer.ts`, `model.ts`)
   with esbuild — training and inference share one feature implementation.
2. Extracts the same features the extension computes: signal intensities +
   continuous text-depth.
3. Fits an L2-regularized logistic regression (full-batch GD, deterministic
   seed), evaluates on a held-out 20% split.
4. Merges with `priors.json` under two safety policies:
   - **Coverage:** signals too rare in the corpus (< 12 occurrences) keep
     their domain prior; nothing is ever dropped.
   - **Sign constraint:** the corpus (2011 MTurk hotel reviews) is
     out-of-domain for purchased product/local-business reviews, so a trained
     weight may refine a magnitude but not flip a signal's direction against
     the prior. Rejections are logged and stamped into the file header.
5. Recalibrates the intercept to the deployment prior (the corpus is 50/50
   fake/genuine; the real world is not): a signal-free ~25-word review scores
   ≈ 87/100.
6. Rewrites `src/analysis/weights.ts` with full provenance in the header.

## Improving the model

The biggest gains will come from **in-domain labeled data** (real purchased
product/local reviews with author metadata), which would let us train the
behavioral weights — currently domain priors — and lift the sign constraints.
