/**
 * Build script — bundles TypeScript entry points with esbuild and copies
 * static assets (manifest, HTML, CSS, icons, locales) into dist/.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
mkdirSync(dist, { recursive: true });

const entries = {
  'background/service-worker': 'src/background/service-worker.ts',
  'content/content': 'src/content/index.ts',
  'popup/popup': 'src/popup/popup.ts',
  'options/options': 'src/options/options.ts',
  'report/report': 'src/report/report.ts',
};

await build({
  entryPoints: Object.fromEntries(
    Object.entries(entries).map(([out, src]) => [out, path.join(root, src)]),
  ),
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome110',
  sourcemap: false,
  minify: true,
  logLevel: 'info',
});

// Static assets
cpSync(path.join(root, 'public'), dist, { recursive: true });
for (const page of ['popup', 'options', 'report']) {
  for (const ext of ['html', 'css']) {
    const src = path.join(root, 'src', page, `${page}.${ext}`);
    if (existsSync(src)) cpSync(src, path.join(dist, page, `${page}.${ext}`));
  }
}
// Content-script CSS is injected as a raw file declared in the manifest.
cpSync(path.join(root, 'src/content/content.css'), path.join(dist, 'content/content.css'));

console.log('Build complete → dist/');
