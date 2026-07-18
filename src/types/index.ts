/**
 * Shared domain types used across content scripts, background, popup and options.
 */

/** A review parsed from a supported site, normalized into a common shape. */
export interface ParsedReview {
  /** Stable id derived from the DOM (site review id or hash). */
  id: string;
  author: string;
  /** Star rating 1–5, or null when the site does not expose it per review. */
  rating: number | null;
  title: string;
  text: string;
  /** ISO date string when the review date could be parsed. */
  dateISO: string | null;
  /** True when the site marks the review as a verified purchase. */
  verified: boolean;
  /** Helpful votes when exposed by the site. */
  helpfulVotes: number;
  /**
   * Total reviews the author has on their profile (site-reported), or null when
   * unknown. A count of 1 is one of the strongest paid-review signals.
   */
  authorReviewCount: number | null;
  /** Google "Local Guide" (or equivalent trusted-contributor) status. */
  authorIsLocalGuide: boolean;
}

/**
 * What a page's reviews are about. Drives the wording of recommendations:
 * purchase advice fits an Amazon product, never a clinic or a restaurant.
 */
export type ReviewSubject = 'product' | 'place';

/** How severe a detected signal is, used for weighting and UI color. */
export type SignalSeverity = 'low' | 'medium' | 'high';

/** A single suspicious (or trust-building) indicator detected on a review. */
export interface ReviewSignal {
  id: string;
  label: string;
  /** Human explanation of why this was flagged — shown in tooltips and panel. */
  detail: string;
  severity: SignalSeverity;
  /** Penalty (positive) or bonus (negative) applied to the review score. */
  penalty: number;
}

export type TrustLevel = 'genuine' | 'possibly-genuine' | 'attention' | 'suspicious';

/** Per-review analysis outcome. */
export interface ReviewAnalysis {
  review: ParsedReview;
  /** 0–100 where 100 means likely genuine. */
  score: number;
  level: TrustLevel;
  signals: ReviewSignal[];
  /** Ids of other reviews with near-identical text, if any. */
  similarTo: string[];
}

/** A page-level suspicious pattern, e.g. a review burst or rating skew. */
export interface PagePattern {
  id: string;
  label: string;
  detail: string;
  severity: SignalSeverity;
  penalty: number;
}

export type RiskLabel =
  | 'Very Trustworthy'
  | 'Trustworthy'
  | 'Moderate Risk'
  | 'High Risk'
  | 'Very High Risk';

/** Full result of analyzing all reviews on a page. */
export interface PageAnalysis {
  url: string;
  site: string;
  /** What the reviews are about — a product (Amazon) or a place (Google). */
  subject: ReviewSubject;
  pageTitle: string;
  scannedAt: number;
  /** Global trust index 0–100 (= reviewScoreAvg − patternPenalty, clamped). */
  trustIndex: number;
  /** Weighted average of per-review scores, before page-level penalties. */
  reviewScoreAvg: number;
  /** Total penalty applied for page-level patterns (bursts, rating skew…). */
  patternPenalty: number;
  riskLabel: RiskLabel;
  /** low review counts reduce confidence in the index. */
  confidence: 'low' | 'medium' | 'high';
  reviewCount: number;
  verifiedCount: number;
  averageRating: number | null;
  ratingDistribution: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Reviews per ISO day, for the timeline chart. */
  timeline: Array<{ day: string; count: number }>;
  reviews: ReviewAnalysis[];
  patterns: PagePattern[];
  recommendations: string[];
}

/** Entry stored in local scan history. */
export interface HistoryEntry {
  url: string;
  site: string;
  pageTitle: string;
  scannedAt: number;
  trustIndex: number;
  riskLabel: RiskLabel;
  reviewCount: number;
  warningCount: number;
}

/** User settings synced via chrome.storage.sync. */
export interface Settings {
  enabledSites: { amazon: boolean; google: boolean };
  /** 0 = lenient … 100 = strict. Shifts scoring thresholds. */
  sensitivity: number;
  analysisDepth: 'quick' | 'standard' | 'deep';
  theme: 'auto' | 'light' | 'dark';
  autoScan: boolean;
  highlightReviews: boolean;
  /** Reserved for future locales. */
  language: 'en';
}

export const DEFAULT_SETTINGS: Settings = {
  enabledSites: { amazon: true, google: true },
  sensitivity: 50,
  analysisDepth: 'standard',
  theme: 'auto',
  // Manual by default: the extension stays idle until the user asks to analyze.
  autoScan: false,
  highlightReviews: true,
  language: 'en',
};

/* ------------------------------------------------------------------ */
/* Runtime messaging                                                    */
/* ------------------------------------------------------------------ */

export type RuntimeMessage =
  /** Content → background: a fresh analysis finished. */
  | { type: 'SCAN_COMPLETE'; analysis: PageAnalysis }
  /** Any entry point → content: begin a manual analysis session. */
  | { type: 'START_ANALYSIS' }
  /** Content: re-run analysis over the reviews currently in the DOM. */
  | { type: 'REQUEST_RESCAN' }
  /** Content: tear the session down and restore the page. */
  | { type: 'STOP_ANALYSIS' }
  /** Liveness/state probe — content replies with whether a session is active. */
  | { type: 'PING' }
  /** Content → background: clear this tab's badge after teardown. */
  | { type: 'CLEAR_BADGE' }
  /** Open the printable report for PDF export. */
  | { type: 'OPEN_REPORT'; analysis: PageAnalysis };

export type RuntimeResponse = {
  ok: boolean;
  /** Whether an analysis session is currently mounted on the page. */
  active?: boolean;
  analysis?: PageAnalysis | null;
};
