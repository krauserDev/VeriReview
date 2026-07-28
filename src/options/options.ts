/** Options page: settings persistence, searchable scan history, data tools. */
import { DEFAULT_SETTINGS, type Settings } from '../types/index.js';
import { getSettings, saveSettings } from '../services/settings-service.js';
import { clearAllData, getHistory } from '../services/history-service.js';
import { scoreColor } from '../ui/charts.js';
import { formatWhen } from '../utils/index.js';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

let settings: Settings = DEFAULT_SETTINGS;
let savedTimer: ReturnType<typeof setTimeout> | undefined;

function flashSaved(text = 'Saved ✓'): void {
  const el = $('#saved');
  el.textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.textContent = ''), 1_600);
}

async function persist(): Promise<void> {
  await saveSettings(settings);
  flashSaved();
}

function bindControls(): void {
  const amazon = $<HTMLInputElement>('#site-amazon');
  const google = $<HTMLInputElement>('#site-google');
  const sensitivity = $<HTMLInputElement>('#sensitivity');
  const sensitivityOut = $<HTMLOutputElement>('#sensitivity-out');
  const depth = $<HTMLSelectElement>('#depth');
  const autoScan = $<HTMLInputElement>('#auto-scan');
  const highlight = $<HTMLInputElement>('#highlight');
  const theme = $<HTMLSelectElement>('#theme');

  amazon.checked = settings.enabledSites.amazon;
  google.checked = settings.enabledSites.google;
  sensitivity.value = String(settings.sensitivity);
  sensitivityOut.value = String(settings.sensitivity);
  depth.value = settings.analysisDepth;
  autoScan.checked = settings.autoScan;
  highlight.checked = settings.highlightReviews;
  theme.value = settings.theme;

  amazon.addEventListener('change', () => { settings.enabledSites.amazon = amazon.checked; void persist(); });
  google.addEventListener('change', () => { settings.enabledSites.google = google.checked; void persist(); });
  sensitivity.addEventListener('input', () => { sensitivityOut.value = sensitivity.value; });
  sensitivity.addEventListener('change', () => { settings.sensitivity = Number(sensitivity.value); void persist(); });
  depth.addEventListener('change', () => { settings.analysisDepth = depth.value as Settings['analysisDepth']; void persist(); });
  autoScan.addEventListener('change', () => { settings.autoScan = autoScan.checked; void persist(); });
  highlight.addEventListener('change', () => { settings.highlightReviews = highlight.checked; void persist(); });
  theme.addEventListener('change', () => { settings.theme = theme.value as Settings['theme']; void persist(); });
}

async function renderHistory(query = ''): Promise<void> {
  const container = $('#history');
  const q = query.trim().toLowerCase();
  const history = (await getHistory()).filter(
    (h) => !q || h.pageTitle.toLowerCase().includes(q) || h.site.toLowerCase().includes(q) || h.url.toLowerCase().includes(q),
  );
  container.replaceChildren();

  if (history.length === 0) {
    const div = document.createElement('div');
    div.className = 'history__empty';
    div.textContent = q ? 'No scans match your search.' : 'No scans recorded yet.';
    container.appendChild(div);
    return;
  }

  for (const h of history.slice(0, 60)) {
    const row = document.createElement('div');
    row.className = 'history__item';

    const score = document.createElement('span');
    score.className = 'history__score';
    score.style.color = scoreColor(h.trustIndex);
    score.textContent = String(h.trustIndex);

    const name = document.createElement('span');
    name.className = 'history__name';
    const link = document.createElement('a');
    link.href = h.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = h.pageTitle || h.url;
    name.appendChild(link);

    const meta = document.createElement('span');
    meta.className = 'history__meta';
    meta.textContent = `${h.site} · ${h.reviewCount} reviews · ${h.warningCount} warnings · ${formatWhen(h.scannedAt)}`;

    row.append(score, name, meta);
    container.appendChild(row);
  }
}

function bindDataTools(): void {
  $('#export-settings').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'verireview-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
  });

  const fileInput = $<HTMLInputElement>('#import-file');
  $('#import-settings').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then(async (text) => {
      try {
        const parsed = JSON.parse(text) as Partial<Settings>;
        settings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          enabledSites: { ...DEFAULT_SETTINGS.enabledSites, ...parsed.enabledSites },
        };
        await saveSettings(settings);
        bindControls();
        flashSaved('Settings imported ✓');
      } catch {
        flashSaved('Import failed — not a valid settings file');
      }
      fileInput.value = '';
    });
  });

  $('#clear-cache').addEventListener('click', () => {
    void clearAllData().then(() => {
      void renderHistory();
      flashSaved('Cache & history cleared ✓');
    });
  });

  $<HTMLInputElement>('#history-search').addEventListener('input', (e) => {
    void renderHistory((e.target as HTMLInputElement).value);
  });
}

void (async () => {
  settings = await getSettings();
  bindControls();
  bindDataTools();
  await renderHistory();
})();
