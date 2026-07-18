/**
 * Highlights analyzed reviews in the host page with colored outlines and a
 * small score chip. Uses data attributes + outline (no layout impact) and is
 * fully reversible.
 */
import type { ReviewAnalysis } from '../types/index.js';
import { LEVEL_LABEL } from '../analysis/engine.js';

const registry = new Map<string, { el: HTMLElement; analysis: ReviewAnalysis }>();

function buildChip(analysis: ReviewAnalysis): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = `rs-chip rs-chip--${analysis.level}`;
  chip.textContent = `${analysis.score} · ${LEVEL_LABEL[analysis.level]}`;
  chip.setAttribute('role', 'note');
  chip.setAttribute(
    'aria-label',
    `ReviewShield score ${analysis.score} out of 100 — ${LEVEL_LABEL[analysis.level]}`,
  );
  return chip;
}

export function applyHighlights(entries: Array<{ el: HTMLElement; analysis: ReviewAnalysis }>): void {
  clearHighlights();
  for (const { el, analysis } of entries) {
    registry.set(analysis.review.id, { el, analysis });
    el.dataset.rsLevel = analysis.level;
    el.dataset.rsId = analysis.review.id;
    el.prepend(buildChip(analysis));
  }
}

export function clearHighlights(): void {
  for (const { el } of registry.values()) {
    delete el.dataset.rsLevel;
    delete el.dataset.rsId;
    el.querySelector(':scope > .rs-chip')?.remove();
  }
  registry.clear();
}

export function getAnalysisFor(el: HTMLElement): ReviewAnalysis | null {
  const host = el.closest<HTMLElement>('[data-rs-id]');
  if (host?.dataset.rsId) return registry.get(host.dataset.rsId)?.analysis ?? null;

  // Google Maps re-renders a review card the moment the pointer enters it
  // (jsaction "review.in" drives its hover overlay), wiping our attributes and
  // chip exactly when the tooltip needs them. Google's own data-review-id
  // survives the re-render, and Google review ids are `gg-<data-review-id>`,
  // so the analysis is still recoverable. Re-stamp the fresh node while we're
  // here so the outline, the chip and future hovers work again — self-healing
  // on interaction, with no standing MutationObserver.
  const card = el.closest<HTMLElement>('[data-review-id]');
  const entry = card ? registry.get(`gg-${card.getAttribute('data-review-id')}`) : undefined;
  if (!card || !entry) return null;
  entry.el = card;
  card.dataset.rsId = entry.analysis.review.id;
  card.dataset.rsLevel = entry.analysis.level;
  if (!card.querySelector('.rs-chip')) card.prepend(buildChip(entry.analysis));
  return entry.analysis;
}

/** Scroll a highlighted review into view (used by panel list). */
export function scrollToReview(id: string): void {
  registry.get(id)?.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
