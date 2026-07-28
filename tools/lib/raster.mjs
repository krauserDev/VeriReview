/**
 * Dependency-free 2D rasterizer shared by the brand-asset generators.
 *
 * Provides an RGBA float canvas, analytic anti-aliased shape/stroke drawing,
 * a geometric stroke font, PNG encode/decode (node:zlib only) and image
 * scaling. Used by tools/icons (supersampled) and tools/screenshots (analytic).
 */
import zlib from 'node:zlib';

/* ------------------------------- color ---------------------------------- */
export const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* ------------------------------- canvas --------------------------------- */
/** Float RGBA canvas. `S` is the supersample factor (1 = analytic AA). */
export function makeCanvas(w, h, S = 1) {
  return { w, h, S, W: w * S, H: h * S, buf: new Float32Array(w * S * h * S * 4) };
}

function blend(buf, i, c, a) {
  if (a <= 0) return;
  buf[i] = buf[i] * (1 - a) + c[0] * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
  buf[i + 3] = buf[i + 3] * (1 - a) + a;
}

/** Hard-edged fill; colorFn(tx,ty) -> [r,g,b,a] | null. Relies on supersampling. */
export function fill(cv, x0, y0, x1, y1, colorFn) {
  const { S, W, H, buf } = cv;
  const px0 = Math.max(0, Math.floor(x0 * S));
  const px1 = Math.min(W, Math.ceil(x1 * S));
  const py0 = Math.max(0, Math.floor(y0 * S));
  const py1 = Math.min(H, Math.ceil(y1 * S));
  for (let py = py0; py < py1; py++) {
    const ty = (py + 0.5) / S;
    for (let px = px0; px < px1; px++) {
      const c = colorFn((px + 0.5) / S, ty);
      if (c) blend(buf, (py * W + px) * 4, c, c[3]);
    }
  }
}

/**
 * Anti-aliased fill from a signed distance function (negative = inside).
 * Coverage is derived analytically, so it looks clean at S = 1.
 */
export function fillSDF(cv, x0, y0, x1, y1, sdf, colorFn, alpha = 1) {
  const { S, W, H, buf } = cv;
  const px0 = Math.max(0, Math.floor(x0 * S));
  const px1 = Math.min(W, Math.ceil(x1 * S));
  const py0 = Math.max(0, Math.floor(y0 * S));
  const py1 = Math.min(H, Math.ceil(y1 * S));
  for (let py = py0; py < py1; py++) {
    const ty = (py + 0.5) / S;
    for (let px = px0; px < px1; px++) {
      const tx = (px + 0.5) / S;
      const d = sdf(tx, ty);
      const cov = Math.min(1, Math.max(0, 0.5 - d * S));
      if (cov <= 0) continue;
      const c = colorFn(tx, ty);
      if (c) blend(buf, (py * W + px) * 4, c, cov * alpha * (c[3] ?? 1));
    }
  }
}

/* ------------------------------ geometry -------------------------------- */
export function distToSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Signed distance to a rounded box (negative inside). */
export function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2, cy = y + h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  const qx = Math.abs(px - cx) - (w / 2 - rr);
  const qy = Math.abs(py - cy) - (h / 2 - rr);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - rr;
}

/** Boolean rounded-rect test (for hard-edged, supersampled drawing). */
export function roundRectInside(tx, ty, x, y, w, h, r) {
  return sdRoundRect(tx, ty, x, y, w, h, r) <= 0;
}

/** Anti-aliased rounded rectangle. */
export function rrect(cv, x, y, w, h, r, colorFn, alpha = 1) {
  const fn = typeof colorFn === 'function' ? colorFn : () => colorFn;
  fillSDF(cv, x - 2, y - 2, x + w + 2, y + h + 2, (tx, ty) => sdRoundRect(tx, ty, x, y, w, h, r), fn, alpha);
}

/** Anti-aliased rounded-rect outline of the given weight. */
export function rrectOutline(cv, x, y, w, h, r, col, weight = 1, alpha = 1) {
  fillSDF(
    cv, x - weight - 2, y - weight - 2, x + w + weight + 2, y + h + weight + 2,
    (tx, ty) => Math.abs(sdRoundRect(tx, ty, x, y, w, h, r)) - weight / 2,
    () => col, alpha,
  );
}

/** Anti-aliased round-capped polyline stroke. */
export function stroke(cv, pts, thickness, col, alpha = 1) {
  const rad = thickness / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  fillSDF(
    cv, minX - rad - 2, minY - rad - 2, maxX + rad + 2, maxY + rad + 2,
    (tx, ty) => {
      let d = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        d = Math.min(d, distToSeg(tx, ty, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
        if (d <= 0) break;
      }
      return d - rad;
    },
    () => col, alpha,
  );
}

/* -------------------------------- font ---------------------------------- */
/**
 * Geometric mono-line uppercase font. Each glyph is a list of polylines in a
 * normalized box (x: 0..1 scaled by `adv`, y: 0..1 top-to-bottom).
 */
const E2 = [[0.5, 0.5], [0.52, 0.5]]; // dot helper
export const FONT = {
  ' ': { adv: 0.34, p: [] },
  A: { adv: 0.70, p: [[[0, 1], [0.5, 0], [1, 1]], [[0.18, 0.66], [0.82, 0.66]]] },
  B: { adv: 0.66, p: [[[0, 0], [0, 1]], [[0, 0], [0.66, 0], [0.86, 0.16], [0.86, 0.32], [0.66, 0.48], [0, 0.48]], [[0.66, 0.48], [0.9, 0.64], [0.9, 0.84], [0.68, 1], [0, 1]]] },
  C: { adv: 0.68, p: [[[0.95, 0.19], [0.75, 0.03], [0.42, 0], [0.14, 0.18], [0.03, 0.5], [0.14, 0.82], [0.42, 1], [0.75, 0.97], [0.95, 0.81]]] },
  D: { adv: 0.68, p: [[[0, 0], [0, 1]], [[0, 0], [0.54, 0], [0.9, 0.26], [0.9, 0.74], [0.54, 1], [0, 1]]] },
  E: { adv: 0.60, p: [[[0, 0], [0, 1]], [[0, 0], [0.84, 0]], [[0, 0.49], [0.66, 0.49]], [[0, 1], [0.84, 1]]] },
  F: { adv: 0.58, p: [[[0, 0], [0, 1]], [[0, 0], [0.84, 0]], [[0, 0.49], [0.66, 0.49]]] },
  G: { adv: 0.72, p: [[[0.95, 0.19], [0.75, 0.03], [0.42, 0], [0.14, 0.18], [0.03, 0.5], [0.14, 0.82], [0.42, 1], [0.75, 0.97], [0.95, 0.8], [0.95, 0.54]], [[0.62, 0.54], [0.98, 0.54]]] },
  H: { adv: 0.68, p: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]] },
  I: { adv: 0.28, p: [[[0.5, 0], [0.5, 1]]] },
  J: { adv: 0.56, p: [[[0.86, 0], [0.86, 0.74], [0.68, 0.96], [0.34, 1], [0.08, 0.83]]] },
  K: { adv: 0.66, p: [[[0, 0], [0, 1]], [[0.95, 0], [0.1, 0.56]], [[0.36, 0.38], [1, 1]]] },
  L: { adv: 0.56, p: [[[0, 0], [0, 1], [0.86, 1]]] },
  M: { adv: 0.86, p: [[[0, 1], [0, 0], [0.5, 0.62], [1, 0], [1, 1]]] },
  N: { adv: 0.70, p: [[[0, 1], [0, 0], [1, 1], [1, 0]]] },
  O: { adv: 0.76, p: [[[0.5, 0], [0.19, 0.11], [0.02, 0.4], [0.02, 0.6], [0.19, 0.89], [0.5, 1], [0.81, 0.89], [0.98, 0.6], [0.98, 0.4], [0.81, 0.11], [0.5, 0]]] },
  P: { adv: 0.62, p: [[[0, 0], [0, 1]], [[0, 0], [0.68, 0], [0.9, 0.2], [0.9, 0.38], [0.68, 0.57], [0, 0.57]]] },
  Q: { adv: 0.76, p: [[[0.5, 0], [0.19, 0.11], [0.02, 0.4], [0.02, 0.6], [0.19, 0.89], [0.5, 1], [0.81, 0.89], [0.98, 0.6], [0.98, 0.4], [0.81, 0.11], [0.5, 0]], [[0.62, 0.72], [1, 1.06]]] },
  R: { adv: 0.66, p: [[[0, 0], [0, 1]], [[0, 0], [0.68, 0], [0.9, 0.2], [0.9, 0.38], [0.68, 0.57], [0, 0.57]], [[0.42, 0.57], [0.98, 1]]] },
  S: { adv: 0.64, p: [[[0.94, 0.16], [0.72, 0.01], [0.3, 0], [0.06, 0.16], [0.06, 0.35], [0.3, 0.47], [0.7, 0.53], [0.94, 0.66], [0.94, 0.85], [0.68, 1], [0.26, 0.99], [0.04, 0.84]]] },
  T: { adv: 0.62, p: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]] },
  U: { adv: 0.68, p: [[[0, 0], [0, 0.72], [0.2, 0.96], [0.8, 0.96], [1, 0.72], [1, 0]]] },
  V: { adv: 0.66, p: [[[0, 0], [0.5, 1], [1, 0]]] },
  W: { adv: 0.98, p: [[[0, 0], [0.22, 1], [0.5, 0.34], [0.78, 1], [1, 0]]] },
  X: { adv: 0.66, p: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]] },
  Y: { adv: 0.64, p: [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]] },
  Z: { adv: 0.62, p: [[[0, 0], [1, 0], [0, 1], [1, 1]]] },
  0: { adv: 0.64, p: [[[0.5, 0], [0.16, 0.14], [0.03, 0.45], [0.03, 0.58], [0.16, 0.87], [0.5, 1], [0.84, 0.87], [0.97, 0.58], [0.97, 0.45], [0.84, 0.14], [0.5, 0]]] },
  1: { adv: 0.36, p: [[[0.1, 0.2], [0.55, 0.01], [0.55, 1]]] },
  2: { adv: 0.62, p: [[[0.05, 0.19], [0.26, 0.01], [0.64, 0.01], [0.88, 0.2], [0.86, 0.4], [0.04, 1], [0.94, 1]]] },
  3: { adv: 0.62, p: [[[0.07, 0.04], [0.8, 0.04], [0.4, 0.44]], [[0.4, 0.44], [0.74, 0.46], [0.92, 0.64], [0.9, 0.84], [0.66, 1], [0.26, 0.99], [0.05, 0.85]]] },
  4: { adv: 0.66, p: [[[0.74, 0], [0.06, 0.71], [0.99, 0.71]], [[0.74, 0], [0.74, 1]]] },
  5: { adv: 0.62, p: [[[0.9, 0.02], [0.16, 0.02], [0.1, 0.44], [0.5, 0.37], [0.84, 0.5], [0.9, 0.72], [0.72, 0.96], [0.3, 1], [0.07, 0.85]]] },
  6: { adv: 0.64, p: [[[0.88, 0.06], [0.5, 0], [0.16, 0.2], [0.05, 0.55], [0.06, 0.8], [0.3, 1], [0.62, 1], [0.9, 0.82], [0.92, 0.62], [0.7, 0.45], [0.36, 0.45], [0.08, 0.62]]] },
  7: { adv: 0.60, p: [[[0.03, 0], [0.95, 0], [0.38, 1]]] },
  8: { adv: 0.64, p: [[[0.5, 0.46], [0.2, 0.35], [0.12, 0.19], [0.3, 0.02], [0.68, 0.02], [0.86, 0.19], [0.78, 0.35], [0.5, 0.46], [0.18, 0.58], [0.06, 0.78], [0.26, 0.99], [0.72, 0.99], [0.92, 0.78], [0.8, 0.58], [0.5, 0.46]]] },
  9: { adv: 0.64, p: [[[0.1, 0.94], [0.48, 1], [0.82, 0.8], [0.93, 0.45], [0.92, 0.2], [0.68, 0], [0.36, 0], [0.08, 0.18], [0.06, 0.38], [0.28, 0.55], [0.62, 0.55], [0.9, 0.38]]] },
  '-': { adv: 0.44, p: [[[0.08, 0.56], [0.92, 0.56]]] },
  '—': { adv: 0.92, p: [[[0, 0.56], [1, 0.56]]] },
  '.': { adv: 0.28, p: [[[0.5, 0.98], [0.52, 0.98]]] },
  ',': { adv: 0.28, p: [[[0.56, 0.9], [0.34, 1.14]]] },
  ':': { adv: 0.28, p: [[[0.5, 0.34], [0.52, 0.34]], [[0.5, 0.98], [0.52, 0.98]]] },
  "'": { adv: 0.26, p: [[[0.5, 0.02], [0.5, 0.26]]] },
  '/': { adv: 0.52, p: [[[0.9, 0], [0.1, 1]]] },
  '+': { adv: 0.60, p: [[[0.5, 0.22], [0.5, 0.86]], [[0.18, 0.54], [0.82, 0.54]]] },
  '?': { adv: 0.58, p: [[[0.08, 0.2], [0.28, 0.02], [0.66, 0.02], [0.86, 0.2], [0.84, 0.38], [0.5, 0.55], [0.5, 0.68]], [[0.5, 0.98], [0.52, 0.98]]] },
};

const TRACK = 0.17; // inter-letter gap in glyph-height units

const glyph = (ch) => FONT[ch] ?? FONT[ch?.toUpperCase?.()] ?? FONT['?'];

export function measureText(text, gh, track = TRACK) {
  let x = 0;
  for (const ch of text) x += glyph(ch).adv * gh + track * gh;
  return Math.max(0, x - track * gh);
}

/** Draw `text` with its top-left at (x,y); returns the advance width. */
export function drawText(cv, text, x, y, gh, col, { weight = 0.15, track = TRACK, alpha = 1 } = {}) {
  const th = weight * gh;
  let cx = x;
  for (const ch of text) {
    const g = glyph(ch);
    const gw = g.adv * gh;
    for (const poly of g.p) {
      const pts = poly.map(([px, py]) => [cx + px * gw, y + py * gh]);
      stroke(cv, pts.length === 1 ? [...pts, pts[0]] : pts, th, col, alpha);
    }
    cx += gw + track * gh;
  }
  return cx - track * gh - x;
}

/* ------------------------------ resample -------------------------------- */
export function downsample(cv) {
  const { w, h, S, W, buf } = cv;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let pr = 0, pg = 0, pb = 0, pa = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const i = ((y * S + sy) * W + (x * S + sx)) * 4;
          const a = buf[i + 3];
          pr += buf[i] * a; pg += buf[i + 1] * a; pb += buf[i + 2] * a; pa += a;
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

/** Area-average resample of an {w,h,data} RGBA image to dw x dh. */
export function resizeImage(img, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const sx = img.w / dw, sy = img.h / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.min(img.h, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.min(img.w, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.w + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3]; n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return { w: dw, h: dh, data: out };
}

/** Blit an image into the canvas (S must be 1), clipped to a rounded rect. */
export function drawImage(cv, img, dx, dy, radius = 0) {
  const { W, H, buf } = cv;
  for (let y = 0; y < img.h; y++) {
    const py = dy + y;
    if (py < 0 || py >= H) continue;
    for (let x = 0; x < img.w; x++) {
      const px = dx + x;
      if (px < 0 || px >= W) continue;
      let cov = 1;
      if (radius > 0) {
        const d = sdRoundRect(px + 0.5, py + 0.5, dx, dy, img.w, img.h, radius);
        cov = Math.min(1, Math.max(0, 0.5 - d));
        if (cov <= 0) continue;
      }
      const i = (y * img.w + x) * 4;
      const a = (img.data[i + 3] / 255) * cov;
      blend(buf, (py * W + px) * 4, [img.data[i], img.data[i + 1], img.data[i + 2]], a);
    }
  }
}

/* --------------------------------- PNG ---------------------------------- */
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

export function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode an 8-bit non-interlaced RGB/RGBA/gray PNG to {w,h,data(RGBA)}. */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (need 8) — re-save the image as a standard 8-bit PNG`);
  if (interlace) throw new Error('interlaced PNGs are not supported — re-save without interlacing');
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!CH) throw new Error(`unsupported PNG color type ${ctype}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * CH;
  const lines = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const cur = raw.subarray(rp, rp + stride); rp += stride;
    const off = y * stride, prev = off - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= CH ? lines[off + i - CH] : 0;
      const b = y > 0 ? lines[prev + i] : 0;
      const c = y > 0 && i >= CH ? lines[prev + i - CH] : 0;
      let v = cur[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      lines[off + i] = v & 0xff;
    }
  }

  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * CH, o = i * 4;
    if (ctype === 6) { out[o] = lines[s]; out[o + 1] = lines[s + 1]; out[o + 2] = lines[s + 2]; out[o + 3] = lines[s + 3]; }
    else if (ctype === 2) { out[o] = lines[s]; out[o + 1] = lines[s + 1]; out[o + 2] = lines[s + 2]; out[o + 3] = 255; }
    else if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = lines[s]; out[o + 3] = 255; }
    else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = lines[s]; out[o + 3] = lines[s + 1]; }
    else if (ctype === 3) {
      const idx = lines[s];
      out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
      out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { w, h, data: out };
}
