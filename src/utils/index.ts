/** Generic utilities shared by every layer of the extension. */

/** Debounce a function; trailing edge only. */
export function debounce<T extends (...args: never[]) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>): void => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Fast non-cryptographic string hash (FNV-1a), used for stable review ids. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Clamp a number into [min, max]. */
export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

/** Lowercase, strip punctuation/diacritics and collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split normalized text into word tokens. */
export const tokenize = (text: string): string[] =>
  normalizeText(text).split(' ').filter(Boolean);

/** Jaccard similarity between two shingle sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Build word bigram shingles for near-duplicate detection. */
export function shingles(tokens: string[], size = 2): Set<string> {
  const out = new Set<string>();
  if (tokens.length < size) {
    if (tokens.length > 0) out.add(tokens.join(' '));
    return out;
  }
  for (let i = 0; i <= tokens.length - size; i++) {
    out.add(tokens.slice(i, i + size).join(' '));
  }
  return out;
}

/** Lowercase and strip diacritics — date words are matched accent-free. */
const fold = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Month names (accent-stripped) for en/es/fr/de/it. */
const MONTHS: Record<string, number> = {
  // en
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  // es
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6,
  agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  // fr
  janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6,
  aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11,
  // de
  januar: 0, februar: 1, marz: 2, juni: 5, juli: 6, oktober: 9, dezember: 11,
  // it
  gennaio: 0, febbraio: 1, aprile: 3, maggio: 4, giugno: 5, luglio: 6,
  settembre: 8, ottobre: 9, dicembre: 11,
};

type RelUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/** Relative-time unit words (accent-stripped, singular) for en/es/fr/de/it. */
const UNIT_ALIASES: Record<string, RelUnit> = {
  minute: 'minute', minuto: 'minute', min: 'minute',
  hour: 'hour', hora: 'hour', heure: 'hour', stunde: 'hour', ora: 'hour', ore: 'hour',
  day: 'day', dia: 'day', jour: 'day', tag: 'day', tage: 'day', giorno: 'day', giorni: 'day',
  week: 'week', semana: 'week', semaine: 'week', woche: 'week', settimana: 'week', settimane: 'week',
  month: 'month', mes: 'month', mois: 'month', monat: 'month', monate: 'month', mese: 'month', mesi: 'month',
  year: 'year', ano: 'year', an: 'year', annee: 'year', jahr: 'year', jahre: 'year', anno: 'year', anni: 'year',
};

/** Resolve a (possibly plural/declined) unit word to its canonical unit. */
function unitOf(token: string): RelUnit | null {
  const t = fold(token);
  if (UNIT_ALIASES[t]) return UNIT_ALIASES[t];
  for (const suffix of ['s', 'es', 'n']) {
    if (t.endsWith(suffix)) {
      const base = t.slice(0, -suffix.length);
      if (UNIT_ALIASES[base]) return UNIT_ALIASES[base];
    }
  }
  return null;
}

/** Markers that indicate a relative date in any supported language. */
const RELATIVE_MARKER_RE = /\bhace\b|\bago\b|il y a|\bvor\b|\bfa\b/;

const ONE_WORDS = new Set(['a', 'an', 'un', 'una', 'uno', 'une', 'ein', 'einer', 'einem']);

/**
 * Parse review dates across the supported locales. Handles relative forms
 * ("3 weeks ago", "Hace 5 meses", "vor 3 Monaten", "3 mesi fa", "il y a 2 mois")
 * and absolute forms ("January 5, 2026", "5 January 2026", "1 de julio de 2026",
 * "1. Juli 2026"). Returns an ISO string or null.
 */
export function parseReviewDate(raw: string, now = new Date()): string | null {
  const text = fold(raw.trim());

  /* ---- Relative ("hace 5 meses", "3 weeks ago") ---- */
  if (RELATIVE_MARKER_RE.test(text)) {
    // Slide over overlapping word pairs: a global regex would consume
    // "hace un" as one pair and never see "un mes".
    const words = text.split(/[^a-z0-9]+/).filter(Boolean);
    for (let i = 0; i < words.length - 1; i++) {
      const qty = words[i]!;
      const unit = unitOf(words[i + 1]!);
      if (!unit) continue;
      const n = ONE_WORDS.has(qty) ? 1 : Number(qty);
      if (!Number.isFinite(n) || n <= 0 || n > 500) continue;
      const d = new Date(now);
      const ms: Partial<Record<RelUnit, number>> = {
        minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000,
      };
      if (unit in ms) d.setTime(d.getTime() - n * (ms[unit] ?? 0));
      else if (unit === 'month') d.setMonth(d.getMonth() - n);
      else d.setFullYear(d.getFullYear() - n);
      return d.toISOString();
    }
  }

  /* ---- Absolute ---- */
  const candidates: Array<{ month: string; day: string; year: string }> = [];
  // "January 5, 2026"
  for (const m of text.matchAll(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/g)) {
    candidates.push({ month: m[1]!, day: m[2]!, year: m[3]! });
  }
  // "5 January 2026", "1 de julio de 2026", "1. Juli 2026"
  for (const m of text.matchAll(/(\d{1,2})\.?\s*(?:de\s+)?([a-z]+)\s+(?:de\s+|del\s+)?(\d{4})/g)) {
    candidates.push({ month: m[2]!, day: m[1]!, year: m[3]! });
  }
  for (const c of candidates) {
    const month = MONTHS[c.month];
    const day = Number(c.day);
    const year = Number(c.year);
    if (month !== undefined && day >= 1 && day <= 31 && year > 1990) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  const native = Date.parse(raw);
  return Number.isNaN(native) ? null : new Date(native).toISOString();
}

/** Format a timestamp as a short local date-time. */
export function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Platform/site names that show up in attribution lines ("Reseña de Google",
 * "Opinión de Doctoralia") and must never be mistaken for a reviewer's name.
 */
const PLATFORM_NAMES = new Set([
  'google', 'amazon', 'doctoralia', 'facebook', 'instagram', 'tripadvisor',
  'trustpilot', 'yelp', 'booking', 'booking.com', 'thefork', 'el tenedor',
  'foursquare', 'opentable',
]);

/**
 * Localised default/anonymous reviewer labels. Amazon anonymises many reviewers
 * as "Cliente Amazon" / "Amazon Customer" and Google as "A Google User" /
 * "Usuario de Google"; these are the same placeholder in different languages,
 * NOT a person. Treating them as one shared identity would falsely flag dozens
 * of unrelated reviewers as a single repeat author. Compared accent-folded.
 */
const GENERIC_AUTHOR_NAMES = new Set([
  // Amazon "Amazon Customer" ("Amazon-Kunde" folds to "amazon kunde")
  'amazon customer', 'cliente amazon', 'cliente de amazon', 'client amazon',
  "client d'amazon", 'amazon kunde', 'cliente amazon.es',
  'utente amazon', 'cliente da amazon',
  // Google "A Google User"
  'a google user', 'usuario de google', 'utilisateur google', 'google nutzer',
  'utente google', 'usuario do google',
  // Generic anonymous
  'anonymous', 'anonimo', 'anonyme', 'anonym', 'usuario anonimo',
]);

/**
 * True for author names that don't identify a real person: empty, localised
 * site defaults ("Cliente Amazon", "A Google User"), or platform names picked
 * up from attribution lines. Used to skip same-author grouping and fraud
 * signals that assume a personal account.
 */
export function isGenericAuthor(name: string): boolean {
  const n = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents ("Anónimo" → "anonimo")
    .replace(/-/g, ' ') // normalise "Amazon-Kunde" → "amazon kunde"
    .replace(/\s+/g, ' ');
  return !n || GENERIC_AUTHOR_NAMES.has(n) || PLATFORM_NAMES.has(n);
}

/* ---------------- "Load more reviews" control detection ---------------- */

/** "more / show / load", across the supported locales. */
const MORE_WORD_RE =
  /\b(?:m[aá]s|more|mehr|weitere|plus|altre|altri|mostrar|mostra|show|load|ver|see|afficher|anzeigen)\b/i;
/** "reviews", across the supported locales. */
const REVIEWS_WORD_RE =
  /\b(?:rese[ñn]as?|opini[oó]n(?:es)?|reviews?|rezensionen?|bewertungen?|avis|recensioni?|valoraciones?)\b/i;
/**
 * Sort/filter labels that contain BOTH words yet must never be clicked —
 * "Reseñas más importantes" is Amazon's sort dropdown, not a load-more button.
 */
const SORT_LABEL_RE =
  /m[aá]s (?:importantes?|recientes?|[uú]tiles?|relevantes?|nuevas?|antiguas?)|most (?:recent|helpful|relevant)|top reviews|meilleur|migliori|relevanteste/i;

/**
 * True when a control's label means "load more reviews".
 *
 * Word order must not matter: Spanish puts "más" before the noun ("Ver más
 * opiniones") *and* after it ("Mostrar 10 opiniones más"), and an earlier
 * fixed-phrase pattern silently missed the latter — leaving most reviews
 * unanalyzed. So we require a "more" word AND a "reviews" word anywhere, minus
 * the sort-label traps.
 */
export function isMoreReviewsLabel(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return false;
  return MORE_WORD_RE.test(t) && REVIEWS_WORD_RE.test(t) && !SORT_LABEL_RE.test(t);
}

/**
 * True when activating this control would take the user somewhere else instead
 * of expanding content in place. Google navigates SPA-style from plain
 * divs/buttons: real anchors, `data-href` carriers (its jsaction router reads
 * them — reviewer-profile buttons carry `data-href="…/maps/contrib/…"`), and
 * `reviewerLink`/contrib jsactions all leave the review list, and
 * `preventDefault` cannot stop Google's own router. In-place expanders like
 * Search's "Más reseñas de usuarios" carry none of these markers.
 */
export function isNavigatingControl(el: HTMLElement): boolean {
  const link = el.closest<HTMLElement>('a[href], [data-href]');
  if (link) {
    const href = link.getAttribute('href') ?? link.getAttribute('data-href') ?? '';
    if (href && href !== '#') return true;
  }
  const jsaction = el.closest('[jsaction]')?.getAttribute('jsaction') ?? '';
  return /reviewerlink|contrib/i.test(jsaction);
}

/**
 * The 1–5 star bucket a review's rating falls into (rounding half-stars), or
 * null when the review has no rating. Shared by the rating-distribution chart
 * and the "filter by star" control so a bar and its filter always agree.
 */
export function reviewStar(rating: number | null): 1 | 2 | 3 | 4 | 5 | null {
  if (rating === null || !Number.isFinite(rating)) return null;
  const n = Math.min(5, Math.max(1, Math.round(rating)));
  return n as 1 | 2 | 3 | 4 | 5;
}

/** Escape a string for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
