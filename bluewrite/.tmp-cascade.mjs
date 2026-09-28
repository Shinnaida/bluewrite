// Usage: node .tmp-cascade.mjs <css-file> <substring>
// Splits a (minified) CSS file into rules and prints selector{body} for every rule
// whose selector contains the substring.
import { readFileSync } from 'node:fs';
const [, , file, needle] = process.argv;
const css = readFileSync(file, 'utf8');
let i = 0, n = css.length, hits = 0;
while (i < n) {
  const open = css.indexOf('{', i);
  if (open === -1) break;
  const sel = css.slice(i, open).trim();
  // find matching close brace (no nesting in this bundle, but be safe)
  let depth = 1, j = open + 1;
  while (j < n && depth > 0) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') depth--;
    j++;
  }
  const body = css.slice(open + 1, j - 1);
  if (sel.includes(needle)) { hits++; console.log(`${sel} { ${body} }\n`); }
  i = j;
}
console.log(`--- ${hits} rule(s) matching "${needle}" ---`);
