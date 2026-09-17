// Generates the PWA icons from the Beta palette (SPEC.md §4) with no image
// dependency: a hand-rolled PNG encoder over zlib.
//
//   node scripts/generate-icons.mjs
//
// The mark is an amber ring on pure black — the "next up" dot of the Today
// screen, which is the one thing the app is about.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');

const BASE = [0x00, 0x00, 0x00];
const ACCENT = [0xff, 0xb3, 0x40];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {(x: number, y: number) => [number, number, number]} shade */
function encodePng(size, shade) {
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = shade(x, y);
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Anti-aliased amber ring, centred, on black. `inset` leaves PWA safe padding. */
function ringShader(size, { inset = 0 } = {}) {
  const c = (size - 1) / 2;
  const outer = (size / 2) * (1 - inset) * 0.78;
  const inner = outer * 0.52;
  const feather = Math.max(size / 128, 0.6);

  return (x, y) => {
    const d = Math.hypot(x - c, y - c);
    // 1 inside the ring band, 0 outside, smoothed at both edges.
    const a =
      Math.min(1, Math.max(0, (outer - d) / feather)) *
      Math.min(1, Math.max(0, (d - inner) / feather));
    if (a <= 0) return BASE;
    if (a >= 1) return ACCENT;
    return [
      Math.round(BASE[0] + (ACCENT[0] - BASE[0]) * a),
      Math.round(BASE[1] + (ACCENT[1] - BASE[1]) * a),
      Math.round(BASE[2] + (ACCENT[2] - BASE[2]) * a),
    ];
  };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const { name, size, inset } of [
  { name: 'icon-180.png', size: 180, inset: 0.04 },
  { name: 'icon-192.png', size: 192, inset: 0.04 },
  { name: 'icon-512.png', size: 512, inset: 0.04 },
  // Maskable icons are cropped to a circle by Android, so the mark sits smaller.
  { name: 'icon-maskable-512.png', size: 512, inset: 0.2 },
]) {
  const png = encodePng(size, ringShader(size, { inset }));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote ${name} (${size}px, ${png.length} bytes)`);
}
