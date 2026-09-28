// Usage: node .tmp-line.mjs <png> <axis:h|v> <fixed> <from> <to> [step]
// Prints the colour along a horizontal (axis=h, fixed=y) or vertical (fixed=x) line.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const [png, axis, fixed, from, to, stepS] = process.argv.slice(2);
const step = +(stepS || 1);
const buf = readFileSync(png);
let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
const idat = [];
let palette = null, trns = null;
while (p < buf.length) {
  const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
  const data = buf.subarray(p + 8, p + 8 + len);
  if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
  else if (type === 'PLTE') palette = Buffer.from(data);
  else if (type === 'tRNS') trns = Buffer.from(data);
  else if (type === 'IDAT') idat.push(Buffer.from(data));
  else if (type === 'IEND') break;
  p += 12 + len;
}
const raw = inflateSync(Buffer.concat(idat));
const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
const stride = w * ch;
const out = Buffer.alloc(h * stride);
const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
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
  if (colorType === 3) { const idx = out[i]; return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]]; }
  if (colorType === 0 || colorType === 4) return [out[i], out[i], out[i]];
  if (colorType === 2) return [out[i], out[i + 1], out[i + 2]];
  return [out[i], out[i + 1], out[i + 2]];
};
const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

const F = +fixed;
const parts = [];
for (let t = +from; t < +to; t += step) {
  const [r, g, b] = axis === 'h' ? px(t, F) : px(F, t);
  parts.push(`${t}:${hex(r, g, b)}`);
}
console.log(`${axis === 'h' ? 'y=' + F : 'x=' + F}  ` + parts.join(' '));
