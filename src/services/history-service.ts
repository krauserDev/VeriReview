/** Local scan history + per-URL result cache (chrome.storage.local only). */
import type { HistoryEntry, PageAnalysis } from '../types/index.js';

const HISTORY_KEY = 'history';
const CACHE_PREFIX = 'scan:';
const MAX_HISTORY = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function addHistoryEntry(analysis: PageAnalysis): Promise<void> {
  const entry: HistoryEntry = {
    url: analysis.url,
    site: analysis.site,
    pageTitle: analysis.pageTitle,
    scannedAt: analysis.scannedAt,
    trustIndex: analysis.trustIndex,
    riskLabel: analysis.riskLabel,
    reviewCount: analysis.reviewCount,
    warningCount: analysis.patterns.length,
  };
  const data = await chrome.storage.local.get(HISTORY_KEY);
  const history = (data[HISTORY_KEY] ?? []) as HistoryEntry[];
  const next = [entry, ...history.filter((h) => h.url !== entry.url)].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return (data[HISTORY_KEY] ?? []) as HistoryEntry[];
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}

export async function cacheAnalysis(analysis: PageAnalysis): Promise<void> {
  await chrome.storage.local.set({ [CACHE_PREFIX + analysis.url]: analysis });
}

export async function getCachedAnalysis(url: string): Promise<PageAnalysis | null> {
  const data = await chrome.storage.local.get(CACHE_PREFIX + url);
  const cached = data[CACHE_PREFIX + url] as PageAnalysis | undefined;
  if (!cached) return null;
  if (Date.now() - cached.scannedAt > CACHE_TTL_MS) return null;
  return cached;
}

/** Remove expired cache entries; called from a background alarm. */
export async function pruneCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const expired = Object.entries(all)
    .filter(([k, v]) => {
      if (!k.startsWith(CACHE_PREFIX)) return false;
      const scan = v as PageAnalysis;
      return Date.now() - scan.scannedAt > CACHE_TTL_MS;
    })
    .map(([k]) => k);
  if (expired.length) await chrome.storage.local.remove(expired);
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
}
