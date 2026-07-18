/** Settings persistence via chrome.storage.sync, with safe defaults. */
import { DEFAULT_SETTINGS, type Settings } from '../types/index.js';

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  try {
    const data = await chrome.storage.sync.get(KEY);
    const stored = (data[KEY] ?? {}) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      enabledSites: { ...DEFAULT_SETTINGS.enabledSites, ...stored.enabledSites },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: settings });
}

export function onSettingsChanged(cb: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) void getSettings().then(cb);
  });
}
