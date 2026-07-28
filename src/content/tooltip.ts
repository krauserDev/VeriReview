/**
 * Hover tooltip: when the pointer rests on a highlighted review, show its
 * confidence score and the exact signals that were detected. Listeners are
 * attached only while a session is active and are fully removed on teardown.
 */
import { LEVEL_LABEL } from '../analysis/engine.js';
import { getAnalysisFor } from './highlighter.js';

let tooltip: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let onMouseOver: ((e: MouseEvent) => void) | null = null;
let onScroll: (() => void) | null = null;

function ensureTooltip(): HTMLDivElement {
  if (tooltip && document.contains(tooltip)) return tooltip;
  tooltip = document.createElement('div');
  tooltip.className = 'rs-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);
  return tooltip;
}

/** Returns true when a tooltip was actually shown for this target. */
function render(target: HTMLElement): boolean {
  const analysis = getAnalysisFor(target);
  if (!analysis) return false;

  const tip = ensureTooltip();
  tip.replaceChildren();

  const title = document.createElement('div');
  title.className = 'rs-tooltip__title';
  title.textContent = `VeriReview · ${analysis.score}/100 — ${LEVEL_LABEL[analysis.level]}`;
  tip.appendChild(title);

  const signals = analysis.signals.slice(0, 6);
  if (signals.length === 0) {
    const row = document.createElement('div');
    row.className = 'rs-tooltip__row rs-tooltip__row--good';
    row.textContent = 'No suspicious patterns detected in this review.';
    tip.appendChild(row);
  }
  for (const s of signals) {
    const row = document.createElement('div');
    // A trust signal (negative penalty = leans genuine) earns a green check; a
    // concern earns a caution mark, red when severe. The icon must match the
    // meaning — a ✓ on a fraud symptom read as reassurance.
    const kind =
      s.penalty < 0 ? 'rs-tooltip__row--good' : `rs-tooltip__row--flag rs-tooltip__row--${s.severity}`;
    row.className = `rs-tooltip__row ${kind}`;
    row.textContent = s.detail;
    tip.appendChild(row);
  }

  const rect = target.getBoundingClientRect();
  const top = Math.max(8, Math.min(window.innerHeight - 220, rect.top));
  const left = Math.max(8, Math.min(window.innerWidth - 340, rect.left));
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  tip.classList.add('rs-tooltip--visible');
  return true;
}

function hide(): void {
  tooltip?.classList.remove('rs-tooltip--visible');
}

export function initTooltip(): void {
  if (onMouseOver) return; // already active
  onMouseOver = (e: MouseEvent): void => {
    // [data-review-id] too: Google re-renders a card on pointer entry, wiping
    // our data-rs-id — getAnalysisFor recovers the analysis from Google's own
    // surviving id and re-stamps the card (see highlighter).
    const target = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(
      '[data-rs-id], [data-review-id]',
    );
    clearTimeout(hideTimer);
    if (!target || !render(target)) hideTimer = setTimeout(hide, 120);
  };
  onScroll = (): void => hide();
  // Capture phase is load-bearing on both listeners. Google Maps' delegated
  // event system (jsaction) stops mouse events from propagating out of review
  // cards — it renders its own hover overlay — so in the bubble phase this
  // listener never fires there and the tooltip simply doesn't exist on Maps.
  // In capture, document sees the event before any page handler can eat it.
  // Likewise Maps scrolls an inner pane, never the window, and scroll events
  // don't bubble — but they do capture through the ancestor chain.
  document.addEventListener('mouseover', onMouseOver, { passive: true, capture: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
}

/** Remove the tooltip node and detach all listeners — no residue left behind. */
export function destroyTooltip(): void {
  // removeEventListener must repeat the capture flag or it silently no-ops.
  if (onMouseOver) document.removeEventListener('mouseover', onMouseOver, { capture: true });
  if (onScroll) document.removeEventListener('scroll', onScroll, { capture: true });
  onMouseOver = null;
  onScroll = null;
  clearTimeout(hideTimer);
  tooltip?.remove();
  tooltip = null;
}
