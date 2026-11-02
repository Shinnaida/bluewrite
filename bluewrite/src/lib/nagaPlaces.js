// City of Naga, Cebu — place gazetteer for the account read.
//
// The officer's account (and the OCR behind it) drifts on barangay spellings:
// INOBUKAN for Inoburan, MAIN IT for Mainit. The AI is told to copy the place
// as written and never correct it itself (see classification_prompt.txt) — the
// correction happens HERE, after the answer lands, so it is deterministic,
// scoped, and receipted instead of a model guess.
//
// SCOPE IS THE WHOLE RULE. Only the City of Naga, Cebu is ever consulted:
// the station's own 28 barangays (PSA PSGC / PhilAtlas, the same names Google
// Maps carries for the city). A place that matches nothing here is not
// corrected — sitios, puroks and establishments are kept exactly as written,
// because inventing a barangay for them would be worse than a misspelling.
//
// Pure — no React, no network (the station LAN has no internet, so a live
// Maps lookup is not an option) — and unit-tested beside the other rules.

/** The station's 28 barangays, canonical spelling (PSA / PhilAtlas). */
export const NAGA_BARANGAYS = [
  'Alfaco',
  'Bairan',
  'Balirong',
  'Cabungahan',
  'Cantao-an',
  'Central Poblacion',
  'Cogon',
  'Colon',
  'East Poblacion',
  'Inayagan',
  'Inoburan',
  'Jaguimit',
  'Lanas',
  'Langtad',
  'Lutac',
  'Mainit',
  'Mayana',
  'Naalad',
  'North Poblacion',
  'Pangdan',
  'Patag',
  'South Poblacion',
  'Tagjaguimit',
  'Tangke',
  'Tinaan',
  'Tuyan',
  'Uling',
  'West Poblacion',
];

/** City tokens that are already in scope — recognised, never rewritten. */
const CITY_ALIASES = new Set(
  [
    'CITY OF NAGA',
    'NAGA CITY',
    'NAGA',
    'CITY OF NAGA CEBU',
    'NAGA CITY CEBU',
    'NAGA CEBU',
    'CEBU',
  ].map(norm),
);

/** Upper-case alphanumerics: punctuation, spacing and hyphens never count. */
export function norm(s) {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Edit distance between two already-normalised strings. */
export function editDistance(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x === y) return 0;
  if (x === '') return y.length;
  if (y === '') return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= y.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/**
 * Verified sitio-level places: names below the 28 barangays, confirmed
 * against community records — social place tags and check-ins, barangay
 * facilities carrying the name (e.g. Cansimundong Child Development Center).
 * The official spot maps do not label sitios, so each entry here is added
 * only once a human has verified it; the matcher below treats them with the
 * same distance discipline as barangays.
 */
export const NAGA_SITIOS = [
  // Cansimundong, Inoburan — Instagram/Facebook place tags (1,350+ check-ins),
  // Cansimundong Child Development Center. The blotter's CANGIMUNDONG is a
  // one-letter G/S misread of it, in the sitio slot before its barangay.
  { name: 'Cansimundong', barangay: 'Inoburan' },
];

const barangayNorms = NAGA_BARANGAYS.map((name) => ({ name, n: norm(name) }));
const sitioNorms = NAGA_SITIOS.map((s) => ({ ...s, n: norm(s.name) }));

/**
 * The closest entry in a normalised gazetteer list to a single place token,
 * or null when nothing is close enough to claim. Exact hits (after
 * normalisation) return the canonical spelling with corrected:false —
 * recognised, not rewritten. A near miss within a length-scaled distance
 * returns corrected:true; short tokens (under 5) must match exactly, so
 * Lutac is never "corrected" into Lanas. Ties correct into neither — an
 * ambiguous guess is still a guess.
 */
function closestIn(entries, token) {
  const n = norm(token);
  if (n === '' || /^V\d+$/.test(n)) return null;
  let best = null;
  let bestDist = Infinity;
  let tied = false;
  for (const b of entries) {
    const d = editDistance(n, b.n);
    if (d < bestDist) {
      bestDist = d;
      best = b;
      tied = false;
    } else if (d === bestDist) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  if (bestDist === 0) return { entry: best, corrected: false };
  const allow = best.n.length < 5 ? 0 : best.n.length <= 6 ? 1 : 2;
  if (bestDist > allow) return null;
  return { entry: best, corrected: true };
}

/**
 * The closest barangay to a single place token, or null when nothing is close
 * enough to claim. See closestIn for the discipline.
 *
 * @param {string} token one place word, e.g. "INOBUKAN"
 * @returns {{ name: string, corrected: boolean } | null}
 */
export function closestBarangay(token) {
  const hit = closestIn(barangayNorms, token);
  if (!hit) return null;
  return { name: hit.entry.name, corrected: hit.corrected };
}

/**
 * The closest verified sitio to a single place token, or null when nothing
 * is close enough to claim. Same discipline as barangays: exact hits are
 * recognised, near misses (the blotter's CANGIMUNDONG for Cansimundong)
 * correct, ties and far misses are kept as written.
 *
 * @param {string} token one place word, e.g. "CANGIMUNDONG"
 * @returns {{ name: string, barangay: string, corrected: boolean } | null}
 */
export function closestSitio(token) {
  const hit = closestIn(sitioNorms, token);
  if (!hit) return null;
  return { name: hit.entry.name, barangay: hit.entry.barangay, corrected: hit.corrected };
}

/**
 * Correct a whole place line segment-by-segment ("CANGIMUNDONG, INOBUKAN,
 * CITY OF NAGA" → "CANGIMUNDONG, Inoburan, CITY OF NAGA"). Only near-miss
 * barangay spellings change; city variants, exact barangays, purok/sitio
 * lines and genuine unknowns are kept exactly as written.
 *
 * @param {string} raw the place as the read stated it
 * @returns {{ text: string, changes: Array<{ from: string, to: string }> }}
 */
export function correctNagaLocation(raw) {
  const src = String(raw ?? '').trim();
  if (src === '') return { text: '', changes: [] };
  const changes = [];
  // Correct each word inside a segment against the gazetteer: barangays
  // first, then verified sitios. Only a near miss (a one-letter drift on a
  // short name, up to two on a long one) moves — exact names are recognised
  // below, unknowns and ordinary words are kept as written.
  function fixWord(word, silent, canonicalise) {
    const bare = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (bare === '') return word;
    // Plates, OR/CR numbers, licences, dates and V-markers (V1, V2, V1'S)
    // are codes, never places — a digit or a V-marker never enters the
    // gazetteer, so a plate can never file as a barangay.
    if (/[0-9]/.test(bare)) return word;
    if (/^V\d+('S)?$/i.test(bare)) return word;
    const hit = closestBarangay(bare);
    if (hit && hit.corrected) {
      if (!silent) changes.push({ from: bare, to: hit.name });
      return word.replace(bare, hit.name);
    }
    if (hit && canonicalise) return word.replace(bare, hit.name);
    const sitio = closestSitio(bare);
    if (sitio && sitio.corrected) {
      if (!silent) changes.push({ from: bare, to: sitio.name });
      return word.replace(bare, sitio.name);
    }
    if (sitio && canonicalise) return word.replace(bare, sitio.name);
    return word;
  }
  function fixWords(words, silent, canonicalise) {
    return words.map((word) => fixWord(word, silent, canonicalise));
  }
  // Line breaks survive the pass (owner request): correct each line on its
  // own and rejoin — the paper keeps the account's own layout. Single-line
  // places correct exactly as before.
  const out = src.split('\n').map((ln) => {
    // A line-edge comma belongs to the break ("Guimbaliwan,\nCan-asujan"):
    // edge empties go so no stray space trails the comma into the newline.
    const segs = ln.split(/[,;]+/);
    while (segs.length > 1 && segs[0].trim() === '') segs.shift();
    while (segs.length > 1 && segs[segs.length - 1].trim() === '') segs.pop();
    const joined = segs.map((part) => {
    const seg = part.trim();
    if (seg === '') return seg;
    // In scope already: a city token is recognised, never rewritten.
    if (CITY_ALIASES.has(norm(seg))) return seg;
    // "BRGY. MAINIT" / "BARANGAY TINAAN": the name canonicalises to the
    // gazetteer spelling under a steady "Brgy." prefix — a recognised name
    // is formatting, never a guess, so spacing/case variants land clean.
    // The remainder is fixed word by word, so "BARANGAY CANGIMUNDONG
    // TINAAN" still lands its sitio and barangay instead of being kept
    // as written.
    const headed = /^(BRGY\.?|BARANGAY)\s+(.+)$/i.exec(seg);
    if (headed) {
      const rawTail = headed[2].trim();
      // Whole-phrase first: "MAIN IT" is Mainit (norm ignores the space),
      // so it must not fall through to word-by-word fixing.
      const whole = closestBarangay(rawTail);
      if (whole) {
        const fixed = `Brgy. ${whole.name}`;
        if (fixed !== seg) changes.push({ from: seg, to: fixed });
        return fixed;
      }
      const tail = fixWords(rawTail.split(/\s+/), true, true).join(' ');
      const fixed = `Brgy. ${tail}`;
      if (fixed !== seg) changes.push({ from: seg, to: fixed });
      return fixed;
    }
    // "PUROK TAL-OT" / "SITIO CANGIMUNDONG": the prefix is kept and the
    // name behind it is still fixed word by word, so a one-letter sitio
    // drift lands on the verified name instead of filing the misspelling.
    const sub = /^(PUROK|SITIO)\b(.*)$/i.exec(seg);
    if (sub) {
      const rest = (sub[2] || '').trim();
      if (rest === '') return seg;
      const prefix = /^[A-Z]+/i.exec(seg)[0];
      const tail = fixWords(rest.split(/\s+/)).join(' ');
      const fixed = `${prefix} ${tail}`;
      return fixed;
    }
  // A lone token is the barangay itself, a verified sitio, or an unknown:
  // correct the near miss at either level, keep the unknown. Barangays are
  // tried first — a misspelled barangay must never resolve into a sitio.
  if (!/\s/.test(seg)) {
    const hit = closestBarangay(seg);
    if (hit && hit.corrected) {
      changes.push({ from: seg, to: hit.name });
      return hit.name;
    }
    const sitio = closestSitio(seg);
    if (sitio && sitio.corrected) {
      changes.push({ from: seg, to: sitio.name });
      return sitio.name;
    }
    return seg;
  }
  // A multi-word scene ("CANGIMUNDONG INOBURAN"): whole-phrase first so
  // spaced barangays ("MAIN IT" → Mainit) never split, then whole-phrase
  // sitio ("CANGI MUNDONG" → Cansimundong, split across a space), then
  // adjacent-pair sitio (a split sitio inside a longer scene), then word by
  // word so each one-letter drift still lands conclusively.
  const wholeSeg = closestBarangay(seg);
  if (wholeSeg && wholeSeg.corrected) {
    changes.push({ from: seg, to: wholeSeg.name });
    return wholeSeg.name;
  }
  if (wholeSeg) return seg;
  const wholeSitio = closestSitio(seg);
  if (wholeSitio && wholeSitio.corrected) {
    changes.push({ from: seg, to: wholeSitio.name });
    return wholeSitio.name;
  }
  if (wholeSitio) return seg;
  // Split sitio inside a scene: "CANGI MUNDONG, INOBURAN" — two adjacent
  // words joined equal a verified sitio with a one-letter drift.
  const words = seg.split(/\s+/);
  for (let i = 0; i + 1 < words.length; i += 1) {
    const pair = `${words[i]}${words[i + 1]}`;
    if (/[0-9]/.test(pair)) continue;
    const pairSitio = closestSitio(pair);
    if (pairSitio && pairSitio.corrected) {
      changes.push({ from: `${words[i]} ${words[i + 1]}`, to: pairSitio.name });
      words.splice(i, 2, pairSitio.name);
      return fixWords(words).join(' ');
    }
  }
  return fixWords(words).join(' ');
    }).join(', ');
    // A line-edge delimiter belongs to the break ("Guimbaliwan,\nCan-asujan"):
    // rehang it so the comma survives without trailing a space into the newline.
    const trail = /([,;])\s*$/.exec(ln)?.[1] ?? '';
    if (joined === '') return '';
    return trail !== '' && !/[,;]$/.test(joined) ? joined + trail : joined;
  }).join('\n');
  return { text: out, changes };
}
