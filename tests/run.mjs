/**
 * Test harness: bundles the extension's TypeScript modules with esbuild into
 * tests/.build/, then runs every tests/*.test.mjs with the built-in node:test
 * runner. Zero test-framework dependencies (jsdom only, for DOM fixtures).
 *
 * Usage: npm test
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tests/.build');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: {
    utils: path.join(root, 'src/utils/index.ts'),
    google: path.join(root, 'src/sites/google.ts'),
    amazon: path.join(root, 'src/sites/amazon.ts'),
    detector: path.join(root, 'src/sites/detector.ts'),
    model: path.join(root, 'src/analysis/model.ts'),
    engine: path.join(root, 'src/analysis/engine.ts'),
    charts: path.join(root, 'src/ui/charts.ts'),
    highlighter: path.join(root, 'src/content/highlighter.ts'),
  },
  outdir: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const testFiles = readdirSync(path.join(root, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => path.join('tests', f));

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
