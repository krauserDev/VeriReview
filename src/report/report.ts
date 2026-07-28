/** Printable trust report — used for the "Export PDF" action (print → save as PDF). */
import type { PageAnalysis, ReviewAnalysis } from '../types/index.js';
import { LEVEL_LABEL, trustLevel } from '../analysis/engine.js';
import { gaugeSvg, ratingBarsSvg, scoreColor, timelineSvg, trustDonutSvg } from '../ui/charts.js';
import { escapeHtml } from '../utils/index.js';

const KEY = 'report:pending';

function reviewHtml(r: ReviewAnalysis): string {
  const signals = r.signals
    .map((s) => `<li>${escapeHtml(s.label)} — ${escapeHtml(s.detail)}</li>`)
    .join('');
  const text = r.review.text.length > 420 ? `${r.review.text.slice(0, 420)}…` : r.review.text;
  const stars = r.review.rating === null ? '—' : '★'.repeat(Math.round(r.review.rating));
  return `
    <div class="rp-review">
      <div class="rp-review__top">
        <span>${escapeHtml(r.review.author || 'Anonymous')} · ${stars} · ${
          r.review.verified ? 'Verified' : 'Unverified'
        }</span>
        <span class="rp-review__score" style="color:${scoreColor(r.score)}">${r.score}/100</span>
      </div>
      ${r.review.title ? `<div class="rp-review__title">${escapeHtml(r.review.title)}</div>` : ''}
      <p class="rp-review__text">${escapeHtml(text)}</p>
      ${signals ? `<ul class="rp-review__signals">${signals}</ul>` : ''}
    </div>`;
}

function render(analysis: PageAnalysis): void {
  const root = document.getElementById('report');
  if (!root) return;

  const flagged = analysis.reviews.filter(
    (r) => r.level === 'attention' || r.level === 'suspicious',
  );
  flagged.sort((a, b) => a.score - b.score);
  const shown = flagged.slice(0, 15);

  const donutCounts = {
    genuine: analysis.reviews.filter((r) => r.level === 'genuine').length,
    mixed: analysis.reviews.filter(
      (r) => r.level === 'possibly-genuine' || r.level === 'attention',
    ).length,
    suspicious: analysis.reviews.filter((r) => r.level === 'suspicious').length,
  };
  const pageLevel = trustLevel(analysis.trustIndex);

  root.innerHTML = `
    <div class="rp-head">
      <div>
        <h1>Trust Report</h1>
        <div class="rp-sub">${escapeHtml(analysis.pageTitle)}<br>${escapeHtml(analysis.url)}</div>
      </div>
      <div class="rp-brand">🔍 VeriReview</div>
    </div>

    <div class="rp-actions">
      <button id="print">Print / Save as PDF</button>
      <button id="close" class="rp-ghost">Close</button>
    </div>

    <div class="rp-hero">
      ${gaugeSvg(analysis.trustIndex, 150)}
      <div>
        <div class="rp-hero__label">Overall verdict</div>
        <div class="rp-hero__verdict" style="color:${scoreColor(analysis.trustIndex)}">
          ${LEVEL_LABEL[pageLevel]} — ${analysis.riskLabel}
        </div>
        <div class="rp-hero__conf">Confidence: ${analysis.confidence} · ${analysis.reviewCount} reviews analyzed</div>
        ${
          (analysis.patternPenalty ?? 0) > 0
            ? `<div class="rp-hero__conf">Breakdown: avg review score ${analysis.reviewScoreAvg} − ${analysis.patternPenalty} page-level warnings = ${analysis.trustIndex}</div>`
            : ''
        }
      </div>
    </div>

    <div class="rp-stats">
      <div class="rp-stat"><b>${analysis.trustIndex}</b><span>Trust Index</span></div>
      <div class="rp-stat"><b>${analysis.averageRating === null ? '—' : `${analysis.averageRating.toFixed(1)}★`}</b><span>Average rating</span></div>
      <div class="rp-stat"><b>${flagged.length}</b><span>Flagged reviews</span></div>
      <div class="rp-stat"><b>${analysis.patterns.length}</b><span>Page patterns</span></div>
    </div>

    <h2 class="rp-h">Charts</h2>
    <div class="rp-charts">
      ${ratingBarsSvg(analysis.ratingDistribution)}
      ${trustDonutSvg(donutCounts)}
    </div>
    <div class="rp-timeline">${timelineSvg(analysis.timeline)}</div>

    <h2 class="rp-h">Suspicious patterns</h2>
    ${
      analysis.patterns.length > 0
        ? analysis.patterns
            .map(
              (p) =>
                `<div class="rp-pattern"><b>${escapeHtml(p.label)}</b><p>${escapeHtml(p.detail)}</p></div>`,
            )
            .join('')
        : '<p class="rp-rec">No page-level suspicious patterns were detected.</p>'
    }

    <h2 class="rp-h">Recommendations</h2>
    ${analysis.recommendations.map((r) => `<p class="rp-rec">• ${escapeHtml(r)}</p>`).join('')}

    <h2 class="rp-h">Most suspicious reviews${shown.length < flagged.length ? ` (top ${shown.length})` : ''}</h2>
    ${shown.length > 0 ? shown.map(reviewHtml).join('') : '<p class="rp-rec">No reviews were flagged as suspicious.</p>'}

    <div class="rp-foot">
      <span>Generated ${new Date(analysis.scannedAt).toLocaleString()}</span>
      <span>All analysis performed locally · VeriReview</span>
    </div>`;

  document.getElementById('print')?.addEventListener('click', () => window.print());
  document.getElementById('close')?.addEventListener('click', () => window.close());
}

void (async () => {
  const stored = await chrome.storage.local.get(KEY);
  const analysis = stored[KEY] as PageAnalysis | undefined;
  if (!analysis) {
    const loading = document.getElementById('loading');
    if (loading) loading.textContent = 'No report data found. Run a scan first, then export again.';
    return;
  }
  await chrome.storage.local.remove(KEY);
  render(analysis);
})();
