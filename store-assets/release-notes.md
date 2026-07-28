# VeriReview — Release Notes

## v1.0.0 — Initial release (July 2026)

**Analysis**
- Trust Index (0–100) with verdict, risk label and confidence level
- Per-review scoring with explained signals: generic praise, marketing language, AI-style writing, emotional overload, keyword stuffing, repeated structure, lack of specifics, excessive caps/exclamations/emoji, and more
- Positive signals too: detailed reviews, verified purchases and helpful votes raise scores
- Near-duplicate detection (text similarity clustering)
- Page-level patterns: five-star skew, review bombing, review bursts, polarized distributions, compressed timelines, duplicate clusters, repeat authors, anonymous-profile prevalence
- Adjustable sensitivity and analysis depth (Quick 50 / Standard 150 / Deep 400 reviews)

**Interface**
- Floating button + glassmorphism dashboard panel (isolated Shadow DOM)
- Animated trust gauge, rating distribution, trust breakdown donut, review timeline
- 11 review filters, jump-to-review, on-page colored highlighting with hover tooltips
- Popup with current page score, recent scans and one-click rescan
- Full options page: site toggles, sensitivity, depth, theme (light/dark/system), auto-scan, highlighting, notifications with threshold, searchable history, settings export/import, clear data
- Dark mode across panel, popup and options; reduced-motion support; ARIA labels

**Platform**
- Sites: Amazon (7 marketplaces) and Google (Maps/Search reviews)
- Export: JSON, CSV, printable PDF report
- Notifications for low-trust pages (optional)
- Context-menu "Scan reviews" entry
- 100% local analysis — no network requests, no telemetry
- Manifest V3, minimum Chrome 110

**Known limitations**
- Heuristic analysis: false positives/negatives are possible by design
- Only reviews loaded in the DOM are analyzed (pagination is not auto-crawled)
- Google review DOM changes frequently; selectors include fallbacks but may need updates
- English-optimized text signals; other languages get structural/statistical signals only

**Roadmap ideas**
- More sites (Trustpilot, Booking, TripAdvisor) via the adapter system
- Optional opt-in AI providers for deeper text analysis
- Reviewer-profile signals, cross-page comparisons, additional locales
