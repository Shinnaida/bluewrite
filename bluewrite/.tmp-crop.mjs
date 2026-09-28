// Usage: node .tmp-crop.mjs <png> <x0> <y0> <x1> <y1>
// Prints a colour histogram of the region, then an ASCII map (each cell = 8x8 px
// block, letter = dominant colour class) so we can see the shape on screen.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const [png, x0, y0, x1, y1] = process.argv.slice(2);
const buf = readFileSync(png);

// --- minimal PNG decode (8-bit, non-interlaced; RGBA / RGB / palette / grey) ---
let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
const idat = [];
let palette = null, trns = null;
while (p < buf.length) {
  const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
  const data = buf.subarray(p + 8, p + 8 + len);
  if (type === 'IHDR') {
    w = data.readUInt32BE(0); h = data.readUInt32BE(4);
    bitDepth = data[8]; colorType = data[9];
    if (bitDepth !== 8 || data[12] !== 0) { console.error('unsupported png'); process.exit(1); }
  } else if (type === 'PLTE') palette = Buffer.from(data);
  else if (type === 'tRNS') trns = Buffer.from(data);
  else if (type === 'IDAT') idat.push(Buffer.from(data));
  else if (type === 'IEND') break;
  p += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));
const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
const stride = w * ch;
const out = Buffer.alloc(h * stride);
const paeth = (a, b, c) => {
  const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
let q = 0;
for (let y = 0; y < h; y++) {
  const f = raw[q++];
  for (let x = 0; x < stride; x++) {
    const v = raw[q++], a = x >= ch ? out[y * stride + x - ch] : 0;
    const b = y > 0 ? out[(y - 1) * stride + x] : 0;
    const c = (y > 0 && x >= ch) ? out[(y - 1) * stride + x - ch] : 0;
    out[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? ((a + b) >> 1) : paeth(a, b, c))) & 255;
  }
}
const px = (x, y) => {
  const i = y * stride + x * ch;
  if (colorType === 3) { const idx = out[i]; return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], trns && idx < trns.length ? trns[idx] : 255]; }
  if (colorType === 0) return [out[i], out[i], out[i], 255];
  if (colorType === 4) return [out[i], out[i], out[i], out[i + 1]];
  if (colorType === 2) return [out[i], out[i + 1], out[i + 2], 255];
  return [out[i], out[i + 1], out[i + 2], out[i + 3]];
};
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

const X0 = +x0, Y0 = +y0, X1 = +x1, Y1 = +y1;
const counts = new Map();
for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
  const [r, g, b] = px(x, y);
  const k = hex(r, g, b);
  counts.set(k, (counts.get(k) || 0) + 1);
}
console.log(`region x${X0}-${X1} y${Y0}-${Y1} — top colours:`);
[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
  .forEach(([k, n]) => console.log(`  ${k}  ${n}`));

// ASCII map: each cell covers 8x8 px, lettered by class
const classify = (r, g, b) => {
  if (r > 245 && g > 245 && b > 245) return '.';            // white
  if (Math.abs(r - 238) < 8 && Math.abs(g - 240) < 8 && Math.abs(b - 244) < 8) return ','; // void
  if (r < 70 && g < 80 && b < 110) return 'N';              // navy
  if (r > 120 && r < 200 && g > 60 && g < 130 && b < 70) return 'A'; // amber fill
  if (r > 200 && g > 140 && b < 120) return 'a';            // pale amber
  if (b > r && b > 140 && r < 210) return 'B';              // blue-ish
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 14) return 'g'; // grey
  return '?';
};
console.log('\nASCII map (8px cells):');
for (let y = Y0; y < Y1; y += 8) {
  let line = '';
  for (let x = X0; x < X1; x += 8) {
    const tally = new Map();
    for (let dy = 0; dy < 8 && y + dy < Y1; dy++) for (let dx = 0; dx < 8 && x + dx < X1; dx++) {
      const [r, g, b] = px(x + dx, y + dy);
      const c = classify(r, g, b);
      tally.set(c, (tally.get(c) || 0) + 1);
    }
    line += [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  console.log(String(y).padStart(4) + ' ' + line);
}
