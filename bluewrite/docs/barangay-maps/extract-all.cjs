// One-off: extract the text layer of every installed spot map into
// <name>.txt beside it, so place names can be searched offline.
// Usage: node extract-all.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  const latin = buf.toString('latin1');
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  const texts = [];
  while ((m = re.exec(latin)) !== null) {
    const raw = Buffer.from(m[1], 'latin1');
    let out = null;
    try { out = zlib.inflateSync(raw); }
    catch (e) { try { out = zlib.inflateRawSync(raw); } catch (e2) { /* not flate */ } }
    if (out) texts.push(out.toString('latin1'));
  }
  const all = texts.join('\n');
  const parts = [];
  const tjRe = /\((?:\\.|[^\\()])*\)/g;
  let t;
  while ((t = tjRe.exec(all)) !== null) {
    parts.push(t[0].slice(1, -1).replace(/\\(.)/g, '$1'));
  }
  const hxRe = /<([0-9A-Fa-f]{4,})>/g;
  while ((t = hxRe.exec(all)) !== null) {
    try { parts.push(Buffer.from(t[1], 'hex').toString('latin1')); } catch (e) { /* skip */ }
  }
  fs.writeFileSync(path.join(dir, f.replace(/\.pdf$/, '.txt')), parts.join(' '));
  console.log('ok', f);
}
