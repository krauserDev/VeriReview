/**
 * Background service worker (Manifest V3). Responsibilities:
 *  - route the three manual entry points (toolbar popup, context menu,
 *    keyboard shortcut) to the content script as START_ANALYSIS
 *  - receive scan results → update badge, store history + cache
 *  - open the printable report page for PDF export
 *
 * Deliberately holds only `storage` and `contextMenus` permissions: the badge
 * comes from `action` (no permission), and the local cache is pruned
 * opportunistically on each scan rather than via a `chrome.alarms` timer, so a
 * manual review-checker never has to ask for alarms or notifications.
 */
import type { PageAnalysis, RuntimeMessage } from '../types/index.js';
import { addHistoryEntry, cacheAnalysis, pruneCache } from '../services/history-service.js';

/**
 * Every supported host, kept in one place so the context menu can be scoped to
 * exactly the pages the content script runs on (must stay in sync with the
 * manifest's `content_scripts.matches`).
 */
const SUPPORTED_URL_PATTERNS: string[] = [
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.es',
  'amazon.it', 'amazon.ca', 'amazon.nl', 'amazon.com.mx',
  'google.com', 'google.es', 'google.co.uk', 'google.de', 'google.fr',
  'google.it', 'google.nl', 'google.ca', 'google.com.mx',
].map((host) => `https://*.${host}/*`);

// Kept in sync with the VERDICT palette in src/ui/charts.ts.
const badgeColor = (score: number): string =>
  score >= 70 ? '#1c8a5f' : score >= 40 ? '#c07d1c' : '#c23b40';

/** Ask the content script in a tab to start (or refresh) a manual analysis. */
function requestAnalysis(tabId: number): void {
  void chrome.tabs
    .sendMessage(tabId, { type: 'START_ANALYSIS' } satisfies RuntimeMessage)
    .catch(() => undefined); // content script not present on this page — ignore
}

async function handleScanComplete(analysis: PageAnalysis, tabId: number | undefined): Promise<void> {
  await Promise.all([cacheAnalysis(analysis), addHistoryEntry(analysis)]);
  // Prune the local cache opportunistically (right after a write) so stored
  // scans stay bounded without a background alarm.
  void pruneCache().catch(() => undefined);

  if (tabId !== undefined) {
    await chrome.action.setBadgeText({ tabId, text: String(analysis.trustIndex) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor(analysis.trustIndex) });
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender, sendResponse) => {
  switch (msg.type) {
    case 'SCAN_COMPLETE':
      void handleScanComplete(msg.analysis, sender.tab?.id).then(() => sendResponse({ ok: true }));
      return true; // async response
    case 'CLEAR_BADGE':
      if (sender.tab?.id !== undefined) {
        void chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' }).catch(() => undefined);
      }
      sendResponse({ ok: true });
      return false;
    case 'OPEN_REPORT':
      void chrome.storage.local
        .set({ 'report:pending': msg.analysis })
        .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('report/report.html') }))
        .then(() => sendResponse({ ok: true }));
      return true;
    default:
      return undefined;
  }
});

/* Context menu — one of the three ways to start a manual analysis. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'reviewshield-scan',
    title: 'Analyze reviews with ReviewShield',
    contexts: ['page'],
    documentUrlPatterns: SUPPORTED_URL_PATTERNS,
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'reviewshield-scan' && tab?.id !== undefined) {
    requestAnalysis(tab.id);
  }
});

/* Keyboard shortcut (default Alt+Shift+A) — the third entry point. */
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'analyze-reviews') return;
  if (tab?.id !== undefined) {
    requestAnalysis(tab.id);
    return;
  }
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
    if (active?.id !== undefined) requestAnalysis(active.id);
  });
});

/* Clear badge on navigation away */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
  }
});
