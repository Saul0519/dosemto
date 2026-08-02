// Renders the demo artwork shown on the home page.
//
// The point of the image is honesty: it is produced by the same two rules the
// order studio applies — draw at tile resolution, then snap every pixel to the
// nearest colour in public/Dose.gpl. Nothing here is hand-retouched.
//
//   node scripts/build-artwork.mjs
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const TILE = 32;
const TILES_X = 5;
const TILES_Y = 3;
const W = TILE * TILES_X; // 160
const H = TILE * TILES_Y; // 96

/* ---------------------------------------------------------------- palette */

const palette = (() => {
  const seen = new Set();
  const out = [];
  for (const line of readFileSync("public/Dose.gpl", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)/);
    if (!m) continue;
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    const key = rgb.join();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rgb);
  }
  return out;
})();

// Same weighting as app/pixel-order-studio.tsx so the demo matches the product.
function snap(r, g, b) {
  let best = palette[0];
  let bestDistance = Infinity;
  for (const c of palette) {
    const dr = r - c[0];
    const dg = g - c[1];
    const db = b - c[2];
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ scene */

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Deterministic value noise — no Math.random, so the file is reproducible.
function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

const HORIZON = Math.round(H * 0.56);
const SUN = { x: W * 0.68, y: HORIZON - 15, r: 9.5 };

function ridge(x, seed, amplitude, base) {
  const a = Math.sin(x * 0.11 + seed) * amplitude;
  const b = Math.sin(x * 0.041 + seed * 2.3) * amplitude * 0.75;
  return Math.round(base + a + b);
}

// Everything above the waterline. Kept separate so the reflection can sample it
// without recursing back into itself.
function above(x, y) {
  const t = Math.max(0, Math.min(1, y / HORIZON));
  const sky =
    t < 0.62
      ? mix([46, 34, 74], [196, 92, 104], t / 0.62)
      : mix([196, 92, 104], [246, 176, 96], (t - 0.62) / 0.38);

  const d = Math.hypot(x - SUN.x, y - SUN.y);
  if (d < SUN.r) return [252, 236, 176];
  if (d < SUN.r + 3) return mix([250, 208, 130], sky, (d - SUN.r) / 3);

  // Far ridge, then a nearer darker one.
  if (y > ridge(x, 1.2, 4.5, HORIZON - 13)) {
    return mix([84, 56, 96], [58, 40, 74], Math.min(1, (y - HORIZON + 13) / 13));
  }
  if (y > ridge(x, 4.8, 3.0, HORIZON - 7)) return [44, 32, 58];
  return sky;
}

function scene(x, y) {
  if (y < HORIZON) return above(x, y);

  // Water: the sky flipped, banded into horizontal ripples.
  const depth = (y - HORIZON) / (H - HORIZON);
  const mirrored = above(x, Math.max(0, HORIZON - 1 - (y - HORIZON) * 1.35));
  const water = mix(mirrored, [26, 38, 78], 0.45 + depth * 0.4);
  const ripple = Math.sin(y * 1.9 + Math.sin(x * 0.3) * 1.7) > 0.45 ? 16 : 0;
  const grain = (hash(x, y) - 0.5) * 10;
  return water.map((v) => v + ripple + grain);
}

/* -------------------------------------------------------------------- png */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none — the image is tiny and already flat
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[p++] = rgb[i];
      raw[p++] = rgb[i + 1];
      raw[p++] = rgb[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------- main */

const source = new Uint8Array(W * H * 3);
const converted = new Uint8Array(W * H * 3);
const used = new Set();

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const [r, g, b] = scene(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v))));
    source[i] = r;
    source[i + 1] = g;
    source[i + 2] = b;
    const [pr, pg, pb] = snap(r, g, b);
    converted[i] = pr;
    converted[i + 1] = pg;
    converted[i + 2] = pb;
    used.add(`${pr},${pg},${pb}`);
  }
}

// Only the converted file is written. Nothing that ships in public/ may contain
// a colour the painter cannot mix in game.
mkdirSync("public/art", { recursive: true });
const bytes = encodePng(W, H, converted);
writeFileSync("public/art/demo-converted.png", bytes);

const offPalette = [...used].filter((key) => !palette.some((c) => c.join() === key));
if (offPalette.length > 0) {
  throw new Error(`artwork contains ${offPalette.length} colours outside Dose.gpl`);
}

console.log(
  `${W}x${H} (${TILES_X}x${TILES_Y} tiles) · ${used.size} of ${palette.length} palette colours\n` +
    `  public/art/demo-converted.png ${bytes.length} B · 0 off-palette pixels`,
);
