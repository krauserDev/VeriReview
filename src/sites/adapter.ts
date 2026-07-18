/**
 * Site adapter contract. To support a new shopping site, implement
 * SiteAdapter and add it to the registry in ./index.ts — nothing else in the
 * extension needs to change.
 */
import type { ParsedReview, ReviewSubject } from '../types/index.js';

export interface SiteAdapter {
  /** Machine id, must match Settings.enabledSites keys. */
  readonly id: 'amazon' | 'google';
  /** Human-readable site name. */
  readonly name: string;
  /**
   * What this adapter's reviews are *about*. Only the adapter knows — and it
   * always knows, with no guessing. Advice that assumes a purchase ("compare
   * with another seller") is nonsense on a physiotherapy clinic, so the engine
   * uses this to pick the right vocabulary.
   */
  readonly subject: ReviewSubject;
  /** True when this adapter should handle the given location. */
  matches(location: Location): boolean;
  /** True when the current page is expected to contain reviews. */
  isReviewPage(): boolean;
  /** All review container elements currently in the DOM. */
  findReviewElements(): HTMLElement[];
  /** Parse one review element into the normalized shape (null if unusable). */
  parseReview(el: HTMLElement): ParsedReview | null;
}

/** Query the first matching selector from a list of fallbacks. */
export function queryFirst(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

/** Safe trimmed text content. */
export const textOf = (el: Element | null): string => el?.textContent?.trim() ?? '';
