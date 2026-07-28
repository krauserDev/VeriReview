/**
 * Dependency-free brand asset generator for VeriReview.
 *
 * Renders the extension icons (16/32/48/128) and the Chrome Web Store
 * promotional tile (440x280) from vector primitives, supersampled for smooth
 * edges and encoded to PNG with only node:zlib. Run: `npm run icons`.
 *
 * Design: warm-ink rounded badge with a gold "V" monogram (VeriReview),
 * deliberately unlike the shield+checkmark used by every competitor.
 */
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/* ---------- palette (matches the forensic-dossier UI theme) ---------- */
const INK_TOP = [31, 28, 23];
const INK_BOT = [17, 15, 12];
const GOLD = [212, 160, 44];
const GOLD_HI = [236, 194, 96];
const CREAM = [242, 239, 231];
const INK_ON_GOLD = [26, 22, 16];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* ---------- canvas (float RGBA, straight alpha, over transparent) ---------- */
function makeCanvas(w, h, S) {
  return { w, h, S, W: w * S, H: h * S, buf: new Float32Array(w * S * h * S * 4) };
}

// Fill target-space rect region; colorFn(tx,ty) -> [r,g,b,a] or null.
function fill(cv, x0, y0, x1, y1, colorFn) {
  const { S, W, H, buf } = cv;
  const px0 = Math.max(0, Math.floor(x0 * S));
  const px1 = Math.min(W, Math.ceil(x1 * S));
  const py0 = Math.max(0, Math.floor(y0 * S));
  const py1 = Math.min(H, Math.ceil(y1 * S));
  for (let py = py0; py < py1; py++) {
    const ty = (py + 0.5) / S;
    for (let px = px0; px < px1; px++) {
      const tx = (px + 0.5) / S;
      const c = colorFn(tx, ty);
      if (!c) continue;
      const a = c[3];
      const i = (py * W + px) * 4;
      buf[i] = buf[i] * (1 - a) + c[0] * a;
      buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
      buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
      buf[i + 3] = buf[i + 3] * (1 - a) + a;
    }
  }
}

/* ---------- geometry helpers ---------- */
function roundRectInside(tx, ty, x, y, w, h, r) {
  const rx = Math.min(r, w / 2);
  const ry = Math.min(r, h / 2);
  if (tx < x || tx > x + w || ty < y || ty > y + h) return false;
  const cx = tx < x + rx ? x + rx : tx > x + w - rx ? x + w - rx : tx;
  const cy = ty < y + ry ? y + ry : ty > y + h - ry ? y + h - ry : ty;
  const dx = (tx - cx) / rx;
  const dy = (ty - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// Draw a rounded-rect background with a vertical gradient.
function drawBadge(cv, x, y, w, h, r, top, bot) {
  fill(cv, x, y, x + w, y + h, (tx, ty) => {
    if (!roundRectInside(tx, ty, x, y, w, h, r)) return null;
    const t = (ty - y) / h;
    const c = mix(top, bot, t);
    return [c[0], c[1], c[2], 1];
  });
}

// Draw a "V" from two thick round-capped strokes across box (x,y,w,h).
function drawV(cv, x, y, w, h, thickness, colTop, colBot) {
  const apexX = x + w / 2;
  const apexY = y + h;
  const lTopX = x;
  const rTopX = x + w;
  const topY = y;
  const rad = thickness / 2;
  fill(cv, x - rad, y - rad, x + w + rad, y + h + rad, (tx, ty) => {
    const d = Math.min(
      distToSeg(tx, ty, lTopX, topY, apexX, apexY),
      distToSeg(tx, ty, rTopX, topY, apexX, apexY),
    );
    if (d > rad) return null;
    const c = mix(colTop, colBot, (ty - y) / h);
    return [c[0], c[1], c[2], 1];
  });
}

// Draw a thin inset hairline border (dossier detail).
function drawHairline(cv, x, y, w, h, r, col, weight, alpha) {
  fill(cv, x, y, x + w, y + h, (tx, ty) => {
    const outside = roundRectInside(tx, ty, x, y, w, h, r);
    const inside = roundRectInside(tx, ty, x + weight, y + weight, w - 2 * weight, h - 2 * weight, r - weight);
    if (outside && !inside) return [col[0], col[1], col[2], alpha];
    return null;
  });
}

/* ---------- vector glyphs (uppercase, geometric) for the wordmark ---------- */
// strokes in normalized 0..1 coords (y down); [ax,ay,bx,by]
const GLYPHS = {
  V: { adv: 0.66, s: [[0, 0, 0.5, 1], [1, 0, 0.5, 1]] },
  E: { adv: 0.62, s: [[0, 0, 0, 1], [0, 0, 0.82, 0], [0, 0.5, 0.66, 0.5], [0, 1, 0.82, 1]] },
  R: {
    adv: 0.64,
    s: [[0, 0, 0, 1], [0, 0, 0.7, 0], [0.7, 0, 0.7, 0.46], [0.7, 0.46, 0, 0.46], [0.3, 0.46, 0.8, 1]],
  },
  I: { adv: 0.3, s: [[0.5, 0, 0.5, 1]] },
  W: { adv: 0.98, s: [[0, 0, 0.22, 1], [0.22, 1, 0.5, 0.34], [0.5, 0.34, 0.78, 1], [0.78, 1, 1, 0]] },
};

const GAP = 0.16; // inter-letter gap, in glyph-height units

function drawGlyph(cv, ch, x, y, gw, gh, thickness, col) {
  const g = GLYPHS[ch];
  const rad = thickness / 2;
  fill(cv, x - rad, y - rad, x + gw + rad, y + gh + rad, (tx, ty) => {
    let d = Infinity;
    for (const [ax, ay, bx, by] of g.s) {
      d = Math.min(d, distToSeg(tx, ty, x + ax * gw, y + ay * gh, x + bx * gw, y + by * gh));
      if (d <= rad) break;
    }
    if (d > rad) return null;
    return [col[0], col[1], col[2], 1];
  });
}

// Render a word; letters colored per `colors` array (index-matched, fallback last).
function drawWord(cv, word, x, y, gh, colors) {
  const thickness = 0.16 * gh;
  const gap = GAP * gh;
  let cx = x;
  [...word].forEach((ch, i) => {
    const w = GLYPHS[ch].adv * gh;
    drawGlyph(cv, ch, cx, y, w, gh, thickness, colors[Math.min(i, colors.length - 1)]);
    cx += w + gap;
  });
  return cx - gap - x; // total width
}

function measureWord(word, gh) {
  const gap = GAP * gh;
  let cx = 0;
  for (const ch of word) cx += GLYPHS[ch].adv * gh + gap;
  return cx - gap;
}

/* ---------- downsample (premultiplied) + PNG encode ---------- */
function downsample(cv) {
  const { w, h, S, W, buf } = cv;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let pr = 0, pg = 0, pb = 0, pa = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = ((y * S + sy) * W + (x * S + sx)) * 4;
          const a = buf[i + 3];
          pr += buf[i] * a;
          pg += buf[i + 1] * a;
          pb += buf[i + 2] * a;
          pa += a;
        }
      }
      const o = (y * w + x) * 4;
      if (pa > 0) {
        out[o] = Math.round(pr / pa);
        out[o + 1] = Math.round(pg / pa);
        out[o + 2] = Math.round(pb / pa);
      }
      out[o + 3] = Math.round((pa / (S * S)) * 255);
    }
  }
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- compositions ---------- */
function renderIcon(size) {
  const S = size >= 96 ? 8 : 16; // heavier supersample for the tiny icons
  const cv = makeCanvas(size, size, S);
  const u = size / 128; // scale everything from a 128 reference
  const r = 27 * u;
  drawBadge(cv, 0, 0, size, size, r, INK_TOP, INK_BOT);
  drawHairline(cv, 6 * u, 6 * u, size - 12 * u, size - 12 * u, r - 5 * u, GOLD, Math.max(1, 2 * u), 0.35);
  // monogram V
  drawV(cv, 34 * u, 33 * u, 60 * u, 58 * u, 15 * u, GOLD_HI, GOLD);
  // baseline bar (monospace/verify cue)
  fill(cv, 46 * u, 101 * u, 82 * u, 108 * u, (tx, ty) =>
    roundRectInside(tx, ty, 46 * u, 101 * u, 36 * u, 7 * u, 3.5 * u) ? [GOLD[0], GOLD[1], GOLD[2], 1] : null,
  );
  return encodePNG(size, size, downsample(cv));
}

function renderTile() {
  const W = 440, H = 280, S = 4;
  const cv = makeCanvas(W, H, S);
  // diagonal ink background
  fill(cv, 0, 0, W, H, (tx, ty) => {
    const t = (tx / W) * 0.5 + (ty / H) * 0.5;
    const c = mix(INK_TOP, INK_BOT, t);
    return [c[0], c[1], c[2], 1];
  });
  // faint gold hairline frame
  drawHairline(cv, 14, 14, W - 28, H - 28, 14, GOLD, 2, 0.22);

  // left badge with gold fill + ink V
  const bx = 34, by = 70, bs = 140;
  drawBadge(cv, bx, by, bs, bs, 30, GOLD_HI, GOLD);
  drawV(cv, bx + 32, by + 34, bs - 64, bs - 66, 17, INK_ON_GOLD, INK_ON_GOLD);
  fill(cv, bx + 50, by + 104, bx + 90, by + 113, (tx, ty) =>
    roundRectInside(tx, ty, bx + 50, by + 104, 40, 9, 4.5) ? [INK_ON_GOLD[0], INK_ON_GOLD[1], INK_ON_GOLD[2], 1] : null,
  );

  // stacked wordmark lockup: gold "VERI" over cream "REVIEW", auto-scaled to fit
  const wx = 200;
  const avail = W - wx - 26;
  const gh = Math.min(46, avail / (measureWord('REVIEW', 1) )); // scale so REVIEW fits
  const lineGap = 0.28 * gh;
  const blockH = gh * 2 + lineGap;
  const y0 = (H - blockH) / 2;
  drawWord(cv, 'VERI', wx, y0, gh, [GOLD_HI]);
  const wReview = drawWord(cv, 'REVIEW', wx, y0 + gh + lineGap, gh, [CREAM]);
  // thin gold rule under the lockup
  const ry = y0 + blockH + 12;
  fill(cv, wx, ry, wx + wReview, ry + 3, () => [GOLD[0], GOLD[1], GOLD[2], 0.75]);
  return encodePNG(W, H, downsample(cv));
}

/* ---------- write ---------- */
const iconsDir = path.join(root, 'public', 'icons');
const storeDir = path.join(root, 'store-assets');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(storeDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  writeFileSync(path.join(iconsDir, `icon${size}.png`), renderIcon(size));
  console.log(`icon${size}.png`);
}
writeFileSync(path.join(storeDir, 'promo-tile-440x280.png'), renderTile());
console.log('promo-tile-440x280.png');
console.log('done');
