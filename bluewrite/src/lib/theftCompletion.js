// BlueWrite — theft paper completion for the sheet Arrange/Enhance flow.
//
// The long-ago reference (resources/ai/narrative_few_shots.txt, THEFT/ROBBERY,
// plus the Theft type template in src/lib/sheetFacts.js) defines the parts a
// complete theft paper carries: WHEN, WHERE, victim, suspect(s), stolen
// property + value, witnesses, recovery, disposition. The sheet's panel says
// "No suggestions or gaps detected" because arrange/enhance drafts never carry
// advisories — so a thin paper reads as a finished one.
//
// auditTheftCompletion() closes that loop: it checks the paper (facts + the
// draft narrative) against the checklist and completes what the officer's own
// words already state — victim/suspect demographics, stolen items, recovery —
// as record fills the officer applies with one click. Every filled value is a
// substring of the officer's own text (asserted in tests); what nothing states
// becomes a possibleGaps advisory naming the missing part instead. Nothing is
// ever invented, and no label the type template does not own is added.
//
// Pure — no React, no fetch — so it runs under node:test.

import { buildTypeFacts } from './sheetFacts.js';

const N = (v) => String(v ?? '').trim();
const has = (v) => N(v) !== '';
const LOW = (s) => String(s ?? '').toLowerCase();
// A filled value traces back to the officer's own words: it must read in the
// paper (facts or narrative) as written, letter for letter modulo case.
const statedIn = (paper, value) => has(value) && LOW(paper).includes(LOW(N(value)));

const THEFT_RE = /theft/i;

/** This audit only knows the theft reference checklist. Anything else → []. */
export function isTheftType(incidentType) {
  return THEFT_RE.test(N(incidentType));
}

// ---------------------------------------------------------------------------
// Reading the officer's own prose.
// ---------------------------------------------------------------------------

const nameKey = (name) => LOW(N(name)).replace(/[^a-z0-9]+/g, ' ').trim();

// The mention of a person, plus the words around it where blotter prose keeps
// that person's demographics ("... identified as Angelica Mae Villarosa,
// female, Filipino, 25 years old, and a resident of Purok 2 ...").
const AGE_RE = /(\d{1,3})\s*(?:years?\s*old|yrs?(?:\s*old)?|y\.?\s*o\.?)\b/i;
const SEX_RE = /\b(male|female)\b/i;
const RESIDENT_RE = /residents?\s+of\s+(.+?)(?=,?\s*(?:reported|was|were|is|are|who|which|that|with an|valued|worth|amounting|allegedly|entered|personally|appeared|appears)\b|[.;\n])/i;
const ADDRESS_TAIL_RE = /\b(drivers?\s*licen[sc]e|licen[sc]e|plate\s*#?|plate\s+no|OR\s*#|CR\s*#|contact|tel|phone)\b.*$/i;
const DOB_RE = /\bDOB\s*[:.]?\s*([\d][\d/\-.]*)/i;
const HEIGHT_RE = /(\d\s*['’]\s*\d{1,2}\s*["”]?)/;
const CLOTHING_RE = /wearing\s+([^.;\n]{1,60})/i;

function cutAddress(raw) {
  return N(N(raw).replace(ADDRESS_TAIL_RE, '')).replace(/[,;\s]+$/, '');
}
function personWindows(paper, name) {
  const wins = [];
  if (!has(name)) return wins;
  const hay = LOW(paper);
  const needle = LOW(N(name));
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx === -1) break;
    wins.push(paper.slice(Math.max(0, idx - 120), idx + needle.length + 220));
    from = idx + needle.length;
    if (wins.length > 6) break;
  }
  return wins;
}

export function extractPersonFacts(paper, name) {
  const out = {};
  if (!has(name)) return out;
  for (const win of personWindows(paper, name)) {
    if (win === '') continue;
    if (!has(out.age)) {
      const age = AGE_RE.exec(win);
      if (age) out.age = age[1];
    }
    if (!has(out.sex)) {
      const sex = SEX_RE.exec(win);
      if (sex) out.sex = sex[1].slice(0, 1).toUpperCase() + sex[1].slice(1).toLowerCase();
    }
    if (!has(out.address)) {
      const res = RESIDENT_RE.exec(win);
      if (res) {
        const addr = cutAddress(res[1]);
        if (addr !== '' && addr.length <= 90) out.address = addr;
      }
    }
    if (!has(out.dob)) {
      const dob = DOB_RE.exec(win);
      if (dob) out.dob = dob[1];
    }
    if (!has(out.height)) {
      const height = HEIGHT_RE.exec(win);
      if (height) out.height = N(height[1]);
    }
    if (!has(out.clothing)) {
      const clothing = CLOTHING_RE.exec(win);
      if (clothing) out.clothing = N(clothing[1]);
    }
    if (has(out.age) && has(out.sex) && has(out.address)) break;
  }
  return out;
}
// The paper's own person line names the party even when the prose never says
// "identified as" — the lost-wallet paper carries `Victim: Jonalyn
// Panugalinog Pantilgan` and nothing else, so without this the audit reports
// "No victim is named anywhere" over a named victim. Only a clean multi-word
// name qualifies; an empty, single-word or unknown line is not a name.
export function paperLabelName(paper, roles) {
  const m = new RegExp('^\\s*(?:' + roles + ')\\s*:\\s*(.+?)\\s*$', 'im').exec(String(paper ?? ''));
  if (!m) return '';
  const first = N(m[1]).split(/[,;]/)[0].trim();
  if (!/^[A-Za-z][A-Za-z.'’\- ]+$/.test(first)) return '';
  if (/\d/.test(first)) return '';
  if (/\b(?:unidentified|unknown)\b/i.test(first)) return '';
  if (first.split(/\s+/).length < 2) return '';
  return first;
}

export function extractIdentifiedName(paper, roles) {
  const WS = String.fromCharCode(92) + "s";
  const m = new RegExp(
    "(?:" + roles + "),?" + WS + "+identified" + WS + "+as" + WS + "+([A-Z][A-Za-z.-]+(?:" + WS + "+[A-Z][A-Za-z.-]+){1,3})",
  ).exec(String(paper ?? ""));
  return m ? N(m[1]) : "";
}

// ---------------------------------------------------------------------------
// Stolen items out of the prose.
// ---------------------------------------------------------------------------

const QTY_WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6' };
const LEAD_QTY_RE = /^(one|two|three|four|five|six|\d+)\s*(?:\(\d+\)\s*)?(?:units?\s+)?(?:of\s+)?/i;
const VALUE_CUE_RE = /(?:estimated value of|valued at|worth|amounting to)\s*(Php?\s*[\d,]*\d(?:\.\d+)?|₱\s*[\d,]*\d(?:\.\d+)?)/i;
const UNIT_ITEM_RE = /(one|two|three|four|five|six|\d+)\s*(?:\((\d+)\)\s*)?units?\s+(?:of\s+)?(.+?)(?=,?\s*(?:color|with an estimated value|valued at|worth|amounting to)|[.;])/i;
const COLOR_RE = /^,\s*color\s+([^,.;]+)/i;
const CASH_RE = /\bcash\b([^.;]{0,60}?)(?:amounting to|worth|valued at|of)\s*(Php?\s*[\d,]*\d(?:\.\d+)?|₱\s*[\d,]*\d(?:\.\d+)?)/i;
const LOOSE_ITEM_RE = /([A-Za-z][^.;]{2,70}?)\s*(?:with an estimated value of|valued at|worth|amounting to)\s*(Php?\s*[\d,]*\d(?:\.\d+)?|₱\s*[\d,]*\d(?:\.\d+)?)/i;

function qtyOf(word, paren) {
  if (paren) return paren;
  const w = LOW(word);
  if (/^\d+$/.test(w)) return w;
  return QTY_WORDS[w] ?? '';
}

/** Item rows the prose states — descriptions and values verbatim. */
export function extractStolenItems(paper) {
  const items = [];
  for (const sentence of String(paper ?? '').split(/(?<=[.;])\s+/)) {
    if (!has(sentence)) continue;
    const unit = UNIT_ITEM_RE.exec(sentence);
    if (unit) {
      let desc = N(unit[3]);
      const rest = sentence.slice(unit.index + unit[0].length);
      const color = COLOR_RE.exec(rest);
      if (color) desc = `${desc}, color ${N(color[1])}`;
      const value = VALUE_CUE_RE.exec(sentence);
      items.push({
        desc,
        qty: qtyOf(unit[1], unit[2]),
        value: value ? N(value[1]) : '',
      });
    }
    const cash = CASH_RE.exec(sentence);
    if (cash) {
      items.push({ desc: 'cash', qty: '', value: N(cash[2]) });
      continue;
    }
    if (unit || cash) continue;
    const holding = LOST_HOLDING_RE.exec(sentence);
    if (holding) {
      // The "That Despite Diligent Efforts…" tail is the loss formula, not
      // the property — the item list ends where it begins.
      const desc = N(holding[1]).replace(/,\s*that\s+despite\b.*$/i, '');
      if (desc !== '') items.push({ desc, qty: '', value: '' });
      continue;
    }
    const loose = LOOSE_ITEM_RE.exec(sentence);
    if (loose) {
      let desc = N(loose[1]);
      let qty = '';
      const lead = LEAD_QTY_RE.exec(desc);
      if (lead) {
        qty = qtyOf(lead[1], null);
        desc = N(desc.slice(lead[0].length));
      }
      // A bare "her"/"his"/"their" is not an item on its own.
      if (/^(her|his|their|the|a|an)$/i.test(desc)) continue;
      items.push({ desc, qty, value: N(loose[2]) });
    }
  }
  return items.filter((it) => it.desc !== '');
}

// ---------------------------------------------------------------------------
// Status cues — binary record states the prose can settle outright.
// ---------------------------------------------------------------------------

const NOT_RECOVERED_RE = /could no longer be found|beyond recovery|not (?:yet )?recovered|still missing|unrecovered|no longer be located|lost beyond recovery/i;
const RECOVERED_RE = /\brecovered\b/i;
const UNIDENTIFIED_CUE_RE = /\bunidentified\b|\bunknown\s+(male|female|man|woman|suspect|person)\b/i;
const UNIDENTIFIED_DESC_RE = /((?:unidentified|unknown)\s+(?:male|female|man|woman|person)[^.;]{0,80})/i;
const NO_CCTV_RE = /no\s+(?:cctv|closed-circuit|camera|footage)|without\s+(?:cctv|closed-circuit|camera|footage)|cctv[^.]{0,40}\bnot\b|camera[^.]{0,40}\bnot\b/i;
const YES_CCTV_RE = /cctv[^.]{0,60}(captured|showing|recovered|secured|footage)|footage[^.]{0,40}(secured|preserved|recovered|captured|showing)/i;
const WITNESS_RE = /\bwitness/i;
const BYSTANDER_RE = /\bbystander/i;
const TAKING_RE = /\b(took|taken|stole|stolen|snatch(?:ed|ing)?|grab(?:bed)?|forcibl|unlawfully|broke\s+in|entered|missing|lost)\b/gi;
// Lost property states no taking — "She Lost Her Wallet Containing A, B and
// C" — so the value cues never fire and the paper reads as "no stolen
// property". The held thing and what it contains ARE the property: one
// verbatim row, value blank, with the value asked for instead of a "nothing
// stated" gap.
const LOST_HOLDING_RE = /\blost\s+(?:her|his|their|the|a|an)?\s*((?:wallet|bag|purse|pouch|phone|cellphone|cell\s*phone|luggage|bicycle|motorcycle|car)\b[^.;]*?\bcontaining\b[^.;]+)/i;
const WEAK_TAKING_RE = /^(?:missing|lost|gone)$/i;

const MONTH_RE = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i;
const TIME_RE = /\b\d{1,2}:\d{2}\b|\bo'clock\b/i;
const PRECISE_PLACE_RE = /\b(purok|brgy\.?|barangay|sitio|street|road|highway|market|church|mall|school|terminal|compound|subdivision|village|zone|park|bridge|store|shop|establishment|hospital|station|precinct|bank|pawnshop)\b/i;
const VAGUE_PLACE_RE = /\b(residence|house|home|premises|area|vicinity|scene)\b/i;

// ---------------------------------------------------------------------------
// The paper as the officer sees it: the type's fact lines plus the narrative.
// ---------------------------------------------------------------------------

/** Fact entries (buildTypeFacts) flattened to plain `Label: values` lines. */
export function factsToText(entries) {
  const lines = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;
    if (Array.isArray(entry.items)) {
      lines.push(`${entry.label}:`);
      entry.items.forEach((it, i) => {
        lines.push(`${i + 1}.) ${it.desc}${it.value ? ` - ${it.value}` : ''}`);
      });
      if (entry.total !== null && entry.total !== undefined) lines.push(`TOTAL - ${entry.total}`);
    } else if (Array.isArray(entry.values)) {
      const vals = entry.values.map(N).filter(Boolean);
      if (vals.length > 0) lines.push(`${entry.label}: ${vals.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The audit.
// ---------------------------------------------------------------------------

/**
 * Audit a theft paper against the reference checklist.
 *
 * @param {object} args
 * @param {string} args.incidentType the report's incident type (non-Theft → empty)
 * @param {string} args.factsText the paper's fact lines, plain
 * @param {string} args.narrativeText the draft narrative, plain
 * @param {object} args.report the report row (location, incident_datetime, action_taken, complainant, respondent)
 * @param {object} args.ts type_specific (complainant/respondent/stolen_items/witness rows + scalars)
 * @returns {{fills: object[], gaps: object[]}} fills the officer applies with
 *   one click (record cells, every value traceable to the officer's words);
 *   gaps advisories naming what nothing states ({description, severity}).
 */
export function auditTheftCompletion({ incidentType = '', factsText = '', narrativeText = '', report = {}, ts = {} } = {}) {
  const fills = [];
  const gaps = [];
  if (!isTheftType(incidentType)) return { fills, gaps };
  const paper = `${N(factsText)}\n${N(narrativeText)}`;
  const R = report ?? {};
  const T = ts ?? {};
  const pushFill = (key, label, preview, target) => fills.push({ key, label, preview, target });

  // ---- WHEN ---------------------------------------------------------------
  const whenStated = MONTH_RE.test(paper) || (TIME_RE.test(paper) && /\b(19|20)\d{2}\b/.test(paper));
  if (!whenStated) {
    gaps.push({
      description: 'Date and time of the incident are not stated on the paper — say when it happened in the account and Arrange again.',
      severity: 'warning',
    });
  }

  // ---- WHERE --------------------------------------------------------------
  const placePrecise = PRECISE_PLACE_RE.test(paper);
  if (!placePrecise) {
    if (VAGUE_PLACE_RE.test(paper)) {
      gaps.push({
        description: `Place of incident is vague on the paper (${VAGUE_PLACE_RE.exec(paper)[0]} only) — state the purok/barangay or landmark in the account and Arrange again.`,
        severity: 'info',
      });
    } else {
      gaps.push({
        description: 'Place of incident is not stated anywhere — say where it happened in the account and Arrange again.',
        severity: 'warning',
      });
    }
  }

  // ---- VICTIM --------------------------------------------------------------
  const victimRows = Array.isArray(T.complainant) ? T.complainant : [];
  const legacyVictim = N(R.complainant);
  if (victimRows.length === 0 && legacyVictim !== '') {
    const facts = extractPersonFacts(paper, legacyVictim);
    if (Object.keys(facts).length > 0) {
      pushFill('victim-row-add', 'Victim row', `${legacyVictim} — ${Object.values(facts).join(', ')}`, {
        kind: 'ts-row-add', group: 'complainant', row: { name: legacyVictim, ...facts },
      });
    }
  } else {
    const named = victimRows.find((r) => has(r?.name));
    if (!named && legacyVictim === '') {
      const who = extractIdentifiedName(paper, 'complainant|victim') || paperLabelName(paper, 'victim|complainant');
      if (who !== '') {
        const facts = extractPersonFacts(paper, who);
        pushFill('victim-row-add', 'Victim row', `${who}${Object.keys(facts).length > 0 ? ` — ${Object.values(facts).join(', ')}` : ''}`, {
          kind: 'ts-row-add', group: 'complainant', row: { name: who, ...facts },
        });
      } else {
        gaps.push({
          description: 'No victim is named anywhere — name the complainant in the account and Arrange again.',
          severity: 'warning',
        });
      }
    } else if (named) {
      const facts = extractPersonFacts(paper, named.name);
      ['age', 'sex', 'address'].forEach((cell) => {
        if (!has(named[cell]) && has(facts[cell])) {
          pushFill(`victim-${cell}`, `Victim ${cell}`, `${named.name} — ${facts[cell]}`, {
            kind: 'ts-cell', group: 'complainant', index: victimRows.indexOf(named), key: cell, value: facts[cell],
          });
        }
      });
      const missingCells = ['age', 'sex', 'address'].filter((cell) => !has(named[cell]) && !has(facts[cell]));
      if (missingCells.length > 0) {
        gaps.push({
          description: `Victim ${N(named.name)} has no recorded ${missingCells.join(', ')} — type it on the Victim line.`,
          severity: missingCells.includes('age') || missingCells.includes('sex') ? 'warning' : 'info',
        });
      }
    }
  }

  // ---- SUSPECT --------------------------------------------------------------
  const suspectRows = Array.isArray(T.respondent) ? T.respondent : [];
  const legacySuspect = N(R.respondent);
  if (suspectRows.length === 0 && legacySuspect !== '') {
    const facts = extractPersonFacts(paper, legacySuspect);
    if (Object.keys(facts).length > 0) {
      pushFill('suspect-row-add', 'Suspect row', `${legacySuspect} — ${Object.values(facts).join(', ')}`, {
        kind: 'ts-row-add', group: 'respondent', row: { name: legacySuspect, suspect_status: 'Identified', ...facts },
      });
    }
  } else {
    const named = suspectRows.find((r) => has(r?.name));
    if (!named && legacySuspect === '') {
      if (UNIDENTIFIED_CUE_RE.test(paper)) {
        const desc = UNIDENTIFIED_DESC_RE.exec(paper);
        const rowIdx = suspectRows.findIndex((r) => !has(r?.name));
        const preview = desc ? N(desc[1]) : 'unidentified suspect';
        if (rowIdx === -1) {
          pushFill('suspect-row-add', 'Suspect row', preview, {
            kind: 'ts-row-add', group: 'respondent', row: { name: '', suspect_status: 'Unidentified', suspect_description: preview },
          });
        } else if (!has(suspectRows[rowIdx].suspect_description) && desc) {
          pushFill('suspect-desc', 'Suspect description', preview, {
            kind: 'ts-cell', group: 'respondent', index: rowIdx, key: 'suspect_description', value: preview,
          });
        }
        if (rowIdx !== -1 && !suspectRows.some((r) => N(r.suspect_status) === 'Unidentified')) {
          pushFill('suspect-status', 'Suspect status', 'Unidentified', {
            kind: rowIdx === -1 ? 'ts-row-add' : 'ts-cell',
            group: 'respondent',
            ...(rowIdx === -1
              ? { row: { name: '', suspect_status: 'Unidentified', suspect_description: preview } }
              : { index: rowIdx, key: 'suspect_status', value: 'Unidentified' }),
          });
        }
      } else {
        const who = extractIdentifiedName(paper, 'suspect|respondent') || paperLabelName(paper, 'suspect|respondent');
        if (who !== '') {
          const facts = extractPersonFacts(paper, who);
          pushFill('suspect-row-add', 'Suspect row', `${who}${Object.keys(facts).length > 0 ? ` — ${Object.values(facts).join(', ')}` : ''}`, {
            kind: 'ts-row-add', group: 'respondent', row: { name: who, suspect_status: 'Identified', ...facts },
          });
        } else {
          gaps.push({
            description: 'No suspect is named or described anywhere — name or describe the suspect in the account and Arrange again.',
            severity: 'warning',
          });
        }
      }
    } else if (named) {
      const facts = extractPersonFacts(paper, named.name);
      ['age', 'sex', 'address'].forEach((cell) => {
        if (!has(named[cell]) && has(facts[cell])) {
          pushFill(`suspect-${cell}`, `Suspect ${cell}`, `${named.name} — ${facts[cell]}`, {
            kind: 'ts-cell', group: 'respondent', index: suspectRows.indexOf(named), key: cell, value: facts[cell],
          });
        }
      });
      if (!has(named.suspect_status)) {
        pushFill('suspect-status', 'Suspect status', 'Identified', {
          kind: 'ts-cell', group: 'respondent', index: suspectRows.indexOf(named), key: 'suspect_status', value: 'Identified',
        });
      }
      const missingCells = ['age', 'sex', 'address'].filter((cell) => !has(named[cell]) && !has(facts[cell]));
      if (missingCells.length > 0) {
        gaps.push({
          description: `Suspect ${N(named.name)} has no recorded ${missingCells.join(', ')} — type it on the Suspect line.`,
          severity: 'info',
        });
      }
    }
  }

  // ---- STOLEN PROPERTY --------------------------------------------------------
  const itemRows = Array.isArray(T.stolen_items) ? T.stolen_items : [];
  const legacyItems = [[N(T.item_stolen || T.item_description), N(T.estimated_value)]].filter(([d]) => d !== '');
  const paperItems = /stolen items?:|items? taken:|\b1\.\)/i.test(paper);
  if (itemRows.length === 0 && legacyItems.length === 0 && !paperItems) {
    const found = extractStolenItems(paper);
    if (found.length > 0) {
      found.forEach((it, i) => {
        pushFill(`item-${i}`, `Stolen item ${found.length > 1 ? i + 1 : ''}`.trim(), `${it.desc}${it.qty ? ` (qty. ${it.qty})` : ''}${it.value ? ` — ${it.value}` : ''}`, {
          kind: 'ts-row-add',
          group: 'stolen_items',
          row: { item_description: it.desc, quantity: it.qty, estimated_value: it.value },
        });
      });
      if (found.every((it) => !has(it.value))) {
        gaps.push({
          description: 'Stolen items state no estimated value — add the value in the account and Arrange again.',
          severity: 'info',
        });
      }
    } else {
      gaps.push({
        description: 'No stolen property is described anywhere — state what was taken (and its value) in the account and Arrange again.',
        severity: 'warning',
      });
    }
  }

  // ---- HOW TAKEN --------------------------------------------------------------
  const howTaken = N(T.how_property_was_taken);
  const takingVerbs = [...paper.matchAll(TAKING_RE)];
  const weakOnly = takingVerbs.length > 0 && takingVerbs.every((m) => WEAK_TAKING_RE.test(m[0]));
  if (howTaken === '' && (takingVerbs.length === 0 || weakOnly)) {
    gaps.push({
      description: takingVerbs.length === 0
        ? 'How the property was taken is not stated — say how it happened in the account and Arrange again.'
        : 'The paper only says the property is missing — say how it was taken in the account and Arrange again.',
      severity: 'info',
    });
  }

  // ---- WITNESSES ---------------------------------------------------------------
  const witnessRows = Array.isArray(T.witness) ? T.witness.filter((r) => has(r?.name) || has(r?.statement_summary)) : [];
  if (witnessRows.length === 0 && !WITNESS_RE.test(paper) && !BYSTANDER_RE.test(paper)) {
    gaps.push({
      description: 'No witness is named — if anyone saw it happen, add them in the account and Arrange again.',
      severity: 'info',
    });
  }

  // ---- CCTV ----------------------------------------------------------------------
  const cctv = N(T.cctv_available);
  if (cctv === '') {
    if (NO_CCTV_RE.test(paper)) {
      pushFill('cctv', 'CCTV', 'No footage — as the account states', { kind: 'ts-scalar', key: 'cctv_available', value: 'No' });
    } else if (YES_CCTV_RE.test(paper)) {
      pushFill('cctv', 'CCTV', 'Footage available — as the account states', { kind: 'ts-scalar', key: 'cctv_available', value: 'Yes' });
    } else {
      gaps.push({
        description: 'CCTV is not addressed — state whether any camera covers the place, in the account.',
        severity: 'info',
      });
    }
  }

  // ---- RECOVERY --------------------------------------------------------------------
  const recovery = N(T.recovery_status);
  if (recovery === '') {
    if (NOT_RECOVERED_RE.test(paper)) {
      pushFill('recovery', 'Recovery status', 'Not recovered — as the paper states', { kind: 'ts-scalar', key: 'recovery_status', value: 'Not recovered' });
    } else if (RECOVERED_RE.test(paper)) {
      pushFill('recovery', 'Recovery status', 'Recovered — as the paper states', { kind: 'ts-scalar', key: 'recovery_status', value: 'Recovered' });
    } else {
      gaps.push({
        description: 'Recovery status is not recorded — state whether the property was recovered.',
        severity: 'info',
      });
    }
  }

  // ---- DISPOSITION -------------------------------------------------------------------
  if (!has(R.action_taken)) {
    gaps.push({
      description: 'No disposition is recorded — the report cannot be closed without one. Type what was done in Remarks / Action Taken.',
      severity: 'warning',
    });
  }

  return { fills, gaps };
}
