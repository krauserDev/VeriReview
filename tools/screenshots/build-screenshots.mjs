/**
 * Turns raw screen captures into Chrome Web Store screenshots (1280x800).
 *
 * Drop your own captures in store-assets/screenshots/raw/ named 1.png .. 4.png
 * (any size; PNG, 8-bit, non-interlaced) and run `npm run screenshots`. Each
 * one is scaled onto the brand background with a numbered step badge and a
 * caption, so the four together read as a short how-to-use tutorial.
 *
 * The captures must be REAL pages: the Chrome Web Store rejects mocked or
 * misleading screenshots, so this tool only frames what you actually captured.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeCanvas, fillSDF, rrect, rrectOutline, drawText, measureText,
  drawImage, resizeImage, decodePNG, encodePNG, downsample, mix,
} from '../lib/raster.mjs';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const rawDir = path.join(root, 'store-assets', 'screenshots', 'raw');
const outDir = path.join(root, 'store-assets', 'screenshots');

const W = 1280, H = 800;
const INK_TOP = [31, 28, 23];
const INK_BOT = [17, 15, 12];
const GOLD = [212, 160, 44];
const GOLD_HI = [236, 194, 96];
const CREAM = [242, 239, 231];
const INK_ON_GOLD = [26, 22, 16];

/** The tutorial: one entry per screenshot, in order. */
const STEPS = [
  { n: '1', title: 'OPEN A PRODUCT OR PLACE PAGE', hint: 'AMAZON PRODUCT OR GOOGLE MAPS LISTING WITH REVIEWS' },
  { n: '2', title: 'RIGHT-CLICK ANYWHERE ON THE PAGE', hint: 'NOTHING RUNS UNTIL YOU ASK IT TO' },
  { n: '3', title: 'CHOOSE ANALYZE REVIEWS WITH VERIREVIEW', hint: 'OR CLICK THE TOOLBAR ICON, OR PRESS ALT+SHIFT+A' },
  { n: '4', title: 'READ THE TRUST INDEX AND THE SIGNALS', hint: 'EVERY VERDICT EXPLAINS WHY IT WAS FLAGGED' },
];

function background(cv) {
  fillSDF(cv, 0, 0, W, H, () => -1, (tx, ty) => {
    const c = mix(INK_TOP, INK_BOT, (tx / W) * 0.45 + (ty / H) * 0.55);
    return [c[0], c[1], c[2], 1];
  });
}

function header(cv, step) {
  const bx = 44, by = 32, bs = 58;
  rrect(cv, bx, by, bs, bs, 15, () => [GOLD_HI[0], GOLD_HI[1], GOLD_HI[2], 1]);
  // step number, centred in the badge
  const nh = 30;
  const nw = measureText(step.n, nh);
  drawText(cv, step.n, bx + (bs - nw) / 2, by + (bs - nh) / 2, nh, INK_ON_GOLD, { weight: 0.17 });

  // brand mark, right-aligned
  const bh = 15;
  const bw = measureText('VERIREVIEW', bh);
  drawText(cv, 'VERIREVIEW', W - 44 - bw, by + 8, bh, GOLD, { weight: 0.16, track: 0.3, alpha: 0.85 });

  // title, shrunk to fit the space left of the brand mark
  const tx = bx + bs + 22;
  const avail = W - 44 - bw - 28 - tx;
  let th = 30;
  while (th > 15 && measureText(step.title, th) > avail) th -= 1;
  drawText(cv, step.title, tx, by + 4, th, CREAM, { weight: 0.15 });
  if (step.hint) {
    let hh = 13;
    while (hh > 9 && measureText(step.hint, hh) > avail) hh -= 1;
    drawText(cv, step.hint, tx, by + 4 + th + 12, hh, GOLD, { weight: 0.17, alpha: 0.8 });
  }
}

function frameShot(cv, img) {
  const x0 = 44, y0 = 124, maxW = W - 88, maxH = H - y0 - 44;
  const scale = Math.min(maxW / img.w, maxH / img.h);
  const dw = Math.max(1, Math.round(img.w * scale));
  const dh = Math.max(1, Math.round(img.h * scale));
  const dx = Math.round(x0 + (maxW - dw) / 2);
  const dy = Math.round(y0 + (maxH - dh) / 2);
  const scaled = scale < 1 ? resizeImage(img, dw, dh) : img.w === dw ? img : resizeImage(img, dw, dh);
  drawImage(cv, scaled, dx, dy, 10);
  rrectOutline(cv, dx, dy, dw, dh, 10, GOLD, 2, 0.55);
}

function build(step, img) {
  const cv = makeCanvas(W, H, 1);
  background(cv);
  header(cv, step);
  frameShot(cv, img);
  return encodePNG(W, H, downsample(cv));
}

/* -------------------------------- run ----------------------------------- */
mkdirSync(rawDir, { recursive: true });
let made = 0;
const missing = [];

for (const [i, step] of STEPS.entries()) {
  const src = path.join(rawDir, `${i + 1}.png`);
  if (!existsSync(src)) { missing.push(`${i + 1}.png — ${step.title}`); continue; }
  let img;
  try {
    img = decodePNG(readFileSync(src));
  } catch (err) {
    console.error(`! ${path.basename(src)}: ${err.message}`);
    continue;
  }
  const out = path.join(outDir, `0${i + 1}-step.png`);
  writeFileSync(out, build(step, img));
  console.log(`${path.relative(root, out)}  (from ${img.w}x${img.h})`);
  made++;
}

if (missing.length) {
  console.log(`\nWaiting for ${missing.length} capture(s) in ${path.relative(root, rawDir)}/:`);
  for (const m of missing) console.log(`  - ${m}`);
}
console.log(`\n${made} screenshot(s) written to ${path.relative(root, outDir)}/`);
