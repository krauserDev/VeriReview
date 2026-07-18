/**
 * Floating dashboard panel, rendered inside a Shadow DOM so host-page CSS can
 * never leak in or out. Sections: overview gauge, stats, rating distribution,
 * trust donut, timeline, suspicious patterns, recommendations, filterable
 * review list, export & refresh actions.
 */
import type { PageAnalysis, ReviewAnalysis, Settings } from '../types/index.js';
import { escapeHtml, formatWhen, isGenericAuthor, reviewStar } from '../utils/index.js';
import { LEVEL_LABEL } from '../analysis/engine.js';
import {
  animateGauges,
  gaugeSvg,
  scoreColor,
  timelineSvg,
  trustDonutSvg,
  VERDICT,
} from '../ui/charts.js';
import { exportCsv, exportJson, exportPdf } from '../services/export-service.js';
import { PANEL_CSS } from './panel-styles.js';
import { scrollToReview } from './highlighter.js';

/**
 * Tabs are TRUE filters (they narrow the set). Ordering lives in the separate
 * Sort dropdown — mixing sorts into the tab row made every "sort tab" show the
 * full count and look broken. The three trust bands are exhaustive
 * (≥70 / 55–69 / <55): every review belongs to exactly one.
 */
type Filter =
  | 'all' | 'high-trust' | 'medium-trust' | 'low-trust' | 'verified'
  | 'suspicious' | 'ai-like' | 'repeated' | 'multi-author';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'high-trust', label: 'High trust' },
  { id: 'medium-trust', label: 'Medium trust' },
  { id: 'low-trust', label: 'Low trust' },
  { id: 'verified', label: 'Verified' },
  { id: 'suspicious', label: 'Suspicious' },
  { id: 'ai-like', label: 'AI-like' },
  { id: 'repeated', label: 'Repeated text' },
  { id: 'multi-author', label: 'Repeat authors' },
];

type Sort = 'page' | 'score-desc' | 'score-asc' | 'newest' | 'oldest' | 'detailed' | 'helpful';

export interface PanelCallbacks {
  /** Re-run the analysis over the reviews currently in the DOM. */
  onRescan: () => void;
  /** Fully close the session: caller tears down all injected UI. */
  onClose: () => void;
  /** Navigate to the site's full review listing and analyze it there. */
  onAnalyzeAll?: (url: string) => void;
}

export class Panel {
  private host: HTMLElement;
  private root: ShadowRoot;
  private panelEl: HTMLElement;
  private fab: HTMLButtonElement;
  private analysis: PageAnalysis | null = null;
  private filter: Filter = 'all';
  /** When set, the review list is narrowed to one reviewer's reviews. */
  private authorFilter: string | null = null;
  /** When set, the review list is narrowed to a score range (inclusive). */
  private scoreBand: { lo: number; hi: number } | null = null;
  /** When set, the review list is narrowed to one customer star rating (1–5). */
  private starFilter: number | null = null;
  private sort: Sort = 'page';
  /** Set when the site keeps more reviews on another page (Amazon paginates). */
  private moreReviews: { url: string; note: string; cta: string } | null = null;
  private isOpen = false;
  private readonly onKeydown: (e: KeyboardEvent) => void;

  constructor(
    private settings: Settings,
    private callbacks: PanelCallbacks,
  ) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-reviewshield', 'panel');
    this.root = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    this.root.appendChild(style);

    this.panelEl = document.createElement('aside');
    this.panelEl.className = 'rs-panel';
    this.panelEl.setAttribute('role', 'complementary');
    this.panelEl.setAttribute('aria-label', 'ReviewShield analysis panel');
    this.root.appendChild(this.panelEl);
    this.applyTheme();

    // The floating button minimizes/restores the panel (a lightweight collapse),
    // distinct from the header ✕ which closes the whole session.
    this.fab = document.createElement('button');
    this.fab.className = 'rs-fab';
    this.fab.type = 'button';
    this.fab.setAttribute('aria-label', 'Minimize or restore ReviewShield panel');
    this.fab.addEventListener('click', () => this.toggle());
    document.documentElement.appendChild(this.host);
    document.documentElement.appendChild(this.fab);
    this.renderFab(null);
    this.renderScanning();

    this.onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && this.isOpen) this.toggle(false);
    };
    document.addEventListener('keydown', this.onKeydown);
  }

  /** Show the panel (used when a session starts or is re-triggered). */
  open(): void {
    this.toggle(true);
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.applyTheme();
  }

  private applyTheme(): void {
    const dark =
      this.settings.theme === 'dark' ||
      (this.settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    this.panelEl.classList.toggle('rs-panel--dark', dark);
  }

  toggle(force?: boolean): void {
    this.isOpen = force ?? !this.isOpen;
    this.panelEl.classList.toggle('rs-panel--open', this.isOpen);
    this.fab.setAttribute('aria-expanded', String(this.isOpen));
    if (this.isOpen && this.analysis) animateGauges(this.root);
  }

  setScanning(): void {
    this.renderScanning();
  }

  setMessage(message: string): void {
    this.renderMessage(message);
  }

  setAnalysis(analysis: PageAnalysis): void {
    this.analysis = analysis;
    this.authorFilter = null; // don't carry a stale reviewer filter across scans
    this.scoreBand = null;
    this.starFilter = null;
    this.sort = 'page';
    this.renderFab(analysis);
    this.render();
  }

  /**
   * Tell the panel the site keeps the rest of its reviews on another page.
   * Call before setAnalysis so the next render includes the offer.
   */
  setMoreReviews(target: { url: string; note: string; cta: string } | null): void {
    this.moreReviews = target;
  }

  /** Count how many reviews each (real) author posted on this page. */
  private authorCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const r of this.analysis?.reviews ?? []) {
      const a = r.review.author.trim();
      // Generic/platform fallbacks are not one person — never group them.
      if (a && !isGenericAuthor(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return counts;
  }

  /* ------------------------------------------------------------------ */

  private renderFab(analysis: PageAnalysis | null): void {
    this.fab.replaceChildren();
    const score = document.createElement('span');
    score.className = 'rs-fab__score';
    score.textContent = analysis ? String(analysis.trustIndex) : '…';
    const label = document.createElement('span');
    label.textContent = 'ReviewShield';
    this.fab.append(score, label);
    this.fab.classList.remove('rs-fab--good', 'rs-fab--warn', 'rs-fab--bad');
    if (analysis) {
      const cls =
        analysis.trustIndex >= 70 ? 'rs-fab--good' : analysis.trustIndex >= 40 ? 'rs-fab--warn' : 'rs-fab--bad';
      this.fab.classList.add(cls);
    }
  }

  private renderScanning(): void {
    this.panelEl.innerHTML = `
      ${this.headHtml('Scanning…')}
      <div class="rs-body">
        <div class="rs-scanning"><span class="rs-spinner" aria-hidden="true"></span> Analyzing visible reviews…</div>
      </div>`;
    this.bindHead();
  }

  private renderMessage(message: string): void {
    this.panelEl.innerHTML = `
      ${this.headHtml('ReviewShield')}
      <div class="rs-body">
        <div class="rs-scanning" style="align-items:flex-start">${escapeHtml(message)}</div>
        <div style="padding:0 16px 16px">
          <button class="rs-btn rs-btn--primary" data-action="rescan" type="button">↻ Rescan this page</button>
        </div>
      </div>`;
    this.bindHead();
    this.panelEl
      .querySelector('[data-action="rescan"]')
      ?.addEventListener('click', () => {
        this.setScanning();
        this.callbacks.onRescan();
      });
  }

  private headHtml(site: string): string {
    const icon = chrome.runtime.getURL('icons/icon128.png');
    return `
      <header class="rs-head">
        <img class="rs-head__logo" src="${icon}" alt="" />
        <div>
          <div class="rs-head__name">ReviewShield</div>
          <div class="rs-head__site">${escapeHtml(site)}</div>
        </div>
        <span class="rs-head__spacer"></span>
        <button class="rs-iconbtn" data-action="close" type="button" aria-label="Close and remove ReviewShield from this page" title="Close &amp; remove from page">✕</button>
      </header>`;
  }

  private bindHead(): void {
    this.panelEl
      .querySelector('[data-action="close"]')
      ?.addEventListener('click', () => this.callbacks.onClose());
  }

  private filteredReviews(): ReviewAnalysis[] {
    const a = this.analysis;
    if (!a) return [];
    const list = [...a.reviews];
    // A pinned reviewer overrides the tab filter: show exactly their reviews.
    if (this.authorFilter) {
      return list
        .filter((r) => r.review.author.trim() === this.authorFilter)
        .sort((x, y) => x.score - y.score);
    }
    let result = this.applyTabFilter(list, this.filter);
    // Score range narrows whatever the tab produced (e.g. Verified + 80–89).
    if (this.scoreBand) {
      const { lo, hi } = this.scoreBand;
      result = result.filter((r) => r.score >= lo && r.score <= hi);
    }
    // Customer star rating narrows further (e.g. the 1★ reviews within a tab).
    if (this.starFilter !== null) {
      result = result.filter((r) => reviewStar(r.review.rating) === this.starFilter);
    }
    return this.applySort(result);
  }

  /**
   * Sort options that can actually differentiate on this page: date sorts only
   * when reviews have dates, helpful-votes only when any votes exist. Inert
   * options would silently do nothing and erode trust in the controls.
   */
  private sortOptionsHtml(): string {
    const reviews = this.analysis?.reviews ?? [];
    const hasDates = reviews.some((r) => r.review.dateISO !== null);
    const hasVotes = reviews.some((r) => r.review.helpfulVotes > 0);
    const opts: Array<{ id: Sort; label: string }> = [
      { id: 'page', label: 'Page order' },
      { id: 'score-desc', label: 'Highest score' },
      { id: 'score-asc', label: 'Lowest score' },
      ...(hasDates ? ([{ id: 'newest', label: 'Newest' }, { id: 'oldest', label: 'Oldest' }] as const) : []),
      { id: 'detailed', label: 'Most detailed' },
      ...(hasVotes ? ([{ id: 'helpful', label: 'Most helpful' }] as const) : []),
    ];
    return opts
      .map((o) => `<option value="${o.id}"${o.id === this.sort ? ' selected' : ''}>${o.label}</option>`)
      .join('');
  }

  /**
   * Clickable rating-distribution bars. Clicking a star filters the review list
   * to that customer rating (the active bar toggles it off). Empty bars are
   * disabled — there is nothing to show.
   */
  private ratingBarsHtml(dist: Record<1 | 2 | 3 | 4 | 5, number>): string {
    const total = dist[1] + dist[2] + dist[3] + dist[4] + dist[5] || 1;
    return ([5, 4, 3, 2, 1] as const)
      .map((star) => {
        const count = dist[star];
        const pct = ((count / total) * 100).toFixed(1);
        const color = star >= 4 ? VERDICT.good : star === 3 ? VERDICT.warn : VERDICT.bad;
        const on = this.starFilter === star;
        const title = count === 0
          ? `No ${star}★ reviews`
          : `Show the ${count} review${count === 1 ? '' : 's'} rated ${star}★`;
        return `<button type="button" class="rs-starbar${on ? ' rs-starbar--on' : ''}" data-star="${star}"${
          count === 0 ? ' disabled' : ''
        } aria-pressed="${String(on)}" title="${escapeHtml(title)}">
            <span class="rs-starbar__label">${star}★</span>
            <span class="rs-starbar__track"><span class="rs-starbar__fill" style="width:${pct}%;background:${color}"></span></span>
            <span class="rs-starbar__count">${count}</span>
          </button>`;
      })
      .join('');
  }

  /** Pure narrowing — ordering is applied separately by applySort. */
  private applyTabFilter(list: ReviewAnalysis[], filter: Filter): ReviewAnalysis[] {
    switch (filter) {
      case 'high-trust':
        return list.filter((r) => r.score >= 70);
      case 'medium-trust':
        return list.filter((r) => r.score >= 55 && r.score < 70);
      case 'low-trust':
        return list.filter((r) => r.score < 55);
      case 'verified':
        return list.filter((r) => r.review.verified);
      case 'suspicious':
        return list.filter((r) => r.level === 'suspicious' || r.level === 'attention');
      case 'ai-like':
        return list.filter((r) => r.signals.some((s) => s.id === 'ai-style'));
      case 'repeated':
        return list.filter((r) => r.similarTo.length > 0);
      case 'multi-author': {
        // Reviews from accounts that posted more than once, grouped by author.
        const counts = this.authorCounts();
        return list
          .filter((r) => (counts.get(r.review.author.trim()) ?? 0) > 1)
          .sort((x, y) => x.review.author.localeCompare(y.review.author));
      }
      default:
        return list;
    }
  }

  private applySort(list: ReviewAnalysis[]): ReviewAnalysis[] {
    switch (this.sort) {
      case 'score-desc':
        return list.sort((x, y) => y.score - x.score);
      case 'score-asc':
        return list.sort((x, y) => x.score - y.score);
      case 'newest':
        return list.sort((x, y) => (y.review.dateISO ?? '').localeCompare(x.review.dateISO ?? ''));
      case 'oldest':
        return list.sort((x, y) => (x.review.dateISO ?? '~').localeCompare(y.review.dateISO ?? '~'));
      case 'detailed':
        return list.sort((x, y) => y.review.text.length - x.review.text.length);
      case 'helpful':
        return list.sort((x, y) => y.review.helpfulVotes - x.review.helpfulVotes);
      default:
        return list; // page order
    }
  }

  private render(): void {
    const a = this.analysis;
    if (!a) return;

    const suspicious = a.reviews.filter((r) => r.level === 'suspicious').length;
    const mixed = a.reviews.filter((r) => r.level === 'attention' || r.level === 'possibly-genuine').length;
    const genuine = a.reviews.filter((r) => r.level === 'genuine').length;
    const sevColor = { low: VERDICT.warn, medium: VERDICT.warn, high: VERDICT.bad } as const;

    // Google has no "verified purchase" concept, so a "0 Verified" stat there is
    // meaningless and reads like a red flag. On places we surface Local Guides —
    // Google's own trusted-contributor badge — instead.
    const isPlace = a.subject === 'place';
    const localGuides = a.reviews.filter((r) => r.review.authorIsLocalGuide).length;
    const midStat = isPlace
      ? {
          num: `${localGuides}`,
          label: 'Local Guides',
          title: 'Reviews written by Google Local Guides (trusted contributors)',
        }
      : {
          num: `${a.verifiedCount}`,
          label: 'Verified',
          title: 'Reviews confirmed as verified purchases',
        };

    const patternsHtml = a.patterns.length
      ? a.patterns
          .map(
            (p) => `
        <div class="rs-pattern">
          <span class="rs-pattern__dot" style="background:${sevColor[p.severity]}"></span>
          <div>
            <div class="rs-pattern__label">${escapeHtml(p.label)}</div>
            <div class="rs-pattern__detail">${escapeHtml(p.detail)}</div>
          </div>
        </div>`,
          )
          .join('')
      : `<div class="rs-empty">No page-level suspicious patterns detected.</div>`;

    this.panelEl.innerHTML = `
      ${this.headHtml(a.site)}
      <div class="rs-body">
        <div class="rs-hero">
          ${gaugeSvg(a.trustIndex)}
          <div>
            <div class="rs-hero__label">${escapeHtml(a.riskLabel)}</div>
            <span class="rs-badge" style="background:${scoreColor(a.trustIndex)}">Trust Index ${a.trustIndex}/100</span>
            <div class="rs-hero__meta">Authenticity of the reviews on this page (0–100). Higher is better.</div>
            <div class="rs-hero__meta">${a.reviewCount} reviews analyzed · ${escapeHtml(a.confidence)} confidence</div>
          </div>
        </div>

        <div class="rs-breakdown">
          ${
            (a.patternPenalty ?? 0) > 0
              ? `Individual reviews averaged <b>${a.reviewScoreAvg}/100</b>, but ${a.patterns.length} page-level warning${a.patterns.length === 1 ? '' : 's'} lowered the page to <b>${a.trustIndex}</b> (−${a.patternPenalty}). See “Suspicious activity” below.`
              : `The page score is the average of the individual review scores. No page-level warnings were found.`
          }
        </div>

        ${
          this.moreReviews
            ? `<div class="rs-more">
                 <div><b>${a.reviewCount}</b> reviews analyzed so far. ${escapeHtml(this.moreReviews.note)}</div>
                 <button class="rs-btn rs-btn--primary rs-more__btn" data-action="analyze-all" type="button">${escapeHtml(this.moreReviews.cta)}</button>
               </div>`
            : ''
        }

        <details class="rs-explain">
          <summary>What do these numbers mean?</summary>
          <ul>
            <li><b>Trust Index (${a.trustIndex}/100)</b> — how authentic the reviews look overall. It's the average of the per-review scores, minus penalties for page-wide red flags (e.g. a wall of 5-star reviews).</li>
            <li><b>Star ratings</b> — the 1–5★ scores customers gave. This is what the site shows; a high average says nothing about whether the reviews are real.</li>
            <li><b>ReviewShield verdicts</b> — our judgement of how <i>authentic</i> each review looks: Trusted, Mixed or Suspicious. This is about whether a real person wrote it, <b>not</b> whether they liked the place — a genuine 1★ review is still Trusted.</li>
            <li><b>Avg rating / ${midStat.label} / Suspicious</b> — mean star rating, ${
              isPlace
                ? 'how many reviewers are Google Local Guides'
                : 'count of verified purchases'
            }, and how many reviews we flagged.</li>
          </ul>
          <p class="rs-disclaimer">ReviewShield flags <b>statistical patterns</b> commonly associated with paid or fake reviews — it cannot know whether any individual review is genuinely fake, and a low score is not an accusation against the reviewer. Treat it as a prompt to read more carefully, not as proof. Analysis runs entirely on your device.</p>
        </details>

        <div class="rs-stats">
          <div class="rs-stat" title="Mean star rating customers gave (1–5)"><div class="rs-stat__num">${a.averageRating ?? '—'}</div><div class="rs-stat__label">Avg rating ★</div></div>
          <div class="rs-stat" title="${escapeHtml(midStat.title)}"><div class="rs-stat__num">${midStat.num}</div><div class="rs-stat__label">${midStat.label}</div></div>
          <div class="rs-stat" title="Reviews ReviewShield flagged as suspicious"><div class="rs-stat__num" style="color:${suspicious ? VERDICT.bad : VERDICT.good}">${suspicious}</div><div class="rs-stat__label">Suspicious</div></div>
        </div>

        <section class="rs-section">
          <div class="rs-section__title">Star ratings <span class="rs-hint">— click a bar to see those reviews</span></div>
          <div class="rs-card">${this.ratingBarsHtml(a.ratingDistribution)}</div>
        </section>

        <section class="rs-section">
          <div class="rs-section__title">ReviewShield verdicts <span class="rs-hint">— how authentic each review looks</span></div>
          <div class="rs-card rs-split">
            <div class="rs-legend">
              <div class="rs-legend__row"><span class="rs-legend__dot" style="background:${VERDICT.good}"></span> Trusted <b>${genuine}</b></div>
              <div class="rs-legend__row"><span class="rs-legend__dot" style="background:${VERDICT.warn}"></span> Mixed <b>${mixed}</b></div>
              <div class="rs-legend__row"><span class="rs-legend__dot" style="background:${VERDICT.bad}"></span> Suspicious <b>${suspicious}</b></div>
            </div>
            <div>${trustDonutSvg({ genuine, mixed, suspicious })}</div>
          </div>
          <p class="rs-note">Authenticity, not rating: this measures whether a real person wrote the review, not whether it's positive. A genuine 1★ complaint is still <b>Trusted</b>.</p>
        </section>

        <section class="rs-section">
          <div class="rs-section__title">Reviews over time</div>
          <div class="rs-card">${timelineSvg(a.timeline)}</div>
        </section>

        <section class="rs-section">
          <div class="rs-section__title">Suspicious activity</div>
          <div class="rs-card">${patternsHtml}</div>
        </section>

        <section class="rs-section">
          <div class="rs-section__title">Recommendations</div>
          <div class="rs-card">
            ${a.recommendations.map((r) => `<div class="rs-rec">${escapeHtml(r)}</div>`).join('')}
          </div>
        </section>

        <section class="rs-section">
          <div class="rs-section__head">
            <div class="rs-section__title">Reviews</div>
            <div class="rs-section__controls">
              <select class="rs-select" data-role="sort" aria-label="Sort reviews">
                ${this.sortOptionsHtml()}
              </select>
              <select class="rs-select" data-role="band" aria-label="Filter reviews by score range">
                <option value="">Any score</option>
                <option value="90-100">Score 90–100</option>
                <option value="80-89">Score 80–89</option>
                <option value="70-79">Score 70–79</option>
                <option value="60-69">Score 60–69</option>
                <option value="40-59">Score 40–59</option>
                <option value="0-39">Score 0–39</option>
              </select>
            </div>
          </div>
          <div class="rs-tabs" role="group" aria-label="Filter reviews">
            ${FILTERS.map(
              (f) =>
                `<button type="button" class="rs-tab" data-filter="${f.id}" aria-pressed="${String(f.id === this.filter)}">${f.label}</button>`,
            ).join('')}
          </div>
          <div data-slot="reviews"></div>
        </section>

        <div class="rs-empty">Last scan ${escapeHtml(formatWhen(a.scannedAt))} · analysis runs locally on your device.</div>
      </div>
      <footer class="rs-foot">
        <button class="rs-btn rs-btn--primary" data-action="rescan" type="button">↻ Rescan</button>
        <button class="rs-btn" data-action="export-json" type="button">JSON</button>
        <button class="rs-btn" data-action="export-csv" type="button">CSV</button>
        <button class="rs-btn" data-action="export-pdf" type="button">PDF</button>
      </footer>`;

    this.bindHead();
    this.renderReviewList();

    this.panelEl.querySelectorAll<HTMLButtonElement>('.rs-tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        this.filter = (tab.dataset.filter as Filter) ?? 'all';
        this.authorFilter = null; // switching tabs clears a pinned reviewer
        this.panelEl
          .querySelectorAll('.rs-tab')
          .forEach((t) => t.setAttribute('aria-pressed', String(t === tab)));
        this.renderReviewList();
      }),
    );

    this.panelEl.querySelectorAll<HTMLButtonElement>('.rs-starbar').forEach((bar) =>
      bar.addEventListener('click', () => {
        const star = Number(bar.dataset.star);
        this.starFilter = this.starFilter === star ? null : star;
        this.authorFilter = null; // a star selection replaces a pinned reviewer
        this.panelEl.querySelectorAll<HTMLButtonElement>('.rs-starbar').forEach((b) => {
          const on = this.starFilter !== null && Number(b.dataset.star) === this.starFilter;
          b.classList.toggle('rs-starbar--on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        this.renderReviewList();
        this.panelEl
          .querySelector('[data-slot="reviews"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }),
    );

    const band = this.panelEl.querySelector<HTMLSelectElement>('[data-role="band"]');
    if (band) {
      band.value = this.scoreBand ? `${this.scoreBand.lo}-${this.scoreBand.hi}` : '';
      band.addEventListener('change', () => {
        const [lo, hi] = band.value.split('-').map(Number);
        this.scoreBand =
          band.value && lo !== undefined && hi !== undefined ? { lo, hi } : null;
        this.renderReviewList();
      });
    }

    const sortSel = this.panelEl.querySelector<HTMLSelectElement>('[data-role="sort"]');
    sortSel?.addEventListener('change', () => {
      this.sort = (sortSel.value as Sort) ?? 'page';
      this.renderReviewList();
    });

    const on = (action: string, fn: () => void) =>
      this.panelEl.querySelector(`[data-action="${action}"]`)?.addEventListener('click', fn);
    on('rescan', () => {
      this.setScanning();
      this.callbacks.onRescan();
    });
    on('analyze-all', () => {
      if (this.moreReviews) this.callbacks.onAnalyzeAll?.(this.moreReviews.url);
    });
    on('export-json', () => this.analysis && exportJson(this.analysis));
    on('export-csv', () => this.analysis && exportCsv(this.analysis));
    on('export-pdf', () => this.analysis && exportPdf(this.analysis));

    if (this.isOpen) animateGauges(this.root);
  }

  /**
   * Show live counts on every filter control: each tab gets "(n)" for how many
   * reviews it would show under the current score band, and each score-band
   * option gets "(n)" within the current tab.
   */
  private updateFilterCounts(): void {
    const a = this.analysis;
    if (!a) return;
    const inBand = (r: ReviewAnalysis): boolean =>
      !this.scoreBand || (r.score >= this.scoreBand.lo && r.score <= this.scoreBand.hi);

    const countFor = (f: Filter): number =>
      this.applyTabFilter([...a.reviews], f).filter(inBand).length;

    // If the active tab just became empty (e.g. after a band change), fall
    // back to All rather than showing an empty list under a hidden tab.
    if (this.filter !== 'all' && countFor(this.filter) === 0) this.filter = 'all';

    for (const tab of this.panelEl.querySelectorAll<HTMLButtonElement>('.rs-tab')) {
      const f = (tab.dataset.filter as Filter) ?? 'all';
      const n = countFor(f);
      const label = FILTERS.find((x) => x.id === f)?.label ?? f;
      tab.textContent = `${label} (${n})`;
      // Hide filters that can't match anything on this page — an always-(0)
      // tab is noise, not information.
      tab.hidden = n === 0 && f !== 'all';
      tab.setAttribute('aria-pressed', String(f === this.filter));
    }

    const band = this.panelEl.querySelector<HTMLSelectElement>('[data-role="band"]');
    if (band) {
      const base = this.applyTabFilter([...a.reviews], this.filter);
      for (const opt of band.options) {
        if (!opt.value) {
          opt.textContent = `Any score (${base.length})`;
          continue;
        }
        const [lo, hi] = opt.value.split('-').map(Number);
        const n = base.filter((r) => r.score >= (lo ?? 0) && r.score <= (hi ?? 100)).length;
        opt.textContent = `Score ${lo}–${hi} (${n})`;
      }
    }
  }

  private renderReviewList(): void {
    this.updateFilterCounts();
    const slot = this.panelEl.querySelector('[data-slot="reviews"]');
    if (!slot) return;
    const counts = this.authorCounts();
    const reviews = this.filteredReviews().slice(0, 40);
    slot.replaceChildren();

    // Banner shown while a single reviewer is pinned.
    if (this.authorFilter) {
      const bar = document.createElement('div');
      bar.className = 'rs-authorbar';
      const label = document.createElement('span');
      label.textContent = `Reviews by “${this.authorFilter}” (${reviews.length})`;
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'rs-authorbar__clear';
      clear.textContent = '✕ Show all';
      clear.addEventListener('click', () => {
        this.authorFilter = null;
        this.renderReviewList();
      });
      bar.append(label, clear);
      slot.appendChild(bar);
    }

    // Banner shown while a customer star rating is selected from the chart.
    if (this.starFilter !== null && !this.authorFilter) {
      const bar = document.createElement('div');
      bar.className = 'rs-authorbar';
      const label = document.createElement('span');
      label.textContent = `Showing ${reviews.length} review${reviews.length === 1 ? '' : 's'} rated ${this.starFilter}★`;
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'rs-authorbar__clear';
      clear.textContent = '✕ Show all';
      clear.addEventListener('click', () => {
        this.starFilter = null;
        this.panelEl.querySelectorAll<HTMLButtonElement>('.rs-starbar').forEach((b) => {
          b.classList.remove('rs-starbar--on');
          b.setAttribute('aria-pressed', 'false');
        });
        this.renderReviewList();
      });
      bar.append(label, clear);
      slot.appendChild(bar);
    }

    if (reviews.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rs-empty';
      empty.textContent = 'No reviews match this filter.';
      slot.appendChild(empty);
      return;
    }

    for (const r of reviews) {
      const author = r.review.author.trim() || 'Unknown';
      const count = counts.get(author) ?? 1;

      const row = document.createElement('div');
      row.className = 'rs-review';

      const top = document.createElement('div');
      top.className = 'rs-review__top';

      const score = document.createElement('span');
      score.className = 'rs-review__score';
      score.style.color = scoreColor(r.score);
      score.textContent = String(r.score);

      // Author. Real names are buttons (click to pin/isolate that reviewer's
      // reviews); generic fallbacks ("Unknown", "A Google User") are plain text,
      // because they are not one person — grouping them would falsely bundle
      // dozens of unrelated reviewers under a single identity.
      const groupable = !isGenericAuthor(author);
      let authorEl: HTMLElement;
      if (groupable) {
        const btn = document.createElement('button');
        btn.type = 'button';
        if (count > 1) btn.classList.add('rs-review__author--multi');
        btn.textContent = count > 1 ? `${author} ·${count}` : author;
        btn.title =
          count > 1
            ? `Show the ${count} reviews “${author}” posted on this page`
            : `Show only reviews by ${author}`;
        btn.addEventListener('click', () => {
          this.authorFilter = author;
          this.renderReviewList();
        });
        authorEl = btn;
      } else {
        authorEl = document.createElement('span');
        authorEl.textContent = author;
        authorEl.title = 'Google did not attach an identifiable name to this review';
      }
      authorEl.classList.add('rs-review__author');

      const meta = document.createElement('span');
      meta.className = 'rs-review__meta';
      const date = r.review.dateISO ? new Date(r.review.dateISO).toLocaleDateString() : '';
      meta.textContent = `${r.review.rating !== null ? `${r.review.rating}★ · ` : ''}${date}`;

      top.append(score, authorEl, meta);

      // Body is a button: click to scroll to the review on the page.
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'rs-review__open';
      open.setAttribute('aria-label', `Jump to review by ${author}, score ${r.score}`);
      open.innerHTML = `
        <div class="rs-review__text">${escapeHtml((r.review.title + ' ' + r.review.text).trim().slice(0, 180))}</div>
        <div class="rs-review__tags">
          <span class="rs-tag">${LEVEL_LABEL[r.level]}</span>
          ${r.signals
            .filter((s) => s.penalty > 0)
            .slice(0, 3)
            .map((s) => `<span class="rs-tag">${escapeHtml(s.label)}</span>`)
            .join('')}
        </div>`;
      open.addEventListener('click', () => scrollToReview(r.review.id));

      row.append(top, open);
      slot.appendChild(row);
    }
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKeydown);
    this.host.remove();
    this.fab.remove();
  }
}
