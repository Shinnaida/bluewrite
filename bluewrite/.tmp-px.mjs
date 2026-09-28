// One-off: decode the preview PNG and verify the four UI changes by pixel.
// node built-ins only (no dependencies).
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const path = process.argv[2];
const buf = readFileSync(path);

// --- PNG chunks ---
let off = 8;
let width = 0, height = 0, bitDepth = 0, colorType = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    if (data[12] !== 0) { console.error('interlaced PNG not supported'); process.exit(1); }
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  off += 12 + len;
}
if (bitDepth !== 8) { console.error('bit depth ' + bitDepth); process.exit(1); }
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
if (!channels) { console.error('color type ' + colorType); process.exit(1); }

const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(height * stride);
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
let prev = Buffer.alloc(stride);
for (let y = 0; y < height; y++) {
  const f = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const cur = Buffer.alloc(stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? cur[x - channels] : 0;
    const b = prev[x];
    const c = x >= channels ? prev[x - channels] : 0;
    let v = line[x];
    if (f === 1) v = (v + a) & 255;
    else if (f === 2) v = (v + b) & 255;
    else if (f === 3) v = (v + Math.floor((a + b) / 2)) & 255;
    else if (f === 4) v = (v + paeth(a, b, c)) & 255;
    cur[x] = v;
  }
  cur.copy(out, y * stride);
  prev = cur;
}
const px = (x, y) => {
  const i = y * stride + x * channels;
  return [out[i], out[i + 1], out[i + 2]];
};
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// find every pixel within tol of a target, report count + bbox
function find(target, tol = 6) {
  let n = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * channels;
      if (Math.abs(out[i] - target[0]) <= tol && Math.abs(out[i + 1] - target[1]) <= tol && Math.abs(out[i + 2] - target[2]) <= tol) {
        n++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { n, minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

console.log(`image ${width}x${height}  colorType=${colorType}`);
console.log('nav bar sample (40,25):      ' + hex(px(40, 25)));
console.log('page bg sample (720,1150):   ' + hex(px(720, 1150)));

const navy = [0x1a, 0x2b, 0x4a];
const flag = [0x9a, 0x5b, 0x00];
const tint = [0xdd, 0xe4, 0xf1]; // rgba(31,95,208,.08) over #EEF0F4

for (const [name, target, tol] of [
  ['navy #1a2b4a (nav + section headers)', navy, 8],
  ['flag fill #9A5B00 (DRAFT badge)', flag, 8],
  ['accent tint ~#DDE4F1 (AI card)', tint, 4],
]) {
  const r = find(target, tol);
  console.log(`${name}: ${r.n} px` + (r.n ? `  bbox x${r.minX}-${r.maxX} y${r.minY}-${r.maxY} (w${r.w} h${r.h})` : ''));
}
