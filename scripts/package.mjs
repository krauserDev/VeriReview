/** Zips dist/ into release/verireview-vX.Y.Z.zip for Chrome Web Store upload. */
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
if (!existsSync(dist)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}
mkdirSync(path.join(root, 'release'), { recursive: true });
const out = path.join(root, 'release', `verireview-v${version}.zip`);
rmSync(out, { force: true }); // stale zips must never be re-uploaded by accident

if (process.platform === 'win32') {
  // `zip` does not exist on Windows; Compress-Archive ships with PowerShell.
  // dist\* (not dist) keeps the manifest at the zip root, as the Store requires.
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${dist}\\*' -DestinationPath '${out}' -Force`,
  ]);
} else {
  execFileSync('zip', ['-qr', out, '.'], { cwd: dist });
}
console.log(`Packaged → ${out}`);
