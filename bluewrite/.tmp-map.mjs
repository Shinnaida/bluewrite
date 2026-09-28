import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const buf = readFileSync(process.argv[2]);
let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
  else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  off += 12 + len;
}
const channels = colorType === 6 ? 4 : 3;
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(height * stride);
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
let prev = Buffer.alloc(stride);
for (let y = 0; y < height; y++) {
  const f = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const cur = Buffer.alloc(stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? cur[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
    let v = line[x];
    if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255;
    else if (f === 3) v = (v + Math.floor((a + b) / 2)) & 255; else if (f === 4) v = (v + paeth(a, b, c)) & 255;
    cur[x] = v;
  }
  cur.copy(out, y * stride); prev = cur;
}
const px = (x, y) => { const i = y * stride + x * channels; return [out[i], out[i + 1], out[i + 2]]; };
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const isAmber = ([r, g, b]) => r > 130 && r < 185 && g > 65 && g < 115 && b < 45;

// 1. column profile down the left edge: where are the bands?
console.log('--- left column x=40 ---');
for (let y = 0; y < Math.min(height, 400); y += 15) console.log(String(y).padStart(4) + ' ' + hex(px(40, y)));

// 2. any amber at all?
let amber = 0, ax0 = 1e9, ay0 = 1e9, ax1 = -1, ay1 = -1;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (isAmber(px(x, y))) { amber++; if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y; }
console.log(`--- amber-ish pixels: ${amber}` + (amber ? ` bbox x${ax0}-${ax1} y${ay0}-${ay1} (w${ax1 - ax0 + 1} h${ay1 - ay0 + 1})` : ''));
if (amber) console.log('    centre colour: ' + hex(px((ax0 + ax1) >> 1, (ay0 + ay1) >> 1)));

// 3. navy row profile: which rows are mostly navy?
console.log('--- rows that are >20% navy ---');
for (let y = 0; y < height; y += 4) {
  let n = 0;
  for (let x = 0; x < width; x += 4) { const [r, g, b] = px(x, y); if (Math.abs(r - 0x1a) < 10 && Math.abs(g - 0x2b) < 10 && Math.abs(b - 0x4a) < 10) n++; }
  if (n > (width / 4) * 0.2) console.log(`  y=${y} ${n} samples`);
}
