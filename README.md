# 🛡 ReviewShield

**Spot suspicious reviews on Amazon and Google — locally, privately, with explanations.**

ReviewShield is a Manifest V3 Chrome extension that analyzes the reviews on the page you're viewing and produces a 0–100 **Trust Index**, per-review scores with human-readable reasons, page-level suspicious-pattern detection, and a full dashboard with charts, filters and exports.

Two principles drive every design decision:

- **Zero data collection.** All analysis runs 100% on-device. The extension makes **no network requests** — no servers, no accounts, no analytics, no telemetry. Verifiable in DevTools and in this source tree (`grep -rE "fetch\(|XMLHttpRequest" src/` → nothing).
- **Signals, not verdicts.** ReviewShield flags statistical patterns commonly associated with paid or fake reviews and always shows *why*. It never claims to prove an individual review is fake, and a low score is not an accusation against its author.

---

## Features

- **Manual by default:** the extension is completely idle until you click **Analyze** (toolbar popup), use the right-click menu, or press **Alt+Shift+A**. No background scanning, no observers, no CPU use while you browse. Closing the panel restores the page exactly. (Optional auto-scan setting, off by default.)
- **Trust Index (0–100)** with a transparent breakdown: average of per-review scores − page-level warnings, explained in plain language in the panel.
- **Per-review verdicts** — Trusted / Probably real / Questionable / High risk — as colored badges on the page, with hover tooltips listing the exact signals behind each score.
- **On-device classifier:** logistic model over interpretable features (reviewer history, near-duplicate text, timing bursts, rating skew, text heuristics). Weights are trained (see [docs/MODEL.md](docs/MODEL.md)) and fully published — no black box.
- **Author-history signals:** single-review accounts and thin profiles (the strongest markers of purchased reviews on Google), Local Guide status, per-page repeat authors.
- **Page-level patterns:** five-star walls, review bombing, bursts, polarized distributions, compressed timelines, copy-paste clusters, floods of first-time reviewers.
- **Dashboard panel** (Shadow-DOM isolated): star-rating distribution vs. ReviewShield verdicts (clearly separated), reviews-per-month trend chart, suspicious activity, recommendations, live-counted filters (trust bands, verified, suspicious, repeat authors…), score-range and sort controls, author drill-down, jump-to-review.
- **Exports:** JSON, CSV (Excel-safe UTF-8) and a printable PDF report.
- **Multilingual parsing:** review dates and rating widgets in English, Spanish, French, German and Italian.
- **Accessibility:** ARIA labels, keyboard focus, `prefers-reduced-motion`.
- **i18n:** English + Spanish store locales shipped.

## Supported sites

| Site | Pages |
|---|---|
| Amazon (.com .co.uk .de .fr .es .it .ca .nl .com.mx) | Product pages & review pages |
| Google (.com and country domains) | Search business panels, full review views, Maps places |

New sites are one small adapter away — see [Architecture](#architecture).

---

## Installation (development / unpacked)

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the **`dist/`** folder
4. Visit an Amazon product page or a Google business/reviews page and click **Analyze reviews** in the extension popup (or right-click → Analyze, or Alt+Shift+A)

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Clean → typecheck → lint → bundle to `dist/` |
| `npm test` | 70+ regression tests: real-DOM parser fixtures (jsdom), multilingual dates, classifier invariants, chart bucketing |
| `npm run train` | Retrain the classifier weights on a labeled corpus → rewrites `src/analysis/weights.ts` (see [tools/train/README.md](tools/train/README.md)) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm run format` | Prettier write |
| `npm run package` | Build + **tests** + zip `dist/` into `release/` — tests gate the release |
| `npm run clean` | Remove `dist/` |

## Publishing to the Chrome Web Store

Everything reviewer-facing lives in [`docs/store/`](docs/store/):

1. `npm run package` → upload `release/reviewshield-<version>.zip`
2. Paste the listing texts and permission justifications from [`docs/store/DASHBOARD.md`](docs/store/DASHBOARD.md)
3. Host [`docs/store/privacy-policy.html`](docs/store/privacy-policy.html) at a public https URL and link it in the listing
4. Compliance evidence (policy-by-policy, with runnable verification): [`docs/store/COMPLIANCE.md`](docs/store/COMPLIANCE.md)
5. User-facing honesty FAQ: [`docs/store/FAQ.md`](docs/store/FAQ.md)

---

## Architecture

```
reviewshield/
├── public/                  # Static assets copied to dist/
│   ├── manifest.json        # MV3 manifest
│   ├── icons/               # 16/32/48/128 px
│   └── _locales/en, es/     # chrome.i18n messages
├── scripts/                 # build / clean / package (esbuild, Node)
├── src/
│   ├── analysis/            # Pure, testable analysis logic
│   │   ├── text-analyzer.ts     # Linguistic signals per review
│   │   ├── rating-analyzer.ts   # Distribution & timeline patterns
│   │   ├── behavior-analyzer.ts # Duplicates, author history, profiles
│   │   ├── model.ts             # On-device logistic classifier (explainable)
│   │   ├── weights.ts           # GENERATED — model parameters + provenance
│   │   └── engine.ts            # Orchestrates → PageAnalysis
│   ├── sites/               # Site adapters (extension point)
│   │   ├── adapter.ts           # SiteAdapter interface
│   │   ├── detector.ts          # Universal star-anchored review detector
│   │   ├── amazon.ts / google.ts
│   │   └── index.ts             # Registry + findAdapter()
│   ├── services/            # settings, history/cache, export
│   ├── content/             # Content script: manual-mode session, panel, highlighter, tooltip
│   ├── background/          # Service worker: entry-point routing, badge, notifications, menus
│   ├── popup/  options/  report/   # Extension pages
│   ├── ui/charts.ts         # Dependency-free SVG charts
│   ├── types/               # Shared domain types
│   └── utils/               # Text/date/hash helpers
├── tests/                   # node:test + jsdom; fixtures/ hold real-DOM regression cases
├── tools/train/             # Training pipeline (logistic regression over the extension's own analyzers)
└── docs/                    # MODEL.md, ASO plan, store/ (privacy policy, compliance, FAQ, dashboard texts)
```

**Design decisions**

- **Zero runtime dependencies.** Charts are hand-rolled SVG; similarity uses Jaccard over bigram shingles. Small bundle, no supply-chain surface, nothing that could phone home.
- **Idle-by-default content script.** No standing observers or timers anywhere (`grep -rE "setInterval|MutationObserver" src/` → nothing). An analysis is a bounded, user-triggered session with full teardown.
- **Closed Shadow DOM** for the panel — host page CSS can't break it and vice versa.
- **Explainability end-to-end.** Every signal is a `ReviewSignal { label, detail, penalty }`; the classifier is linear, so each feature's contribution is exact and the UI can always answer "why?".
- **Site adapters.** To support a new site, implement `SiteAdapter` and register it in `src/sites/index.ts`. Nothing else changes. Each adapter declares a `subject` (`'product' | 'place'`) so advice is always phrased for what the page actually is — telling someone to "compare with another seller" on a physiotherapy clinic is the kind of detail that destroys trust in the whole analysis.
- **Structural parsing, not class names.** Google obfuscates and rotates CSS classes; adapters anchor on stable structure (aria-labels, text nodes, date invariants) and every parsing bug we've hit ships with a real-DOM fixture test so it can't regress silently.

### How scoring works

1. Analyzers emit interpretable signals per review (text heuristics, behavior, author history) plus continuous features (text depth, reviewer track record).
2. The on-device logistic classifier combines them: `score = sigmoid(bias + Σ weightᵢ·featureᵢ) × 100`. Weights are trained on a labeled corpus with documented safeguards (out-of-domain sign constraints, deployment-prior calibration) — full details and honest accuracy numbers in [docs/MODEL.md](docs/MODEL.md).
3. The page Trust Index = weighted mean of review scores − penalties for page-level patterns. The breakdown is shown to the user.
4. Confidence (low/medium/high) reflects sample size.

## Privacy

**Zero data collection.** Everything runs on-device; the extension makes no network requests of any kind. Settings live in `chrome.storage.sync` (synced across *your own* devices by *your* browser, if you enable Chrome sync); scan history and a 24 h cache live in `chrome.storage.local`, auto-pruned, one-click wipe in Options. Full policy: [`docs/store/privacy-policy.html`](docs/store/privacy-policy.html).

## Limitations (honest)

- Heuristic + statistical analysis ⇒ false positives and negatives happen. A low score means "read carefully", never "proven fake".
- Only reviews the page renders are analyzed. The manual analysis drives the page's own "more reviews" button / lazy-loading a bounded number of rounds.
- Text signals are English-optimized; other languages lean on structural/behavioral signals (which are the strongest ones anyway).
- Google's review DOM changes often; adapters use structural anchors + fixture tests, but maintenance will be needed.

## License

MIT
