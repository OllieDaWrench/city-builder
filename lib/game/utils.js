/* ===================== City Builder v2 — shared utils ===================== */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;

export function makeNoise(rng) {
  const size = 256;
  const perm = new Uint8Array(size * 2);
  const vals = new Float32Array(size);
  for (let i = 0; i < size; i++) { perm[i] = i; vals[i] = rng(); }
  for (let i = size - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < size; i++) perm[size + i] = perm[i];
  const val = (ix, iy) => vals[perm[(ix & 255) + perm[iy & 255]]];
  const smooth = (t) => t * t * (3 - 2 * t);
  return function fbm(x, y, oct) {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const a = val(ix, iy), b = val(ix + 1, iy), c = val(ix, iy + 1), d = val(ix + 1, iy + 1);
      const u = smooth(fx), v = smooth(fy);
      s += lerp(lerp(a, b, u), lerp(c, d, u), v) * amp;
      norm += amp; amp *= 0.5; f *= 2;
      x *= 2; y *= 2;
    }
    return s / norm;
  };
}

export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-US');

/* Bresenham line over tiles, inclusive of both ends. */
export function lineTiles(x0, y0, x1, y1, cb) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
