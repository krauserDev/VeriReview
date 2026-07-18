/**
 * Toolbar popup — the primary entry point for a manual analysis.
 *
 * Shows one of three states for the active tab: unsupported page, "ready to
 * analyze" (with a big primary button), or the existing result. The primary
 * button and secondary actions are wired per state. All heavy work happens in
 * the content script; the popup only sends messages.
 */
import type { PageAnalysis, RuntimeMessage } from '../types/index.js';
import { getCachedAnalysis, getHistory } from '../services/history-service.js';
import { getSettings } from '../services/settings-service.js';
import { animateGauges, gaugeSvg, scoreColor } from '../ui/charts.js';
import { formatWhen } from '../utils/index.js';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

const DEPTH_ESTIMATE: Record<string, string> = { quick: '~1s', standard: '~2s', deep: '~4s' };

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Return the friendly site name for a supported URL, or null. */
function detectSite(url: string | undefined): 'Amazon' | 'Google' | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)amazon\./i.test(host)) return 'Amazon';
    if (/(^|\.)google\./i.test(host)) return 'Google';
  } catch {
    /* not a URL we can parse */
  }
  return null;
}

function show(state: 'unsupported' | 'ready' | 'result'): void {
  $('#state-unsupported').hidden = state !== 'unsupported';
  $('#state-ready').hidden = state !== 'ready';
  $('#state-result').hidden = state !== 'result';
}

function setPrimary(label: string, onClick: () => void): void {
  const btn = $<HTMLButtonElement>('#primary-action');
  btn.hidden = false;
  btn.textContent = label;
  btn.onclick = onClick;
}

function setSecondary(actions: Array<{ label: string; onClick: () => void }>): void {
  const row = $('#secondary-actions');
  row.replaceChildren();
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost';
    btn.textContent = a.label;
    btn.addEventListener('click', a.onClick);
    row.appendChild(btn);
  }
}

/** Send a message to the active tab; reload the page if the script is absent. */
async function messageActiveTab(message: RuntimeMessage): Promise<void> {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    window.close();
  } catch {
    // Content script not injected (page predates the extension). Reloading
    // injects it; the user can then trigger analysis again. Only reload pages
    // whose HOSTNAME is a supported site — a URL merely containing "amazon."
    // in its query string must not trigger a reload.
    if (detectSite(tab.url)) {
      await chrome.tabs.reload(tab.id);
      window.close();
    }
  }
}

function renderResult(analysis: PageAnalysis): void {
  $('#gauge').innerHTML = gaugeSvg(analysis.trustIndex, 110);
  const label = $('#risk-label');
  label.textContent = analysis.riskLabel;
  label.style.color = scoreColor(analysis.trustIndex);
  // "Verified purchase" only exists on product sites; on places (Google) the
  // stat is meaningless and reads like a red flag, so it is omitted there.
  const verified = analysis.subject === 'product' ? `${analysis.verifiedCount} verified · ` : '';
  $('#summary').textContent =
    `${analysis.reviewCount} reviews · ${verified}` +
    `${analysis.patterns.length} warning${analysis.patterns.length === 1 ? '' : 's'} · ${analysis.confidence} confidence`;

  const patterns = $('#patterns');
  patterns.replaceChildren();
  for (const p of analysis.patterns.slice(0, 3)) {
    const div = document.createElement('div');
    div.className = 'pattern';
    div.textContent = p.label;
    patterns.appendChild(div);
  }
  animateGauges(document);
}

async function renderCurrent(): Promise<void> {
  const tab = await activeTab();
  const url = tab?.url ?? '';
  const site = detectSite(url);
  const analysis = url ? await getCachedAnalysis(url) : null;

  if (analysis) {
    show('result');
    renderResult(analysis);
    setPrimary('↻ Re-analyze this page', () => void messageActiveTab({ type: 'REQUEST_RESCAN' }));
    setSecondary([
      { label: 'Full report', onClick: () => void chrome.runtime.sendMessage({ type: 'OPEN_REPORT', analysis } satisfies RuntimeMessage) },
      { label: 'Clear', onClick: () => void messageActiveTab({ type: 'STOP_ANALYSIS' }) },
    ]);
    return;
  }

  if (site) {
    show('ready');
    $('#site-name').textContent = site;
    const settings = await getSettings();
    $('#est-time').textContent = DEPTH_ESTIMATE[settings.analysisDepth] ?? '~2s';
    setPrimary('Analyze reviews', () => void messageActiveTab({ type: 'START_ANALYSIS' }));
    setSecondary([]);
    return;
  }

  show('unsupported');
  $<HTMLButtonElement>('#primary-action').hidden = true;
  setSecondary([]);
}

async function renderRecent(): Promise<void> {
  const list = $('#recent-list');
  const history = (await getHistory()).slice(0, 8);
  list.replaceChildren();

  if (history.length === 0) {
    const div = document.createElement('div');
    div.className = 'recent__empty';
    div.textContent = 'No scans yet.';
    list.appendChild(div);
    return;
  }

  for (const h of history) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent__item';
    btn.title = h.url;

    const score = document.createElement('span');
    score.className = 'recent__score';
    score.style.color = scoreColor(h.trustIndex);
    score.textContent = String(h.trustIndex);

    const name = document.createElement('span');
    name.className = 'recent__name';
    name.textContent = h.pageTitle || h.url;

    const when = document.createElement('span');
    when.className = 'recent__when';
    when.textContent = formatWhen(h.scannedAt);

    btn.append(score, name, when);
    btn.addEventListener('click', () => void chrome.tabs.create({ url: h.url }));
    list.appendChild(btn);
  }
}

$('#open-settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());

void renderCurrent();
void renderRecent();
