/**
 * Cross-review behavioral analysis: near-duplicate text clusters,
 * copy-paste farms, and repeated author activity.
 */
import type { PagePattern, ParsedReview, ReviewSignal } from '../types/index.js';
import { isGenericAuthor, jaccard, shingles, tokenize } from '../utils/index.js';

export interface BehaviorResult {
  /** reviewId → signals contributed by behavioral analysis */
  perReview: Map<string, ReviewSignal[]>;
  /** reviewId → ids of near-identical reviews */
  similarity: Map<string, string[]>;
  patterns: PagePattern[];
}

const SIMILARITY_THRESHOLD = 0.55;
const MAX_PAIRWISE = 250; // O(n²) guard

export function analyzeBehavior(reviews: ParsedReview[]): BehaviorResult {
  const perReview = new Map<string, ReviewSignal[]>();
  const similarity = new Map<string, string[]>();
  const patterns: PagePattern[] = [];

  const push = (id: string, s: ReviewSignal) => {
    const arr = perReview.get(id) ?? [];
    arr.push(s);
    perReview.set(id, arr);
  };

  /* ---------- Near-duplicate detection (copy-paste patterns) ---------- */
  const sample = reviews.slice(0, MAX_PAIRWISE);
  const sets = sample.map((r) => {
    const tokens = tokenize(`${r.title} ${r.text}`);
    return tokens.length >= 6 ? shingles(tokens) : new Set<string>();
  });

  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const a = sets[i]!;
      const b = sets[j]!;
      if (a.size === 0 || b.size === 0) continue;
      if (jaccard(a, b) >= SIMILARITY_THRESHOLD) {
        const ri = sample[i]!;
        const rj = sample[j]!;
        similarity.set(ri.id, [...(similarity.get(ri.id) ?? []), rj.id]);
        similarity.set(rj.id, [...(similarity.get(rj.id) ?? []), ri.id]);
      }
    }
  }

  let clusteredReviews = 0;
  for (const [id, ids] of similarity) {
    clusteredReviews++;
    push(id, {
      id: 'near-duplicate',
      label: 'Nearly identical to other reviews',
      detail: `Text is very similar to ${ids.length} other review${ids.length === 1 ? '' : 's'} on this page — a strong copy-paste indicator.`,
      severity: 'high',
      penalty: 16 + Math.min(10, ids.length * 2),
    });
  }

  if (clusteredReviews >= 3) {
    patterns.push({
      id: 'duplicate-cluster',
      label: 'Copy-paste review cluster',
      detail: `${clusteredReviews} reviews share nearly identical wording despite different authors — consistent with fake review farms.`,
      severity: 'high',
      penalty: Math.min(18, 8 + clusteredReviews * 2),
    });
  }

  /* ---------- Repeated authors ---------- */
  const byAuthor = new Map<string, ParsedReview[]>();
  for (const r of reviews) {
    // Generic/platform names ("A Google User", "Doctoralia") are not personal
    // accounts — grouping them would flag unrelated reviews as one person.
    if (isGenericAuthor(r.author)) continue;
    const key = r.author.trim().toLowerCase();
    byAuthor.set(key, [...(byAuthor.get(key) ?? []), r]);
  }
  for (const [, list] of byAuthor) {
    if (list.length >= 2) {
      for (const r of list) {
        push(r.id, {
          id: 'repeat-author',
          label: 'Same account posted multiple reviews',
          detail: `“${list[0]!.author}” posted ${list.length} reviews on this page.`,
          severity: 'medium',
          penalty: 10,
        });
      }
    }
  }

  /* ---------- Anonymous / low-information profiles ---------- */
  for (const r of reviews) {
    if (isGenericAuthor(r.author)) {
      push(r.id, {
        id: 'anonymous-profile',
        label: 'Low-information profile',
        detail: 'Posted from a default or anonymous account name with no profile identity.',
        severity: 'low',
        penalty: 4,
      });
    }
  }

  /* ---------- Reviewer track record (top paid-review signal) ---------- */
  for (const r of reviews) {
    const count = r.authorReviewCount;
    if (count !== null && count <= 1) {
      push(r.id, {
        id: 'single-review-author',
        label: 'First-time reviewer',
        detail:
          'This account has only one review in its whole history — the single most common trait of accounts used for paid or fake reviews.',
        severity: 'high',
        penalty: 18,
      });
    } else if (count !== null && count <= 3 && !r.authorIsLocalGuide) {
      push(r.id, {
        id: 'low-history-author',
        label: 'Very little review history',
        detail: `The author has only ${count} reviews and is not a Local Guide — a thin, easily-faked track record.`,
        severity: 'medium',
        penalty: 9,
      });
    }

    // Trust bonus: an established contributor is expensive to fake.
    if (r.authorIsLocalGuide || (r.authorReviewCount ?? 0) >= 20) {
      push(r.id, {
        id: 'established-reviewer',
        label: 'Established reviewer',
        detail: r.authorIsLocalGuide
          ? 'Posted by a Google Local Guide with an ongoing contribution history.'
          : `The author has ${r.authorReviewCount} reviews — a substantial, hard-to-fake track record.`,
        severity: 'low',
        penalty: -8,
      });
    }
  }

  /* Page pattern: a flood of one-review accounts is a bought-campaign hallmark. */
  const withCount = reviews.filter((r) => r.authorReviewCount !== null);
  const singleReviewers = withCount.filter((r) => (r.authorReviewCount ?? 0) <= 1).length;
  if (withCount.length >= 6 && singleReviewers / withCount.length >= 0.4) {
    patterns.push({
      id: 'many-first-time-reviewers',
      label: 'Many first-time reviewers',
      detail: `${singleReviewers} of ${withCount.length} reviewers with a known profile have only one review — a strong signature of a purchased review campaign.`,
      severity: 'high',
      penalty: 15,
    });
  }

  return { perReview, similarity, patterns };
}
