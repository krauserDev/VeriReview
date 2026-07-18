/**
 * Universal, text-pattern-free review detector.
 *
 * Every review on every supported site has exactly one visible star-rating
 * indicator. We anchor on those rating nodes and, for each, climb to the
 * smallest ancestor that also encloses a substantial block of review prose.
 * That ancestor is the review card. This works identically on Amazon, Google
 * Maps and Google Search and never depends on localized labels like
 * "Reseña de" or on rotating class names — only on the structural fact that a
 * review = (one rating) + (some text) grouped together.
 */

/** Regexes that identify a star-rating from an element's text or aria-label. */
const STARS_TEXT_RE =
  /([0-5](?:[.,]\d)?)\s*(?:out of|von|sur|de|su|\/)\s*5|([0-5](?:[.,]\d)?)\s*(?:stars?|estrellas?|étoiles?|sterne|stelle)/i;
// A trailing `/digit` after the "5" means it is a date (`1/5/2026`), not a
// rating, so it must not match — the old `[^\d]` allowed exactly that and
// invented 1-star reviews from May dates.
const SLASH5_RE = /(?:^|[^\d/])([0-5](?:[.,]\d)?)\s*\/\s*5(?![\d/])/;
/** A d/m/y (or d.m.y, d-m-y) date, never a rating. */
const DATE_LIKE_RE = /\b\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}\b/;

/**
 * Aggregate rating labels ("Rating 4.8 of 5, 42 reviews") describe a whole
 * product/place, not a single review. They mention a review *count*, so we
 * skip them — otherwise the page header would be parsed as a phantom review.
 */
const AGGREGATE_RE =
  /\d[\d.,]*\s*(?:reseñas?|opiniones|valoraciones|calificaciones|reviews?|ratings?|avis|bewertungen|recensioni)/i;

/**
 * Words that name a rating widget across the supported locales. Google labels
 * its `role="img"` star graphics "Calificación/Valoración … de 5" (no visible
 * text and no "/5"), which is why matching on these words — or on role="img" —
 * is required in addition to the numeric pattern.
 */
const RATING_WORD_RE =
  /star|estrella|étoile|stern|stella|rated|rating|valorac|calific|puntuac|note\b|bewert|valutaz|out of 5|de\s*5|sur\s*5|su\s*5|\/\s*5/i;

/** Extract a 1–5 rating from a node's aria-label(s) or text, or null. */
export function extractRating(el: Element): number | null {
  const self = el.getAttribute('aria-label');
  if (self && !AGGREGATE_RE.test(self)) {
    const r = matchRating(self);
    if (r !== null) return r;
  }
  // The first aria-label descendant is often an avatar or menu button — scan
  // them all for the one that actually encodes a per-review rating.
  for (const node of el.querySelectorAll('[aria-label]')) {
    const a = node.getAttribute('aria-label') ?? '';
    if (AGGREGATE_RE.test(a)) continue;
    const r = matchRating(a);
    if (r !== null) return r;
  }
  // Text fallback: read only from SHORT leaf nodes that are a rating widget
  // ("5/5", "4,0 de 5"). Never scan the whole card's textContent — a date in the
  // body ("1/5/2026") or a phrase ("fui 1 de 5 sesiones") would be read as the
  // rating and fabricate low-star reviews the page doesn't have.
  for (const node of el.querySelectorAll('span, div, i, b')) {
    if (node.children.length > 0) continue; // leaves only
    const t = (node.textContent ?? '').trim();
    if (!t || t.length > 30 || AGGREGATE_RE.test(t) || DATE_LIKE_RE.test(t)) continue;
    const r = matchRating(t);
    if (r !== null) return r;
  }
  return null;
}

function matchRating(s: string): number | null {
  const m = s.match(STARS_TEXT_RE) ?? s.match(SLASH5_RE);
  if (!m) return null;
  const raw = m[1] ?? m[2] ?? m[0];
  const n = Number(String(raw).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/** True if this element looks like a dedicated (single-review) star-rating widget. */
function isRatingNode(el: Element): boolean {
  const aria = el.getAttribute('aria-label') ?? '';
  if (aria && matchRating(aria) !== null && !AGGREGATE_RE.test(aria)) {
    // Authoritative when the label sits on an actual rating widget: a
    // role="img" star graphic (Google) or a label that names a rating.
    if (el.getAttribute('role') === 'img' || RATING_WORD_RE.test(aria)) return true;
  }
  // Short text nodes like "5/5" or "4,0 de 5 estrellas".
  const txt = (el.textContent ?? '').trim();
  if (txt.length <= 40 && (SLASH5_RE.test(txt) || STARS_TEXT_RE.test(txt))) return true;
  return false;
}

const MIN_BODY_CHARS = 30;
const MAX_CLIMB = 8;

/**
 * Given a rating node, climb to the smallest ancestor that contains enough
 * text to be a review body but isn't so large it swallows sibling reviews.
 */
function cardFromRating(ratingNode: Element): HTMLElement | null {
  let el: HTMLElement | null = ratingNode.parentElement;
  let best: HTMLElement | null = null;
  for (let i = 0; i < MAX_CLIMB && el; i += 1) {
    const text = (el.textContent ?? '').trim();
    // Count how many *other* rating nodes live in this ancestor. If more than
    // one, we've climbed past a single review into a list container — stop.
    const ratingCount = countRatings(el);
    if (ratingCount > 1) break;
    if (text.length >= MIN_BODY_CHARS) {
      best = el;
      // A card usually has a bit of structure; once we have a decent block with
      // its own rating, prefer the tightest such container.
      if (text.length >= 60) return el;
    }
    el = el.parentElement;
  }
  return best;
}

/** Count *distinct* (non-nested) rating widgets within a subtree. */
function countRatings(root: Element): number {
  const found: Element[] = [];
  const candidates = root.querySelectorAll('[aria-label], span, i, div');
  for (const c of candidates) {
    if (!isRatingNode(c)) continue;
    // Ignore rating nodes nested inside an already-counted one (e.g. a rating
    // <i> and its inner <span> are the same widget, not two ratings).
    if (found.some((f) => f.contains(c) || c.contains(f))) continue;
    found.push(c);
    if (found.length > 1) return found.length; // early exit
  }
  return found.length;
}

/**
 * Detect review cards generically. Returns unique, non-nested card elements.
 * `scope` lets an adapter restrict the search (e.g. Amazon's review list).
 */
export function detectReviewCards(scope: ParentNode = document): HTMLElement[] {
  const ratingNodes: Element[] = [];
  const seenRating = new Set<Element>();
  for (const el of scope.querySelectorAll('[aria-label], span, i, div')) {
    if (seenRating.has(el)) continue;
    // Never let our own injected UI (fab, tooltip, chips, panel host) be
    // mistaken for a review — it lives in the same document and can contain
    // short numeric text that coincidentally looks like a rating.
    if (el.closest('[data-reviewshield], .rs-fab, .rs-tooltip, .rs-chip')) continue;
    if (isRatingNode(el)) {
      // Skip rating nodes nested inside an already-collected rating node.
      if (ratingNodes.some((r) => r.contains(el) || el.contains(r))) continue;
      ratingNodes.push(el);
      seenRating.add(el);
    }
  }

  const cards = new Set<HTMLElement>();
  for (const rn of ratingNodes) {
    const card = cardFromRating(rn);
    if (card) cards.add(card);
  }

  // Remove nested cards (keep the innermost, since that's the single review).
  const arr = [...cards];
  return arr.filter((el) => !arr.some((other) => other !== el && el.contains(other)));
}
