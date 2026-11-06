// Draws the extension's icons into icons/, with no browser or image tools: a commit
// line with two bright commits, the span, between two dim ones.
//
//   node store-assets/render-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SAMPLES = 4;
const BACKGROUND = [15, 118, 110];
const WHITE = [255, 255, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc(typed));
  return Buffer.concat([length, typed, check]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const roundedSquare = (x, y, half, radius) => {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius <= 0;
};
const inCircle = (x, y, cy, radius) => Math.hypot(x, y - cy) <= radius;
const inLine = (x, y, y1, y2, half) => Math.abs(x) <= half && y >= y1 && y <= y2;

// Coordinates run from -1 to 1 across the artwork. Returns [colour, opacity].
function paint(x, y, small) {
  if (!roundedSquare(x, y, 1, 0.26)) return null;
  if (small) {
    // Only the span, so it stays crisp at 16 and 32 pixels.
    if (inLine(x, y, -0.45, 0.45, 0.13) || inCircle(x, y, -0.45, 0.28) || inCircle(x, y, 0.45, 0.28)) return [WHITE, 1];
    return [BACKGROUND, 1];
  }
  if (inCircle(x, y, -0.26, 0.17) || inCircle(x, y, 0.26, 0.17) || inLine(x, y, -0.26, 0.26, 0.075)) return [WHITE, 1];
  if (inCircle(x, y, -0.72, 0.12) || inCircle(x, y, 0.72, 0.12) || inLine(x, y, -0.72, 0.72, 0.045)) return [WHITE, 0.5];
  return [BACKGROUND, 1];
}

// The store's 128 pixel icon is 96 pixels of artwork with 16 pixels of clear padding.
function render(size, { padding = 0, small = false }) {
  const rgba = Buffer.alloc(size * size * 4);
  const art = size - padding * 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = ((px + (sx + 0.5) / SAMPLES - padding) / art) * 2 - 1;
          const y = ((py + (sy + 0.5) / SAMPLES - padding) / art) * 2 - 1;
          const hit = paint(x, y, small);
          if (!hit) continue;
          const [colour, opacity] = hit;
          const mixed = colour === WHITE && opacity < 1 ? BACKGROUND.map((c, i) => c + (WHITE[i] - c) * opacity) : colour;
          r += mixed[0];
          g += mixed[1];
          b += mixed[2];
          a += 1;
        }
      }
      if (!a) continue;
      rgba.set([r / a, g / a, b / a, (a / SAMPLES ** 2) * 255].map(Math.round), (py * size + px) * 4);
    }
  }
  return png(size, rgba);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon-16.png'), render(16, { small: true }));
writeFileSync(join(OUT, 'icon-32.png'), render(32, { small: true }));
writeFileSync(join(OUT, 'icon-48.png'), render(48, { padding: 2 }));
writeFileSync(join(OUT, 'icon-128.png'), render(128, { padding: 16 }));
console.log(`Wrote 4 icons to ${OUT}`);
