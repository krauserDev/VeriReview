/** Registry of supported sites. Add new adapters here. */
import type { SiteAdapter } from './adapter.js';
import { amazonAdapter } from './amazon.js';
import { googleAdapter } from './google.js';

export const ADAPTERS: SiteAdapter[] = [amazonAdapter, googleAdapter];

export function findAdapter(location: Location): SiteAdapter | null {
  return ADAPTERS.find((a) => a.matches(location)) ?? null;
}
