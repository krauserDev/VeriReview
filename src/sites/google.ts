/**
 * Google Reviews adapter — Google Maps place reviews and Google Search
 * knowledge-panel reviews. Detection is delegated to the universal,
 * text-pattern-free detector (see ./detector.ts), so it does not depend on the
 * "Reseña de" label or on rotating class names. This adapter only parses fields
 * out of an already-detected review card.
 */
import type { ParsedReview } from '../types/index.js';
import { hashString, isGenericAuthor, parseReviewDate } from '../utils/index.js';
import { detectReviewCards, extractRating } from './detector.js';
import { queryFirst, textOf, type SiteAdapter } from './adapter.js';

const ATTRIBUTION_RE = /(reseña de|review from|reseñas de|opinión de|avis de|bewertung von|recensione di)/i;
// Word boundaries are load-bearing: without \b, the Italian marker "fa"
// matches inside names ("Josefa", "Rafa") and rejects them as dates.
const RELATIVE_DATE_RE =
  /\b(hace|ago|il y a|vor|fa)\b\s+.*|\b(?:un|una|a|an|\d+)\s+(día|days?|semana|weeks?|mes|months?|año|years?|jour|semaine|mois|an|tag|woche|monat|jahr|giorno|settimana|mese|anno)\b/i;

/** Lowercase + strip accents for exact UI-string comparisons. */
const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * Exact (accent-folded) UI action labels that appear as leaf nodes inside a
 * review card and must never be mistaken for the reviewer's name.
 */
const UI_TEXT = new Set([
  'denunciar resena', 'report review', 'informar', 'compartir', 'share',
  'traducir', 'translate', 'leer mas', 'leer menos', 'read more', 'more', 'mas',
  'nueva', 'nuevo', 'new', 'util', 'helpful', 'me gusta', 'like', 'seguir',
  'follow', 'guardar', 'save', 'editar', 'edit', 'llamar', 'llamar ahora',
  'como llegar', 'sitio web', 'website', 'ver todos', 'ver mas', 'reservar',
]);

/** Leaf looks like a UI control, not a person. */
function isUiText(t: string): boolean {
  return UI_TEXT.has(norm(t)) || /^(denunciar|report|compartir|share|traducir|translate)\b/i.test(t);
}

/**
 * Google appends a structured attributes block to restaurant/place reviews —
 * "Tipo de pedido: En el local", "Comida: 5", "Servicio: 4", "Ambiente: 5",
 * "Precio por persona: 10–20 €". Both the labels and their standalone values are
 * leaf text nodes inside the card, so without filtering the author walker grabs
 * "Tipo de pedido" or "Comida" as the reviewer's name. Matched accent-folded.
 */
const REVIEW_ASPECT_LABEL_RE =
  /^(?:tipo de pedido|meal type|type de repas|art der mahlzeit|tipo di pasto|precio por persona|price per person|prix par personne|preis pro person|prezzo per persona|platos recomendados|recommended dishes|plats recommandes|empfohlene gerichte|piatti consigliati|comida|food|nourriture|essen|cibo|servicio|service|servizio|bedienung|ambiente|atmosphere|atmosfera|stimmung)\b\s*:?/;

/**
 * Only the UNAMBIGUOUS multi-word aspect labels — safe to use for stripping a
 * body candidate, because no genuine review prose starts with them (unlike the
 * single-word "Comida"/"Food", which can legitimately open a sentence).
 */
// No trailing \b: adjacent attribute nodes concatenate without a separator
// ("Tipo de pedidoEn el local"), so there is no word boundary after the label.
const REVIEW_ASPECT_STRONG_RE =
  /^(?:tipo de pedido|meal type|type de repas|art der mahlzeit|tipo di pasto|precio por persona|price per person|prix par personne|preis pro person|prezzo per persona|platos recomendados|recommended dishes|plats recommandes|empfohlene gerichte|piatti consigliati)/;

/** Standalone values of the "order type" attribute, which appear as bare nodes. */
const REVIEW_ASPECT_VALUE = new Set([
  'en el local', 'a domicilio', 'para llevar',
  'dine in', 'takeout', 'take out', 'delivery',
  'sur place', 'a emporter', 'livraison',
  'im lokal', 'lieferung', 'zum mitnehmen',
]);

/** True for a label or value from Google's review-attributes block. */
function isReviewAspect(t: string): boolean {
  const n = norm(t);
  return REVIEW_ASPECT_LABEL_RE.test(n) || REVIEW_ASPECT_VALUE.has(n);
}

/**
 * Interface chrome that is long enough to be mistaken for review prose
 * (the reaction prompt is ~39 chars, longer than many real reviews).
 */
const UI_NOISE_RE =
  /coloca el cursor|para reaccionar|hover (?:over|to react)|point to react|denunciar rese|report review|traducir al|translated by google/i;

/**
 * Business-owner replies. They live INSIDE the review card, so unless they are
 * removed first they poison every field: the reply's author ("X (propietario)"),
 * its date, and its text all compete with the reviewer's own.
 */
const OWNER_RE =
  /\((?:propietario|owner|propriétaire|inhaber|proprietario)\)|respuesta del propietario|response from the owner/i;

/**
 * Locate owner-reply subtrees within a card. Google's class names are
 * obfuscated and rotate, so we anchor structurally: from the marker leaf, climb
 * while the ancestor's text still STARTS with the marker — that ancestor is
 * still the reply. The first ancestor that starts with something else is the
 * review card itself, so we stop there.
 */
function ownerReplyBlocks(root: HTMLElement): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  for (const leaf of root.querySelectorAll<HTMLElement>('div, span, b, a')) {
    if (leaf.children.length > 0) continue;
    const marker = (leaf.textContent ?? '').trim();
    if (!marker || !OWNER_RE.test(marker)) continue;
    let block: HTMLElement = leaf;
    let parent = leaf.parentElement;
    while (parent && parent !== root && (parent.textContent ?? '').trim().startsWith(marker)) {
      block = parent;
      parent = parent.parentElement;
    }
    blocks.push(block);
  }
  return blocks;
}

/**
 * A copy of the card with everything that is not the user's own review stripped
 * out: our injected chip and any owner replies. All field extraction runs
 * against this, so no parser needs to know about either.
 */
function cleanCard(el: HTMLElement): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  // `script`/`style` are load-bearing here, not defensive: Google inlines
  // scripts inside review cards, and a wrapper div holding one is pure
  // textContent — hundreds of characters of code that beat every real review
  // as "longest text block" and got parsed as the review body.
  clone.querySelectorAll('.rs-chip, script, style, noscript, template').forEach((n) => n.remove());
  for (const block of ownerReplyBlocks(clone)) block.remove();
  return clone;
}

/** Author's total profile review count, e.g. "89 opiniones", "12 reviews". */
const AUTHOR_COUNT_RE =
  /^(\d[\d.,]*)\s*(?:reseñas?|opiniones|valoraciones|reviews?|contributions?|avis|rezensionen|beiträge|recensioni)\b/i;
/** "Local Guide" / trusted-contributor badge across locales. */
const LOCAL_GUIDE_RE = /local guide|guía local|guide local|lokaler guide|guida locale/i;

/**
 * Read author-profile trust signals from a review card: how many reviews the
 * author has overall and whether they're a Local Guide. These are among the
 * strongest indicators of purchased reviews (throwaway accounts have a single
 * review), so we extract them from short leaf nodes near the author byline.
 */
function findAuthorMeta(el: HTMLElement): { count: number | null; localGuide: boolean } {
  let count: number | null = null;
  let localGuide = false;
  for (const node of el.querySelectorAll<HTMLElement>('span, div, a')) {
    if (node.children.length > 0) continue; // leaf nodes only
    const t = (node.textContent ?? '').trim();
    if (!t || t.length > 45) continue;
    if (!localGuide && LOCAL_GUIDE_RE.test(t)) localGuide = true;
    if (count === null) {
      // Maps often renders one combined leaf — "Local Guide · 186 reseñas ·
      // 9 fotos" — so drop the badge prefix before the ^-anchored count match.
      const stripped = t.replace(
        /^(?:local guide|guía local|guide local|lokaler guide|guida locale)\s*[·•|]?\s*/i,
        '',
      );
      const m = stripped.match(AUTHOR_COUNT_RE);
      if (m) {
        const n = Number(m[1]!.replace(/[.,]/g, '')); // strip thousands separators
        if (Number.isFinite(n)) count = n;
      }
    }
  }
  return { count, localGuide };
}

/** First text node under `root` that reads like a person's name. */
function firstAuthorTextNode(root: HTMLElement): string {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  let node = walker.nextNode();
  while (node) {
    if (!node.parentElement?.closest('.rs-chip')) {
      const t = (node.textContent ?? '').trim();
      if (looksLikeAuthor(t)) return t;
    }
    node = walker.nextNode();
  }
  return '';
}

/**
 * Patterns that extract the reviewer's name from a "share this review" control's
 * aria-label, across locales. Google keeps the name here even on cards whose
 * visible name header sits OUTSIDE the detected card ("Compartir reseña de Stel
 * Abelenda-DeLa."), so this is the reliable last-resort source of the author.
 */
const SHARE_NAME_PATTERNS: RegExp[] = [
  /rese[ñn]a de\s+(.+?)\.?$/i, // es: "Compartir reseña de NAME."
  /^share\s+(.+?)['’]s\s+review/i, // en: "Share NAME's review"
  /share\s+review\s+(?:by|from)\s+(.+?)\.?$/i, // en: "Share review by NAME"
  /l['’]avis de\s+(.+?)\.?$/i, // fr: "Partager l'avis de NAME"
  /recensione di\s+(.+?)\.?$/i, // it: "Condividi la recensione di NAME"
  /von\s+(.+?)\s+teilen/i, // de: "Rezension von NAME teilen"
];

/** Read the reviewer's name from a share control's aria-label, if present. */
function authorFromShareLabel(el: HTMLElement): string {
  for (const node of el.querySelectorAll<HTMLElement>('[aria-label]')) {
    const label = node.getAttribute('aria-label') ?? '';
    if (!label) continue;
    for (const re of SHARE_NAME_PATTERNS) {
      const m = label.match(re);
      if (m?.[1]) {
        const name = m[1].trim();
        if (looksLikeAuthor(name)) return name;
      }
    }
  }
  return '';
}

function findAuthor(el: HTMLElement): string {
  // Maps uses .d4r55; contributor links are stable anchors. Read the name from
  // the element's text NODES, never its textContent: the profile link wraps
  // both the name and a count span, so textContent yields
  // "Victor Villarroya Ramírez5 reseñas".
  const explicitEl = queryFirst(el, [
    'div.d4r55',
    '.TSUbDb',
    'a[href*="/maps/contrib/"]',
    'a[href*="/contrib/"]',
  ]);
  if (explicitEl) {
    const name = firstAuthorTextNode(explicitEl);
    if (name) return name;
  }
  // The share control's aria-label is a precise, structured source — prefer it
  // over the free text-node walk. When the name header sits outside the detected
  // card, the walk otherwise grabs whatever short text comes first, e.g. a
  // truncated attribute value ("Tipo de pedido → C…").
  const shared = authorFromShareLabel(el);
  if (shared) return shared;
  // Last resort: scan the whole card for the first name-like text node.
  return firstAuthorTextNode(el);
}

/** Heuristics for "this text is a person's name", not metadata or chrome. */
function looksLikeAuthor(t: string): boolean {
  return (
    t.length >= 2 &&
    t.length <= 40 &&
    /\p{L}/u.test(t) &&
    // Platform names ("Google", "Doctoralia") come from the "Reseña de X"
    // attribution line, not from the reviewer.
    !isGenericAuthor(t) &&
    !isUiText(t) &&
    !isReviewAspect(t) && // "Tipo de pedido", "Comida: 5" — attributes, not a name
    !/(?:\.{2,}|…)$/.test(t.trim()) && // "C…" — a truncated attribute value, not a name
    !AUTHOR_COUNT_RE.test(t) && // "89 opiniones" — metadata, not a name
    !LOCAL_GUIDE_RE.test(t) && // "Local Guide" — a badge, not a name
    !ATTRIBUTION_RE.test(t) &&
    !/\d\s*\/\s*5/.test(t) &&
    !RELATIVE_DATE_RE.test(t)
  );
}

function findBody(el: HTMLElement): string {
  const explicit = textOf(
    queryFirst(el, ['span.wiI7pd', 'div.MyEned span', '[data-expandable-section]', 'span[jsname]']),
  );
  if (explicit && !UI_NOISE_RE.test(explicit)) return explicit;

  // Fallback: the longest INNERMOST text block. Containers must not compete —
  // their textContent concatenates the whole card (author, date, UI chrome,
  // owner reply), so "longest block" would always pick the outer wrapper and
  // return everything glued together.
  const candidates = [...el.querySelectorAll<HTMLElement>('span, div, p')].filter((n) => {
    const t = (n.textContent ?? '').trim();
    return (
      t.length >= 30 &&
      !ATTRIBUTION_RE.test(t) &&
      !UI_NOISE_RE.test(t) &&
      !REVIEW_ASPECT_STRONG_RE.test(norm(t)) // Google's "Tipo de pedido…" block
    );
  });
  const innermost = candidates.filter((c) => !candidates.some((o) => o !== c && c.contains(o)));
  let best = '';
  for (const node of innermost) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t.length > best.length) best = t;
  }
  return best;
}

/** Absolute dates carry a 4-digit year ("16 feb 2026"). */
const YEAR_RE = /\b(?:19|20)\d{2}\b/;

function findDate(el: HTMLElement): string {
  const explicit = textOf(queryFirst(el, ['span.rsqaWe', 'span.dehysf', '.PuaHbe']));
  if (explicit) return explicit;

  // Walk TEXT NODES, not elements. Google renders the date as a bare text node
  // inside a container that has element children ("<span>5/5</span> · Hace 7
  // meses"), so scanning element leaves misses it entirely, and reading the
  // card's whole textContent glues the date to the review body
  // ("Hace 7 mesesNos surgió…"), which no date parser can recover.
  const relative: string[] = [];
  const absolute: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (!parent?.closest('.rs-chip')) {
      const t = (node.textContent ?? '').trim();
      if (t && t.length <= 45) {
        if (RELATIVE_DATE_RE.test(t)) relative.push(t);
        else if (YEAR_RE.test(t)) absolute.push(t);
      }
    }
    node = walker.nextNode();
  }
  // Prefer relative dates (Google's default) and the shortest candidate: real
  // date nodes are short, prose that mentions a duration is long.
  const byLength = (a: string, b: string): number => a.length - b.length;
  if (relative.length) return relative.sort(byLength)[0]!;
  if (absolute.length) return absolute.sort(byLength)[0]!;
  return '';
}

export const googleAdapter: SiteAdapter = {
  id: 'google',
  name: 'Google Reviews',
  // Google Search panels and Maps are always businesses/places — a clinic, a
  // restaurant, a shop — never something you "buy from a seller".
  subject: 'place',

  matches(location: Location): boolean {
    return /(^|\.)google\./.test(location.hostname);
  },

  isReviewPage(): boolean {
    return (
      location.pathname.startsWith('/maps') ||
      location.pathname.startsWith('/search') ||
      detectReviewCards().length > 0
    );
  },

  findReviewElements(): HTMLElement[] {
    return detectReviewCards();
  },

  parseReview(el: HTMLElement): ParsedReview | null {
    // Everything is read from a card stripped of owner replies and our own
    // chip, so no field can pick up the business's answer instead of the user's
    // review (its author, its date and its text all sit inside the same card).
    const card = cleanCard(el);

    // Maps wraps each review in a container carrying its stable review id, with
    // the author header (name, Local Guide badge, profile review count) as a
    // SIBLING of the content block the detector selects. Climb to that
    // container for identity and author-profile data; body/date/rating still
    // come from the inner card only, so header text can never leak into them.
    const rootEl = el.closest<HTMLElement>('[data-review-id]');
    const root = rootEl && rootEl !== el ? cleanCard(rootEl) : card;

    const author = findAuthor(card) || (root !== card ? findAuthor(root) : '');
    const text = findBody(card);
    if (!text && !author) return null;

    const rating = extractRating(card);
    const dateRaw = findDate(card);
    const dateISO = dateRaw ? parseReviewDate(dateRaw) : null;

    // Google stamps a date on every genuine user review, so a rated card
    // without one is not a review at all: it's a topic highlight (a quoted
    // excerpt with stars), a "Note: your reviews won't affect rankings…"
    // notice, or similar chrome. Those inflate the review count and skew the
    // Trust Index, so they must never enter the analysis.
    if (!dateISO) return null;

    // A card whose "author" is just the start of its own body has no real
    // author element — another tell of a highlight snippet rather than a review.
    if (author && text.startsWith(author) && author.length > 15) return null;

    const reviewId = el.getAttribute('data-review-id') ?? rootEl?.getAttribute('data-review-id');
    const id = reviewId ? `gg-${reviewId}` : `gg-${hashString(author + text.slice(0, 120))}`;
    const meta = findAuthorMeta(root);

    return {
      id,
      author: author || 'A Google User',
      rating,
      title: '',
      text,
      dateISO,
      verified: false,
      helpfulVotes: 0,
      authorReviewCount: meta.count,
      authorIsLocalGuide: meta.localGuide,
    };
  },
};
