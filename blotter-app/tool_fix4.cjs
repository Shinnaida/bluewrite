const fs = require('fs');
const BS = String.fromCharCode(92);
const SQ = String.fromCharCode(39);
const DL = String.fromCharCode(36);
const p = 'lib/blotter_text.dart';
const lines = fs.readFileSync(p, 'utf8').split('\n');
const idx = lines.findIndex((l) => l.indexOf('u201D]?([A-Z]') >= 0);
if (idx < 0) { console.error('target line not found'); process.exit(1); }
lines[idx] =
  '    ' + SQ + '^["' + SQ + BS + 'u201C' + BS + 'u201D]?([A-Z][^"' + SQ + BS + 'u201C' + BS + 'u201D' + BS + 'n]{9,139})["' + SQ + BS + 'u201C' + BS + 'u201D]?' + BS + 's*' + BS + DL + SQ + ',';
fs.writeFileSync(p, lines.join('\n'));
console.log('fixed line ' + (idx + 1));
