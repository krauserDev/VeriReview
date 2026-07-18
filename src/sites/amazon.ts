/**
 * Amazon adapter. Works on product pages (#customerReviews section) and the
 * dedicated reviews page (/product-reviews/…). Uses data-hook attributes,
 * which are Amazon's most stable selectors, with class fallbacks.
 */
import type { ParsedReview } from '../types/index.js';
import { hashString, parseReviewDate } from '../utils/index.js';
import { detectReviewCards, extractRating } from './detector.js';
import { queryFirst, textOf, type SiteAdapter } from './adapter.js';

const RATING_RE = /([\d.,]+)\s*(?:out of|von|sur|de|su)\s*5/i;

/**
 * Review body containers across Amazon layouts. The current layout uses the
 * camelCase `reviewText` hook; older/international pages use `review-body` or
 * plain classes.
 */
const BODY_SELECTORS = [
  '[data-hook="reviewText"]',
  '[data-hook="reviewTextContainer"]',
  '[data-hook="review-body"]',
  '.review-text-content',
  '.review-text',
];

/**
 * Non-content descendants that live *inside* the body container: screen-reader
 * teasers ("Brief content visible, double tap…"), the see-more/less prompts,
 * and our own injected score chip. Stripped before reading the text.
 */
const NON_CONTENT_SELECTOR =
  '.a-teaser-describedby-collapsed, .a-teaser-describedby-expanded, .a-see-more-text, .a-see-less-text, .a-expander-prompt, .rs-chip, script, style';

/**
 * UI/boilerplate text used to reject junk blocks in the last-resort fallback.
 * Only distinctive multi-word UI phrases — single common words ("útil",
 * "denuncia") would wrongly reject genuine reviews that contain them.
 */
const BOILERPLATE_RE =
  /double tap to read|content visible|enviando comentarios|gracias por tus comentarios|no hemos podido registrar|lo investigaremos|people found this helpful|personas? encontr/i;

/** Read the review body, stripping Amazon's a11y teasers and expander prompts. */
function extractBody(el: HTMLElement): string {
  const container = queryFirst(el, BODY_SELECTORS);
  if (container) {
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(NON_CONTENT_SELECTOR).forEach((n) => n.remove());
    const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  // Universal-detector cards (no known hook): longest non-boilerplate block,
  // never our own chip.
  const blocks = [...el.querySelectorAll<HTMLElement>('span, p, div')]
    .filter((n) => !n.closest('.rs-chip'))
    .map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 30 && !BOILERPLATE_RE.test(t));
  blocks.sort((a, b) => b.length - a.length);
  return blocks[0] ?? '';
}

/** Read the review title, stripping the embedded star-rating alt text. */
function extractTitle(el: HTMLElement): string {
  const titleEl = queryFirst(el, [
    '[data-hook="reviewTitle"]',
    '[data-hook="review-title"]',
    '.review-title',
  ]);
  if (!titleEl) return '';
  const clone = titleEl.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.a-icon-alt, script, style').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export const amazonAdapter: SiteAdapter = {
  id: 'amazon',
  name: 'Amazon',
  subject: 'product',

  matches(location: Location): boolean {
    return /(^|\.)amazon\./.test(location.hostname);
  },

  isReviewPage(): boolean {
    return (
      /\/(dp|gp\/product|product-reviews)\//.test(location.pathname) ||
      document.querySelector('[data-hook="review"]') !== null
    );
  },

  findReviewElements(): HTMLElement[] {
    const byHook = document.querySelectorAll<HTMLElement>('[data-hook="review"]');
    if (byHook.length) return [...byHook];
    const fallback = [...document.querySelectorAll<HTMLElement>('div.review, li[data-hook="review"]')];
    if (fallback.length) return fallback;
    // Amazon occasionally ships markup without data-hook (A/B tests, some
    // locales). Fall back to the universal star-anchored detector so reviews
    // are still found and scored individually.
    return detectReviewCards();
  },

  parseReview(el: HTMLElement): ParsedReview | null {
    const text = extractBody(el);
    const title = extractTitle(el);
    if (!text && !title) return null;

    const ratingEl = queryFirst(el, [
      '[data-hook="review-star-rating"]',
      '[data-hook="cmps-review-star-rating"]',
      'i.review-rating',
      '.a-icon-star .a-icon-alt',
    ]);
    const ratingMatch = textOf(ratingEl).match(RATING_RE);
    const rating = ratingMatch ? Number(ratingMatch[1]!.replace(',', '.')) : extractRating(el);

    const dateRaw = textOf(queryFirst(el, ['[data-hook="review-date"]', '.review-date']));
    const author = textOf(queryFirst(el, ['.a-profile-name', '[data-hook="genome-widget"] .a-profile-name']));

    const verified = el.querySelector('[data-hook="avp-badge"], [data-hook="avp-badge-linkless"]') !== null;

    const helpfulRaw = textOf(queryFirst(el, ['[data-hook="helpful-vote-statement"]']));
    const helpfulMatch = helpfulRaw.match(/([\d,.]+)/);
    let helpfulVotes = helpfulMatch ? Number(helpfulMatch[1]!.replace(/[,.]/g, '')) : 0;
    if (/one person/i.test(helpfulRaw)) helpfulVotes = 1;
    if (Number.isNaN(helpfulVotes)) helpfulVotes = 0;

    const id = el.id || `am-${hashString(author + title + text.slice(0, 120))}`;

    return {
      id,
      author: author || 'Amazon Customer',
      rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
      title,
      text,
      dateISO: dateRaw ? parseReviewDate(dateRaw) : null,
      verified,
      helpfulVotes,
      // Amazon does not expose the reviewer's profile review count inline.
      authorReviewCount: null,
      authorIsLocalGuide: false,
    };
  },
};
