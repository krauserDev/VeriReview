/**
 * Content script entry point — MANUAL MODE.
 *
 * By default this script is completely idle: it mounts no UI, starts no
 * observers, runs no timers and never touches the page DOM until the user
 * explicitly asks for an analysis — via the popup's "Analyze" button, the
 * right-click context menu, or the keyboard shortcut. Each of those routes
 * sends a START_ANALYSIS message that lazily boots a single analysis session.
 * Closing the panel tears everything down and restores the page exactly as it
 * was. The session lives only for the current page load — a refresh clears it.
 *
 * The sole exception is the opt-in `autoScan` setting (OFF by default), which
 * starts a session automatically on supported pages.
 */
import type {
  PageAnalysis,
  ParsedReview,
  RuntimeMessage,
  RuntimeResponse,
  Settings,
} from '../types/index.js';
import { analyzePage } from '../analysis/engine.js';
import { isMoreReviewsLabel, isNavigatingControl } from '../utils/index.js';
import { getSettings } from '../services/settings-service.js';
import { findAdapter } from '../sites/index.js';
import type { SiteAdapter } from '../sites/adapter.js';
import { applyHighlights, clearHighlights } from './highlighter.js';
import { initTooltip, destroyTooltip } from './tooltip.js';
import { Panel } from './panel.js';

const MAX_REVIEWS: Record<Settings['analysisDepth'], number> = {
  quick: 50,
  standard: 150,
  deep: 400,
};

/** How many times a fresh analysis retries for late-rendering reviews. */
const RETRY_LIMIT = 8;
const RETRY_INTERVAL_MS = 500;

/* -------------------------------------------------------------------------- */
/* Session state — everything here is null/false until the user opts in.       */
/* -------------------------------------------------------------------------- */

let adapter: SiteAdapter | null = null;
let panel: Panel | null = null;
let settings: Settings | null = null;
let active = false;
let lastSignature = '';
let retryTimer: ReturnType<typeof setTimeout> | undefined;

// Pin ids to DOM elements so re-scans of an unchanged review keep the same id
// even when the host page re-renders it with trivial text/whitespace changes.
const stableIds = new WeakMap<HTMLElement, string>();

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

function collectReviews(): Array<{ el: HTMLElement; review: ParsedReview }> {
  if (!adapter || !settings) return [];
  const out: Array<{ el: HTMLElement; review: ParsedReview }> = [];
  const seen = new Set<string>();
  const limit = MAX_REVIEWS[settings.analysisDepth];
  for (const el of adapter.findReviewElements()) {
    if (out.length >= limit) break;
    try {
      const review = adapter.parseReview(el);
      if (!review) continue;
      let id = stableIds.get(el);
      if (id === undefined) {
        id = review.id;
        stableIds.set(el, id);
      }
      const stable = id === review.id ? review : { ...review, id };
      if (!seen.has(stable.id)) {
        seen.add(stable.id);
        out.push({ el, review: stable });
      }
    } catch {
      // Host markup changed for this element — skip it, never break the page.
    }
  }
  return out;
}

/** Run one analysis pass over the currently visible reviews. */
function scan(): boolean {
  if (!adapter || !panel || !settings) return false;
  const pairs = collectReviews();
  if (pairs.length === 0) return false;

  const signature = pairs.map((p) => p.review.id).join('|');
  if (signature === lastSignature) return true; // unchanged — keep current UI
  lastSignature = signature;

  // Merge with reviews carried from other pages of the same product, so a
  // paginated listing builds one cumulative report instead of N reports of 10.
  // Site review ids are stable, so re-analyzing a page can never double-count.
  const unique = new Map<string, ParsedReview>();
  for (const r of [...carried, ...pairs.map((p) => p.review)]) unique.set(r.id, r);
  const allReviews = [...unique.values()];
  persistCarried(allReviews);

  const analysis: PageAnalysis = analyzePage(
    allReviews,
    { url: location.href, site: adapter.name, pageTitle: document.title, subject: adapter.subject },
    settings,
  );

  if (settings.highlightReviews) {
    const byId = new Map(pairs.map((p) => [p.review.id, p.el]));
    applyHighlights(
      analysis.reviews
        .map((r) => ({ el: byId.get(r.review.id), analysis: r }))
        .filter(
          (e): e is { el: HTMLElement; analysis: (typeof analysis.reviews)[number] } => !!e.el,
        ),
    );
  }

  panel.setMoreReviews(findMoreReviewsTarget());
  panel.setAnalysis(analysis);
  void chrome.runtime
    .sendMessage({ type: 'SCAN_COMPLETE', analysis } satisfies RuntimeMessage)
    .catch(() => undefined);
  return true;
}

/**
 * Scan now, retrying briefly for reviews that render a moment late. This is a
 * finite sequence that always terminates — never a standing loop, so there is
 * no background CPU use once the reviews are found (or given up on).
 */
function refresh(): void {
  clearTimeout(retryTimer);
  let attempts = 0;
  const tick = (): void => {
    if (!active || !panel) return;
    attempts += 1;
    const found = scan();
    if (found) return;
    if (attempts >= RETRY_LIMIT) {
      panel.setMessage(
        'No reviews found on this page yet. Scroll to the reviews (or open the “Reviews” section) and press Rescan.',
      );
      return;
    }
    retryTimer = setTimeout(tick, RETRY_INTERVAL_MS);
  };
  tick();
}

/* -------------------------------------------------------------------------- */
/* Session lifecycle                                                           */
/* -------------------------------------------------------------------------- */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** How many load-more rounds a manual analysis drives, and the wait between. */
const EXPAND_ROUNDS = 10;
const EXPAND_WAIT_MS = 800;

/** Hand-off flag so an explicitly requested "analyze all" survives navigation. */
const AUTOSTART_KEY = 'autostart:pending';
const AUTOSTART_TTL_MS = 60_000;

/** Amazon's link to the site's full review listing (it paginates by navigating). */
const FULL_LISTING_RE = /\/(?:portal\/customer-reviews|product-reviews)\//;

/** How long reviews carried from previous pages of the same product stay valid. */
const CARRY_TTL_MS = 30 * 60_000;
const CARRY_MAX = 400;

/**
 * Where the rest of this product's reviews live, if anywhere.
 *
 * Amazon keeps only a handful of reviews on the product page and puts the rest
 * on a separate listing, so we offer that listing as a one-click destination.
 * The listing itself needs no such offer: its "Mostrar 10 opiniones más" loads
 * the next batch in place, which `expandAllReviews` already drives.
 *
 * We deliberately never walk pagination automatically. Driving page loads on a
 * user's behalf would make the extension an automated crawler on Amazon — the
 * very behaviour that got Fakespot removed after Amazon complained. One
 * user-initiated hop to the listing is a link, not a crawl.
 */
function findMoreReviewsTarget(): { url: string; note: string; cta: string } | null {
  if (adapter?.id !== 'amazon') return null;

  if (!FULL_LISTING_RE.test(location.pathname)) {
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (FULL_LISTING_RE.test(a.getAttribute('href') ?? '')) {
        return {
          url: a.href,
          note: `Amazon keeps most reviews on a separate page.`,
          cta: 'Open full reviews & analyze →',
        };
      }
    }
    return null;
  }

  return null; // already on the listing — everything is reachable in place
}

/** Storage key for reviews carried across pages of one product. */
function productKey(): string | null {
  const m = location.pathname.match(
    /\/(?:portal\/customer-reviews|product-reviews)\/([A-Z0-9]{8,})/i,
  );
  return m ? `carry:${m[1]}` : null;
}

/** Reviews gathered from previously analyzed pages of this same product. */
let carried: ParsedReview[] = [];

async function loadCarried(): Promise<void> {
  const key = productKey();
  if (!key) {
    carried = [];
    return;
  }
  try {
    const data = await chrome.storage.local.get(key);
    const entry = data[key] as { at: number; reviews: ParsedReview[] } | undefined;
    carried = entry && Date.now() - entry.at < CARRY_TTL_MS ? entry.reviews : [];
  } catch {
    carried = [];
  }
}

function persistCarried(all: ParsedReview[]): void {
  const key = productKey();
  if (!key) return;
  void chrome.storage.local
    .set({ [key]: { at: Date.now(), reviews: all.slice(0, CARRY_MAX) } })
    .catch(() => undefined);
}

/** Remember an explicit "analyze all" request, then navigate to the listing. */
function analyzeAll(url: string): void {
  const prefix = new URL(url, location.href).pathname.split('/').slice(0, 4).join('/');
  void chrome.storage.local
    .set({ [AUTOSTART_KEY]: { at: Date.now(), prefix } })
    .catch(() => undefined)
    .then(() => location.assign(url));
}

/**
 * Was this page load the result of the user asking to analyze the full listing?
 * Scoped tightly — short TTL, single use, and the destination path must match —
 * so it can never silently auto-analyze some unrelated tab.
 */
async function consumeAutostart(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(AUTOSTART_KEY);
    const pending = data[AUTOSTART_KEY] as { at: number; prefix: string } | undefined;
    if (!pending) return false;
    await chrome.storage.local.remove(AUTOSTART_KEY);
    return (
      Date.now() - pending.at < AUTOSTART_TTL_MS && location.pathname.startsWith(pending.prefix)
    );
  } catch {
    return false;
  }
}

/**
 * The page's own in-place "load more reviews" control, when it has one.
 *
 * Amazon: "Mostrar 10 opiniones más" loads the next batch in place (stable
 * data-hook fast path; its anchor href is neutralised by clickWithoutNavigating,
 * so no URL guard is applied — an earlier one wrongly rejected the button).
 *
 * Google: Search's reviews view has a real in-place "Más reseñas de usuarios"
 * button that must be clicked, but Google also navigates SPA-style from plain
 * buttons — per-reviewer controls carry a `data-href` to the contributor
 * profile or a `reviewerLink` jsaction, and preventDefault cannot stop Google's
 * own router. So on Google, navigation-intent controls are screened out
 * (isNavigatingControl) and only true in-place expanders are ever clicked.
 */
function findMoreButton(): HTMLElement | null {
  // Fast path: Amazon marks the control with a stable data-hook, which doesn't
  // depend on the page language and skips scanning the whole DOM.
  const hook = document.querySelector<HTMLElement>('[data-hook="show-more-button"]');
  if (hook) return hook;

  const guarded = adapter?.id !== 'amazon';
  for (const selector of ['button, [role="button"]', 'a, div[jsaction], span[jsaction]']) {
    for (const b of document.querySelectorAll<HTMLElement>(selector)) {
      if (b.closest('[data-verireview], .rs-fab, .rs-tooltip')) continue;
      if (guarded && isNavigatingControl(b)) continue;
      if (isMoreReviewsLabel(b.textContent ?? '')) return b;
    }
  }
  return null;
}

/**
 * Click a control while making it impossible for the page to navigate away.
 *
 * Amazon's "Mostrar 10 opiniones más" is an
 * `<a data-hook="show-more-button" href="…/ref=cm_cr_arp_d_paging_btm_2">`, and
 * that href is a no-JS degradation fallback, not a page: the `ref=` segment is a
 * tracking marker with no pageNumber, so it re-serves the page you are already
 * on. The real behaviour lives in a click handler that fetches the next batch.
 *
 * So we click it and cancel only the *default action*. The listener runs in the
 * bubble phase at document level, i.e. after the site's own handler has already
 * done its work, so cancelling can never suppress the fetch — it only stops the
 * fallback navigation. If a control turns out to have no handler at all, the
 * click is simply inert, which is exactly what we want.
 */
function clickWithoutNavigating(el: HTMLElement): void {
  const cancelNavigation = (e: Event) => e.preventDefault();
  document.addEventListener('click', cancelNavigation);
  try {
    el.click(); // dispatched synchronously, so the guard is scoped to this click
  } finally {
    document.removeEventListener('click', cancelNavigation);
  }
}

/** The scrollable element that actually holds the reviews, if any. */
function reviewScrollContainer(): HTMLElement | null {
  const first = adapter?.findReviewElements()[0];
  let el: HTMLElement | null = first?.parentElement ?? null;
  while (el && el !== document.body && el !== document.documentElement) {
    const { overflowY } = getComputedStyle(el);
    if (/(auto|scroll)/.test(overflowY) && el.scrollHeight > el.clientHeight + 40) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Reveal as many reviews as the page is willing to render, so a manual analysis
 * covers the whole set instead of just the first batch.
 *
 * Sites expose two mechanisms and both are driven: an in-place load-more button
 * when one exists (Amazon's "Mostrar 10 opiniones más", Google Search's "Más
 * reseñas de usuarios") and scrolling the reviews container otherwise (Google
 * Maps lazy-loads on scroll and has no global button — its per-reviewer "more
 * reviews" controls navigate away and are screened out by isNavigatingControl).
 * Either way we then check whether the review count actually grew — the only
 * reliable signal that more arrived.
 *
 * Strictly bounded (finite rounds, early exit once the count stops growing), and
 * the user's scroll position is restored afterwards: a pre-scan step, never a
 * standing watcher.
 */
async function expandAllReviews(): Promise<void> {
  if (!adapter) return;
  const initialContainer = reviewScrollContainer();
  const savedScroll = initialContainer ? initialContainer.scrollTop : window.scrollY;
  const isAmazon = adapter.id === 'amazon';

  // A load-more control on Google is a one-shot expander / accordion toggle:
  // Search's "Más reseñas de usuarios ⌄" opens the full list, but clicking it
  // AGAIN re-collapses it — hammering it every round left the page stranded at 3
  // reviews. So each distinct button is clicked at most once and we then fall
  // back to scrolling. Amazon's paginating "Mostrar 10 opiniones más" is the
  // opposite — it must be clicked every round to keep loading — so it is exempt.
  const clicked = new WeakSet<HTMLElement>();
  let count = adapter.findReviewElements().length;
  let stagnantRounds = 0;

  for (let i = 0; i < EXPAND_ROUNDS && active; i++) {
    // Re-evaluate each round: opening an expander can swap the scroll container
    // (e.g. Search's inline list → a reviews overlay) for the rest of the loop.
    const container = reviewScrollContainer();
    const btn = findMoreButton();
    if (btn && (isAmazon || !clicked.has(btn))) {
      clicked.add(btn);
      clickWithoutNavigating(btn);
    } else if (container) {
      container.scrollTop = container.scrollHeight;
    } else {
      window.scrollTo(0, document.body.scrollHeight);
    }

    await sleep(EXPAND_WAIT_MS);

    const grown = adapter.findReviewElements().length;
    if (grown > count) {
      count = grown;
      stagnantRounds = 0;
    } else if (++stagnantRounds >= 2) {
      break; // two quiet rounds: the page has nothing left to give
    }
  }

  // Put the page back where the user left it.
  if (initialContainer) initialContainer.scrollTop = savedScroll;
  else window.scrollTo(0, savedScroll);
}

/**
 * Begin (or refresh) an analysis session. Idempotent: the first call mounts the
 * panel and tooltip; later calls just re-scan and re-open the panel.
 */
async function startAnalysis(): Promise<void> {
  settings ??= await getSettings();
  adapter ??= findAdapter(location);

  if (!adapter || !settings.enabledSites[adapter.id]) {
    return; // Unsupported/disabled — the popup surfaces this to the user.
  }

  if (!active) {
    active = true;
    panel = new Panel(settings, {
      onRescan: () => {
        lastSignature = '';
        panel?.setScanning();
        refresh();
      },
      onClose: () => teardown(),
      onAnalyzeAll: (url) => analyzeAll(url),
    });
    initTooltip();
  }
  panel!.open();
  panel!.setScanning();
  // Pick up reviews from other pages of this product analyzed earlier, then
  // reveal whatever this page is holding behind a lazy-load control.
  await loadCarried();
  await expandAllReviews();
  lastSignature = ''; // the expanded set supersedes any earlier scan
  refresh();
}

/** Remove every injected element, disconnect everything, restore the page. */
function teardown(): void {
  clearTimeout(retryTimer);
  panel?.destroy();
  panel = null;
  destroyTooltip();
  clearHighlights();
  active = false;
  lastSignature = '';
  // Closing the panel ends the session: forget the reviews carried across this
  // product's pages so the next analysis starts clean.
  carried = [];
  const key = productKey();
  if (key) void chrome.storage.local.remove(key).catch(() => undefined);
  void chrome.runtime
    .sendMessage({ type: 'CLEAR_BADGE' } satisfies RuntimeMessage)
    .catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* Wiring — the only things attached at page load                              */
/* -------------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener(
  (msg: RuntimeMessage, _sender, sendResponse: (r: RuntimeResponse) => void) => {
    switch (msg.type) {
      case 'START_ANALYSIS':
      case 'REQUEST_RESCAN':
        if (msg.type === 'REQUEST_RESCAN') lastSignature = '';
        void startAnalysis().then(() => sendResponse({ ok: true, active }));
        return true; // async response
      case 'STOP_ANALYSIS':
        teardown();
        sendResponse({ ok: true, active: false });
        return false;
      case 'PING':
        sendResponse({ ok: true, active });
        return false;
      default:
        return undefined;
    }
  },
);

// The only work done at page load. Two ways an analysis may start without a
// fresh click: the user asked to analyze the full listing and we just landed on
// it, or they opted into automatic mode (OFF by default).
void (async () => {
  settings = await getSettings();
  if (!findAdapter(location)) return;
  if (await consumeAutostart()) {
    void startAnalysis();
    return;
  }
  if (settings.autoScan) void startAnalysis();
})();
