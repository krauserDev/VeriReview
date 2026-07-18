/** Shared test helpers: jsdom setup for DOM-fixture tests. */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadFixture(name) {
  return readFileSync(path.join(here, 'fixtures', name), 'utf8');
}

/**
 * Run `fn(document)` with jsdom globals installed (document, HTMLElement…),
 * restoring the previous globals afterwards so tests stay isolated.
 */
export function withDom(html, fn, url = 'https://www.google.com/search?q=test') {
  const dom = new JSDOM(html, { url });
  const saved = {};
  const globalsToPatch = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'NodeFilter'];
  for (const key of globalsToPatch) {
    saved[key] = globalThis[key];
    globalThis[key] = dom.window[key] ?? dom.window;
  }
  globalThis.window = dom.window;
  try {
    return fn(dom.window.document);
  } finally {
    for (const key of globalsToPatch) globalThis[key] = saved[key];
  }
}
