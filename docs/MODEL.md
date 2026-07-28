# VeriReview — On-device fake-review classifier

The scoring engine is an **on-device logistic-regression classifier**
([src/analysis/model.ts](../src/analysis/model.ts)). It runs 100% in the
browser: no network, no per-use cost, no data leaves the device — which keeps
the extension private and Chrome-Web-Store friendly.

## How it works

For each review the pipeline produces a set of **interpretable signals**:

- **Text heuristics** ([text-analyzer.ts](../src/analysis/text-analyzer.ts)) —
  generic praise, marketing/AI-style wording, keyword stuffing, no specifics…
- **Behavioral signals** ([behavior-analyzer.ts](../src/analysis/behavior-analyzer.ts)) —
  near-duplicate text (Jaccard over word shingles), repeated authors, and
  **author-history signals**: `single-review-author`, `low-history-author`,
  `established-reviewer` (Local Guide / high review count).
- **Metadata** — verified purchase, helpful votes, author review count.

Each signal is a **feature**. The model combines them in logit space:

```
logit   = BIAS + Σ (weightᵢ · featureᵢ)
pGenuine = sigmoid(logit)
score    = round(pGenuine · 100)     // 0–100
```

Because the model is **linear**, each feature's contribution is exactly its
weight, so the UI can always explain *why* a review scored as it did
(`classifyReview` returns a sorted `contributions` list). The user's
**sensitivity** setting scales only the fraud-side (negative) weights.

### Why author signals dominate

Text-only detection has a low ceiling — a paid human review reads like a real
one. The strongest empirical predictors of purchased reviews are behavioral,
above all **a reviewer with a single review in their whole history**. On Google
this is read from the profile byline ("89 opiniones" / "1 reseña"), and it is
the highest-magnitude weight in the model. A page with many such reviewers
raises the page-level `many-first-time-reviewers` flag.

## The weights are the only learned parameters

`SIGNAL_WEIGHTS` and `BIAS` in `model.ts` are the model's parameters. The
current **v0** values are calibrated from domain priors so the classifier
behaves sensibly out of the box (see the calibration table below). Retraining
changes **only these numbers** — no other code.

### Continuous features (score spread)

Two mechanisms keep the distribution wide and honest — identical-looking
reviews only tie when the evidence is genuinely identical:

- **Signal intensity.** Detectors report variable penalties (generic-praise
  grows with the phrase count, near-duplicate with the cluster size). The
  learned weight is scaled by `clamp(|penalty|/10, 0.6, 1.3)`.
- **Text depth.** A bounded log feature of the word count
  (`clamp(ln(words/18)·0.28, −0.5, +0.55)`) separates a 6-word blurb from a
  120-word first-hand account.

### v0 calibration (sanity check)

| Scenario | Score |
|---|---|
| Clean review, 8 words | 85 |
| Clean review, 45 words | 91 |
| Clean, author with 12 reviews | 92 |
| Local Guide, 50 reviews | 97 |
| Detailed + verified purchase, 120 words | 98 |
| Repeat author on page (short text) | 71–73 |
| Mild generic wording | 78 |
| Strong generic + no specifics | 64 |
| Near-duplicate text only | 62 |
| Lone first-time reviewer (otherwise fine) | 49 |
| AI-style + marketing wording | 38 |
| Farm: 1-review account + near-duplicate | 15 |
| Bought-style: 1-review account + short generic | 13 |

## Training (implemented — tools/train)

`npm run train` retrains the weights on the **Ott et al. Deceptive Opinion
Spam corpus v1.4** (1600 hotel reviews, 800 deceptive/800 truthful) and
rewrites [src/analysis/weights.ts](../src/analysis/weights.ts) with full
provenance. See [tools/train/README.md](../tools/train/README.md).

Key properties:

- **Feature parity:** the trainer bundles the extension's own analyzers with
  esbuild — training and inference share one implementation.
- **Prior merge with safety policies:** signals too rare in the corpus keep
  their domain prior (nothing is dropped), and a trained weight may refine a
  magnitude but **not flip a signal's direction** against the prior — the
  corpus is out-of-domain (2011 MTurk hotel reviews vs. purchased product /
  local-business reviews), so direction changes require in-domain evidence.
  Example: the corpus says longer = more deceptive (MTurk writers were paid
  per text), the opposite of purchased-review reality; that sign flip was
  rejected and is stamped in the weights header.
- **Deployment-prior recalibration:** the corpus is 50/50 fake/genuine; the
  intercept is re-solved so a signal-free ~25-word review scores ≈ 87/100.

**Current run (2026-07-12):** held-out accuracy 64.4%, deceptive-class
precision 70.0%, recall 51.9%. That is an honest number for 9 coarse,
interpretable text features (bag-of-words SVMs reach ~90% on this corpus but
are neither explainable nor shippable at 30 KB). The production model's
discriminative power comes primarily from the **behavioral/author signals**
(single-review accounts, duplicate clusters, bursts) that no text-only corpus
can exercise — those remain domain priors until in-domain labeled data with
author metadata exists.

**Adopted from training:** `detailed-review` +0.94, `no-specifics` −0.24,
`repeated-structure` −0.22, `generic-praise` −0.07 (the corpus shows generic
praise is far weaker as a text-only discriminator than assumed — real hotel
guests write it too; the fraud burden correctly shifts to behavioral signals).

**Next data steps:** Amazon/Yelp filtered-review datasets (in-domain, with
metadata) to train behavioral weights and lift the sign constraints; weak
supervision from burst-pattern labels for Google local reviews.
