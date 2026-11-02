// BlueWrite — universal incident-report formatter (owner request, 2026-11-02).
//
// Both AI Assistance modes use THIS formatter, so the presentation rules are
// one implementation and cannot drift:
//
//   Arrange Only    → formatIncidentReportHtml(cleanAccountText(text), { sentenceCase: true })
//   Enhance Wording → formatIncidentReportHtml(providerText, { allowedLabels })
//
// It never adds a field label, a heading, a section or a fact. It only:
//   * tidies whitespace/line layout,
//   * arranges the parts the text already carries into the station's report
//     order (owner request, 2026-11-02) — no part is added or dropped,
//   * applies formal sentence case in Arrange Only (owner request, 2026-11-02):
//     CAPITALISATION changes, nothing else. Words, spelling, grammar,
//     punctuation, names, numbers and identifiers stay exactly as written;
//     the incident title keeps the source's own casing,
//   * spells the bold field labels in sentence case, never ALL CAPS, and reads
//     the T/D shorthand as Time/Date; the facts narrative follows its label on
//     the next line (owner request, 2026-11-02),
//   * boldens a vehicle row's leading V1:, V2:, … marker when the source
//     carries a VEHICLES INVOLVED block (owner request, 2026-11-02),
//   * boldens a label that ALREADY exists in the text (and, outside Arrange
//     Only, normalises the separator beside it to a colon, e.g.
//     "PLACE OF INCIDENT :" → "**PLACE OF INCIDENT:**"),
//   * escapes everything else untouched.
//
// A label is a short line-opening phrase followed by a colon, or a known
// report label followed by a dot/dash ("FACTS. …", "FACTS- …"). A standalone
// uppercase incident TITLE is detected by detectIncidentTitle() and rendered
// as its own bold heading paragraph — never as a field, and no `INCIDENT
// TITLE:` label is ever added.
//
// `allowedLabels` (optional) is the set of labels the SOURCE carried. When it
// is supplied (Enhance Wording), the model's output can only bold labels that
// existed in the source — a label the model invents stays plain text.

import { NAGA_BARANGAYS, NAGA_SITIOS } from './nagaPlaces.js';

// Lines that can never be the incident title, however they are cased.
const TITLE_NEVER = [
  /certification is issued/i,
  /legal purpose/i,
  /upon the request/i,
  /for what.?ever/i,
  /^(recorded|reported|requested|requestor|purpose)\b/i,
  /blotter/i,
  /\bV\d+\b.*(plate| or | cr )|plate.*( or | cr )/i,
];

// A time or date on its own line is a fact, not a title.
const looksLikeTimeOrDate = (line) =>
  /\d{1,2}:\d{2}/.test(line) || /\b\d{1,2}-\d{1,2}-\d{2,4}\b/.test(line);

// Only a line that is NOTHING BUT a moment can head the report. A vehicle row
// carries a DOB or a plate date too, and hoisting that row ahead of the title
// would tear it out of VEHICLES INVOLVED (owner request, 2026-11-02).
const isBareTimestamp = (line) => {
  const s = String(line ?? '').trim();
  if (s === '' || !looksLikeTimeOrDate(s)) return false;
  // A bare date in the body (a DOB, a date of loss) is content, not the head.
  if (!/\d{1,2}:\d{2}/.test(s)) return false;
  if (/^V\d+/i.test(s)) return false;
  if (/\b(?:PLATE|DOB|OR|CR|LICEN[CS]E|OWNED|DRIVEN|RESIDENT)\b/i.test(s)) return false;
  const rest = s
    .replace(/\b\d{1,2}-\d{1,2}-\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/gi, ' ')
    .replace(/\b(?:AM|PM)\b/gi, ' ')
    .replace(/[\s,/-]+/g, '');
  return rest === '';
};

// A line opening with a person role names someone in the body (a rider, a
// driver, a victim) — content, never the incident title.
const TITLE_ROLE_OPENERS = new Set([
  'backrider', 'back', 'driver', 'victim', 'suspect', 'complainant',
  'witness', 'owner', 'reporter', 'passenger', 'rider', 'victims', 'suspects',
]);

/**
 * Universal incident-title detection (owner request, 2026-11-02).
 *
 * Reads the whole source text and returns the line that states the incident
 * title — the uppercase heading above the structured body (e.g. the reference
 * report's "RECKLESS IMPRUDENCE RESULTING TO DAMAGE TO PROPERTY AND PHYSICAL
 * INJURY"), a labeled entry (`TITLE:` / `SUBJECT:` / `RE:` …), or '' when no
 * line states one confidently. Nothing is invented: an empty string means
 * "no title found", and the caller prints no heading at all.
 *
 * Shared by Arrange Only and Enhance Wording through formatIncidentReportHtml,
 * so both modes use exactly this logic on every incident type — the reference
 * title is never reused for another report, because detection only ever reads
 * the report it is given.
 *
 * A bare (unlabeled) title must be ALL CAPS with no lowercase letters — that
 * is what keeps a narrative sentence from ever reading as a title — 2+ words,
 * 8–120 characters, no trailing sentence punctuation and no times/dates. It
 * may sit ANYWHERE in the account: detection reads the whole text, never a
 * fixed heading zone (owner request, 2026-11-02). Vehicle rows, back-rider
 * lines, field labels, certification and prose are excluded by meaning.
 *
 * @param {string} text the officer's (or enhanced) report text
 * @returns {string} the title line, trimmed, or '' when none is found
 */
export function detectIncidentTitle(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  // Labeled entry first: `TITLE:` / `SUBJECT:` / `RE:` / `OFFENSE:` …
  // anywhere in the report. The label itself is chrome; the value is the title.
  for (const raw of lines) {
    const m = /^\s*(incident title|title|subject|re|regarding|offense|offence|nature of incident)\s*:\s*(.+?)\s*$/.exec(raw);
    if (m && m[2].length >= 3 && !TITLE_NEVER.some((re) => re.test(m[2]))) {
      return m[2].trim();
    }
  }

  // Whole-text scan (owner request, 2026-11-02): a title may sit anywhere —
  // after the facts, between vehicle rows, near the end. Position is never
  // evidence; the MEANING of the line is. Field labels, vehicle and back-rider
  // rows, times/dates, certification and prose are excluded, then a
  // charge-bearing line wins over a merely uppercase one.
  const candidates = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    const line = raw.trim().replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, '').trim();
    if (line === '') continue;
    if (matchLabelLine(raw) !== null) continue;
    if (line.length < 8 || line.length > 120) continue;
    if (line.split(/\s+/).length < 2) continue;
    if (/[a-z]/.test(line)) continue; // prose is never a title
    if (/[.?!]$/.test(line)) continue; // sentences end; headings do not
    if (looksLikeTimeOrDate(line)) continue;
    if (/^V\d+\b/i.test(line)) continue; // a vehicle row, not a charge
    if (/\b(PLATE|OR|CR|LICEN[CS]E)\b/.test(line) && /\d/.test(line)) continue;
    if (TITLE_ROLE_OPENERS.has(line.split(/\s+/)[0].toLowerCase())) continue;
    if (TITLE_NEVER.some((re) => re.test(line))) continue;
    if (PROSE_OPENERS.has(line.split(/\s+/)[0].toLowerCase())) continue;
    candidates.push({ line, idx });
  }
  if (candidates.length === 0) return singleWordTitle(lines);
  // A title names an offense or an incident class. When one candidate does, it
  // is the title even when a merely uppercase body line precedes it. Nothing is
  // ever invented from a line that does not state a charge.
  const OFFENSE_HINT = /\b(RECKLESS|IMPRUDENCE|NEGLIGENCE|THEFT|ROBBERY|ASSAULT|INJURY|DAMAGE|HOMICIDE|MURDER|RAPE|VIOLENCE|FRAUD|ESTAFA|CARNAPPING|KIDNAPPING|DRUGS?|GAMBLING|ARSON|TRESPASS|THREAT|ABUSE|MISSING|LOST|VEHICULAR|ACCIDENT|PROPERTY)\b/i;
  const pick = candidates.find((c) => OFFENSE_HINT.test(c.line)) ?? candidates[0];
  return joinTitleFragments(lines, pick);
}

// A one-word ALL-CAPS incident name is a title too ("THEFT", "ROBBERY"): the
// blotter book states some incidents in one word, and a one-word heading must
// never be folded into the section above it. Only a KNOWN incident word
// qualifies, so an ordinary uppercase word in the body is never promoted.
const SINGLE_WORD_TITLES = new Set([
  'theft', 'robbery', 'arson', 'homicide', 'murder', 'rape', 'estafa', 'fraud',
  'kidnapping', 'carnapping', 'gambling', 'trespassing', 'abduction',
  'hijacking', 'swindling', 'extortion', 'smuggling', 'poaching', 'bribery',
  'cyberlibel', 'libel', 'slander', 'prostitution', 'vagrancy',
]);

function singleWordTitle(lines) {
  for (const raw of lines) {
    const line = raw.trim().replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, '').trim();
    if (line === '' || !SINGLE_WORD_TITLES.has(line.toLowerCase())) continue;
    if (line !== line.toUpperCase()) continue; // a heading shouts; prose does not
    if (matchLabelLine(raw) !== null) continue;
    return line;
  }
  return '';
}

// A title the OCR wrapped is still ONE heading: "RECKLESS IMPRUDENCE
// RESULTING TO DAMAGE TO PROPERTY" + "AND PHYSICAL INJURY" is the same charge,
// so a following ALL-CAPS fragment that continues the sentence is joined
// instead of being left behind as a lowercase paragraph in the next section.
const TITLE_CONTINUATION_START = /^(?:AND|OF|TO|FOR|IN|WITH|OR|RESULTING|CAUSING|DUE|THEREBY)\b/i;
const TITLE_CONTINUATION_END = /\b(?:AND|OF|TO|FOR|IN|WITH|OR|RESULTING|CAUSING|DUE|THEREBY)$/i;

function joinTitleFragments(lines, pick) {
  let title = pick.line;
  for (let i = pick.idx + 1; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (raw === '') break;
    if (/[a-z]/.test(raw)) break;
    if (/[.?!]$/.test(raw)) break;
    if (/\d/.test(raw)) break;
    if (raw.split(/\s+/).length < 2) break;
    if (matchLabelLine(lines[i]) !== null) break;
    if (TITLE_NEVER.some((re) => re.test(raw))) break;
    if (looksLikeTimeOrDate(raw)) break;
    if (/^V\d+\b/i.test(raw)) break;
    if (!TITLE_CONTINUATION_END.test(title) && !TITLE_CONTINUATION_START.test(raw)) break;
    title = `${title} ${raw}`;
  }
  return title;
}

const KNOWN_LABELS = new Set([
  'place',
  'place of incident',
  'place of occurrence',
  'location',
  'incident location',
  'time and date',
  'time and date of incident',
  'time/date',
  'time/date of incident',
  'date and time',
  'date and time of incident',
  'date of incident',
  'time of incident',
  't/d',
  'td',
  't/d of incident',
  'td of incident',
  'date reported',
  'time reported',
  'incident type',
  'type of incident',
  'nature of incident',
  'vehicles involved',
  'vehicle involved',
  'persons involved',
  'persons of interest',
  'complainant',
  'complaint',
  'victim',
  'victims',
  'suspect',
  'suspects',
  'respondent',
  'respondents',
  'witness',
  'witnesses',
  'facts',
  'facts of the case',
  'statement',
  'statement of facts',
  'remarks',
  'remark',
  'recorded by',
  'reported by',
  'requested by',
  'requestor',
  'purpose',
  'items involved',
  'property involved',
  'properties involved',
  'injuries',
  'injuries sustained',
  'findings',
  'notable findings',
  'action taken',
  'status',
  'disposition',
  'recommendation',
  'investigating officer',
  'blotter entry',
  'blotter reference',
  'subject',
]);

// A phrase that starts with one of these is prose, not a label, even when it
// is followed by a colon.
const PROSE_OPENERS = new Set([
  'the', 'a', 'an', 'he', 'she', 'it', 'they', 'we', 'i',
  'his', 'her', 'its', 'their', 'our', 'this', 'that', 'these', 'those',
  'on', 'in', 'at', 'when', 'while', 'after', 'before', 'during', 'upon',
]);

const normalizeLabel = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    // Spacing around a slash is presentational: "T / D", "T/D" and "t / d" are
    // one label, so an answer that spaces it differently is still the source's
    // own label (and still bolded by the same allow-list).
    .replace(/\s*\/\s*/g, '/')
    .replace(/[.:\-–—]+$/, '')
    .trim()
    .toLowerCase();

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Every field label the source actually carries, normalised the same way the
 * formatter compares them. Used to constrain Enhance Wording's output to the
 * source's own labels.
 *
 * @param {string} text
 * @returns {string[]} normalised label strings, in source order
 */
export function extractFieldLabels(text) {
  const out = [];
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const hit = matchLabelLine(line);
    if (hit) out.push(normalizeLabel(hit.label));
  }
  return [...new Set(out)];
}

/**
 * Compare an enhanced answer's field labels with the source's. The two modes
 * may never add a label the source did not carry, and Enhance Wording must not
 * silently drop one either — either answer is a document the officer did not
 * write, so the caller discards it instead of presenting it.
 *
 * @param {string} enhancedText the model's enhanced report
 * @param {string} sourceText the officer's own report
 * @returns {{invented:string[], missing:string[]}} normalised label names
 */
export function unsupportedFieldLabels(enhancedText, sourceText) {
  const source = new Set(extractFieldLabels(sourceText));
  const enhanced = new Set(extractFieldLabels(enhancedText));
  return {
    invented: [...enhanced].filter((label) => !source.has(label)),
    missing: [...source].filter((label) => !enhanced.has(label)),
  };
}

const plainWords = (value) =>
  String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Tokens worth comparing — words and numbers, never punctuation alone. */
const squashTokens = (value) =>
  plainWords(value).match(/[a-z0-9][a-z0-9'#./-]*/g) ?? [];

// A row a model can invent: "Vehicle 1: Plate 0718SR", "Suspected Cause: …".
// Deliberately WIDER than matchLabelLine — an added row is exactly the row the
// source's own vocabulary cannot vouch for, so the check must not lean on it.
const ADDED_ROW = /^([A-Za-z0-9][A-Za-z0-9 \/&'().-]{0,40}?)\s*:\s*(.*)$/;

function addedRowCandidate(line) {
  const m = ADDED_ROW.exec(String(line ?? '').trim());
  if (!m) return null;
  const label = m[1].replace(/\s+/g, ' ').trim();
  const words = label.split(' ').filter(Boolean);
  if (label === '' || label.length > 40) return null;
  if (!/[A-Za-z]/.test(label)) return null;
  if (label.includes(',')) return null;
  if (words.length > 5) return null;
  if (PROSE_OPENERS.has(words[0].toLowerCase())) return null;
  return { label: normalizeLabel(label), value: m[2].trim() };
}

/**
 * Remove rows the model ADDED to an enhanced report.
 *
 * Enhance Wording may correct grammar, spelling and punctuation; it may not
 * invent a field. In practice it still does — a vehicles block in the prose
 * comes back as a fresh `Vehicle 1: Plate 0718SR` row, a sentence from the
 * facts comes back under a made-up `Suspected Cause:` heading — and on the
 * sheet those read as extra inputs the officer never wrote.
 *
 * A line is removed only when BOTH hold: it opens with a label the source does
 * not carry, and the line itself is not already in the source. When the row's
 * value says something the source does not, the value is kept as a plain line
 * without the invented label, so no fact is ever lost to this cleanup. Every
 * other line — prose, the source's own labels, anything unchanged — passes
 * through untouched.
 *
 * @param {string} enhancedText the model's answer
 * @param {string} sourceText the arranged report it was asked to copy-edit
 * @returns {string} the answer with added rows removed
 */
export function stripAddedFieldRows(enhancedText, sourceText) {
  const sourceFlat = plainWords(sourceText);
  const sourceLabels = new Set(extractFieldLabels(sourceText));
  // Every row the SOURCE itself opens — read with this same (wider) rule, so a
  // `V1:` marker the officer wrote is a row label here even though the sheet's
  // label vocabulary does not list it. Only a label absent from BOTH sets can
  // be an addition.
  const sourceRowLabels = new Set(
    String(sourceText ?? '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => addedRowCandidate(line))
      .filter(Boolean)
      .map((row) => row.label),
  );
  const sourceTokens = new Set(squashTokens(sourceText));
  const out = [];
  for (const line of String(enhancedText ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      out.push(line);
      continue;
    }
    const row = addedRowCandidate(trimmed);
    const knownLabel =
      row && (sourceRowLabels.has(row.label) || sourceLabels.has(row.label) || KNOWN_LABELS.has(row.label));
    // Only an UNKNOWN label that the source does not already state is added ink.
    if (!row || knownLabel || sourceFlat.includes(plainWords(trimmed))) {
      out.push(line);
      continue;
    }
    // The row is the model's own: keep its words only when they are new, so a
    // restated fact cannot survive as a stray unlabelled line either.
    const valueTokens = squashTokens(row.value).filter((t) => t.length >= 3);
    const saysSomethingNew =
      valueTokens.length > 0 && valueTokens.some((t) => !sourceTokens.has(t));
    if (saysSomethingNew) out.push(row.value);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The words of a report, without the formatter's ink: what a caller shows in a
 * plain (non-rich) slot, or reads back to decide whether anything changed.
 * Mirrors the allow-list subset used here and keeps line breaks.
 *
 * @param {string} html
 * @returns {string}
 */
export function reportHtmlToPlain(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Whether the line opens with a field label this formatter may bold. */
function matchLabelLine(line) {
  const text = String(line ?? '').replace(/[ \t]+$/, '').trimStart();
  if (text === '') return null;

  // Colon form: "PLACE OF INCIDENT : value", "Place: value", "FACTS:".
  const colon = /^([^:]{1,70}?)\s*:\s*(.*)$/.exec(text);
  if (colon && isLabelCandidate(colon[1])) {
    return { label: colon[1].trim(), rest: colon[2], separator: ':' };
  }

  // Bare form: a KNOWN label standing alone on its line — "VEHICLES INVOLVED",
  // "REMARKS", "FACTS". Real blotters write their headings this way and the
  // account has no value to carry, so the line is the label and its rest is
  // empty. Only a known label may take this form: an arbitrary uppercase line
  // is prose, never a heading.
  if (KNOWN_LABELS.has(normalizeLabel(text)) && text.length <= 60) {
    return { label: text.trim(), rest: '', separator: ':' };
  }

  // Dot/dash form: "FACTS. value", "FACTS- value". Only a known report label
  // or a single uppercase word may take this form — an uppercase sentence
  // ending in a full stop is prose, not a label. The separator is returned so
  // the source's own punctuation is known (Arrange Only presents every label
  // with the sheet's colon, so "FACTS." reads as "Facts:").
  const dotted = /^([A-Za-z0-9][A-Za-z0-9 \/&'().\-]{1,60}?)\s*(\.|\-{1,2}|–|—)\s+(.*)$/.exec(text);
  if (dotted) {
    const candidate = dotted[1].trim();
    const known = KNOWN_LABELS.has(normalizeLabel(candidate));
    const singleCaps = !/\s/.test(candidate) && candidate === candidate.toUpperCase();
    if (known || singleCaps) {
      return { label: candidate, rest: dotted[3], separator: dotted[2] };
    }
  }
  return null;
}

function isLabelCandidate(raw) {
  const candidate = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (candidate === '' || candidate.length > 60) return false;
  if (!/[A-Za-z]/.test(candidate)) return false; // "8" in "8:40" is not a label
  // A field label is a name, never a clause: a comma means the phrase is part
  // of the sentence above it ("…, 19 yrs OLD, DOB: 03-22-…"), so it keeps its
  // place there instead of opening a section of its own.
  if (candidate.includes(',')) return false;
  const words = candidate.split(' ');
  if (words.length > 8) return false;
  if (KNOWN_LABELS.has(normalizeLabel(candidate))) return true;
  // A candidate ending in a digit is usually a time before its colon
  // ("MORE OR LESS 8" in "MORE OR LESS 8:40 AM"), not a label.
  if (/\d$/.test(candidate)) return false;

  // Any other label must be ALL CAPS, short, and not start like a sentence.
  if (candidate !== candidate.toUpperCase()) return false;
  if (!/^[A-Z0-9 \/&'().,\-]+$/.test(candidate)) return false;
  if (words.length > 6) return false;
  if (PROSE_OPENERS.has(words[0].toLowerCase())) return false;
  return true;
}

/**
 * Format a report's own text into the record's rich-text subset.
 *
 * The wording, numbers, names and every material detail are preserved. The
 * parts are arranged into the station's report order (entry date, title, place,
 * T/D, persons, vehicles, facts, remarks, recorded-by, certification); only the
 * layout, the existing labels' presentation and the vehicle rows' V-markers
 * change. Text that cannot be classified is kept, never dropped or forced into
 * a field.
 *
 * @param {string} text the officer's (or enhanced) report text
 * @param {{allowedLabels?: string[], sentenceCase?: boolean}} [options]
 *   `allowedLabels` — labels permitted to be bold
 *   `sentenceCase` — Arrange Only's formal sentence case (capitalisation only)
 * @returns {string} html using only the app's rich-text subset (<p>, <br>, <b>)
 */
export function formatIncidentReportHtml(text, { allowedLabels = null, sentenceCase = false } = {}) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (raw === '') return '';

  const allowed = Array.isArray(allowedLabels)
    ? new Set(allowedLabels.map(normalizeLabel))
    : null;

  // The title is a heading wherever the account stated it: emitted once, after
  // the report's entry timestamp, and removed from its original position. No
  // `INCIDENT TITLE:` label is ever added; a source that states none still
  // gets none.
  const title = detectIncidentTitle(raw);
  const sections = splitReportSections(raw, title);
  if (title !== '') sections.push({ rank: 15, order: -1, title: true, lines: [] });

  // Standard report order (owner request, 2026-11-02): a reordered account is
  // arranged by MEANING, not by where each part happened to sit. The blotter's
  // own entry timestamp heads the report, the incident title follows as the
  // heading, and PLACE OF INCIDENT / T/D OF INCIDENT / VEHICLES INVOLVED follow
  // the title directly on every report. Every section is kept — an unknown
  // label or unclassified prose is never discarded — and the words inside each
  // section are never changed.
  sections.sort((a, b) => a.rank - b.rank || a.order - b.order);

  // A part stated twice with the SAME words is one part (owner request,
  // 2026-11-02). This is what a page that already carries a copy of its own
  // report looks like — an arranged draft kept, then the same account inserted
  // again, or a restored autosave appended to the live page — and it printed as
  // FACTS, REMARKS and RECORDED BY twice over. Only byte-identical bodies are
  // collapsed: two different remarks are two remarks, and nothing is merged.
  const seenParts = new Set();
  const uniqueSections = sections.filter((section) => {
    if (section.title) return true;
    const body = section.lines.join('\n').replace(/\s+/g, ' ').trim().toLowerCase();
    if (body === '') return true;
    const key = `${section.rank}\u0000${body}`;
    if (seenParts.has(key)) return false;
    seenParts.add(key);
    return true;
  });

  const html = [];
  for (const section of uniqueSections) {
    if (section.title) {
      html.push(`<p><b>${escapeHtml(title)}</b></p>`);
      continue;
    }
    // A vehicle row the blotter wrapped stays ONE row (see
    // joinVehicleContinuations): the rider, licence and address details print
    // with the vehicle they describe, never as a loose line of their own.
    const lines = section.rank === 40 ? joinVehicleContinuations(section.lines) : section.lines;
    // Sentence-case state travels through the section: a line that continues
    // the previous sentence stays lower-case, a new sentence or paragraph
    // starts with a capital. A blank line starts a new paragraph.
    const state = { start: true };
    const body = lines
      .map((line) => {
        if (line.trim() === '') {
          state.start = true;
          return '';
        }
        return formatLine(line, allowed, section.rank === 40, { sentenceCase, state });
      })
      .join('<br>')
      .replace(/<br>\s*<br>/g, '</p><p>');
    if (body.trim() !== '') html.push(`<p>${body}</p>`);
  }
  return html.join('');
}

// Section ranks for the shared formatter. The order is the station's report
// order; the formatter never adds a part, it only places the parts present.
const SECTION_RANKS = [
  [/^(place|place of incident|place of occurrence|location|incident location)$/, 20],
  [/^(t\/d|td|time\/date|t\/d of incident|td of incident|time\/date of incident|time and date|time and date of incident|date and time|date and time of incident|date of incident|time of incident|date reported|time reported)$/, 30],
  [/^(vehicles? involved|vehicle)$/, 40],
  [/^(persons? involved|persons? of interest|victim|victims|suspect|suspects|respondent|respondents|complainant|complainants|witness|witnesses|backrider|driver|owner)$/, 50],
  [/^(facts|facts of the case|statement|statement of facts|narrative)$/, 60],
  [/^(remarks?|findings|notable findings)$/, 70],
  [/^(recorded by|reported by|requested by|requestor|investigating officer|purpose)$/, 80],
];

function sectionRank(hit) {
  const label = normalizeLabel(hit.label);
  for (const [re, rank] of SECTION_RANKS) if (re.test(label)) return rank;
  return 85; // an unknown label keeps its words, after the known report parts
}

/**
 * Split a report into movable sections: every line that opens a field label
 * starts a section (its continuation lines stay with it), a bare entry
 * timestamp is its own section, and unlabeled prose is the narrative. Blank
 * lines separate paragraphs inside a section; the title is removed here because
 * it is emitted once, as the heading. Nothing else is ever dropped.
 */
function splitReportSections(raw, title) {
  const sections = [];
  let current = null;
  let order = 0;
  let entryDateSeen = false;
  const start = (rank) => {
    current = { rank, order: order++, lines: [] };
    sections.push(current);
  };
  const titleNorm = title === '' ? '' : title.toUpperCase();
  // Normalized title key: the same heading restated in another case, with
  // quotes, extra spaces or sentence-case wording still names the same
  // charge (the screenshot defect: quoted capitals + sentence case + caps
  // printed the title three times). Any line whose key equals this one is
  // the title restated, wherever it sits, and is dropped here.
  const titleKey = titleNorm.replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lineKey = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  // A title the OCR wrapped is emitted once, whole: its leading fragments are
  // consumed here, in order, so none of them survives as stray prose below.
  let titleLeft = titleNorm;
  // Whether the line above finished its sentence. A wrapped row continues into
  // the next line without one, so a phrase there is the row's own words, not a
  // new heading (see the continuation guard below).
  let prevEndedSentence = true;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (current !== null) current.lines.push('');
      prevEndedSentence = true;
      continue;
    }
    const bare = trimmed.replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, '').trim();
    // The title, wherever it sat: emitted once at the top. Normalized so a
    // restatement in another case/spacing/punctuation still matches.
    if (titleKey !== '' && lineKey(bare) === titleKey) continue;
    if (titleLeft !== '') {
      const upper = bare.toUpperCase();
      if (titleLeft === upper || titleLeft.startsWith(upper + ' ')) {
        titleLeft = titleLeft.slice(upper.length).trimStart();
        continue;
      }
      // Any other line ends the title run: a fragment is never matched out of
      // order, or across an unrelated line.
      titleLeft = '';
    }
    // A labelled source title ("TITLE: …") is the same heading; its label is
    // chrome, not a field the officer wrote.
    const labelledTitle = /^\s*(incident title|title|subject|re|regarding|offense|offence|nature of incident)\s*:\s*(.+?)\s*$/i.exec(line);
    if (labelledTitle && titleKey !== '' && lineKey(labelledTitle[2]) === titleKey) continue;

    const hit = matchLabelLine(line);
    if (hit !== null) {
      // A continuation guard: an UNKNOWN "label" that follows a line which did
      // not finish its sentence is that line's own words. A blotter row wraps
      // ("…, 19 yrs" / "OLD, DOB: 03-22- …"), and hoisting the wrapped half
      // into its own section tears the row apart. The line therefore keeps its
      // place; only a label the sheet knows starts a new section there.
      const known = KNOWN_LABELS.has(normalizeLabel(hit.label));
      if (!prevEndedSentence && !known) {
        if (current === null) start(60);
        current.lines.push(line);
        prevEndedSentence = endsSentence(trimmed);
        continue;
      }
      start(sectionRank(hit));
      current.lines.push(line);
      prevEndedSentence = endsSentence(trimmed);
      continue;
    }
    if (/^this certification is issued\b/i.test(trimmed)) {
      start(90);
      current.lines.push(line);
      prevEndedSentence = endsSentence(trimmed);
      continue;
    }
    // Only the report's own head timestamp is hoisted ahead of the title; a
    // bare date inside the account's body stays with the words around it.
    if (!entryDateSeen && isBareTimestamp(trimmed)) {
      entryDateSeen = true;
      start(10);
      current.lines.push(line);
      prevEndedSentence = endsSentence(trimmed);
      continue;
    }
    if (current === null) start(60); // unlabeled prose = the narrative
    current.lines.push(line);
    prevEndedSentence = endsSentence(trimmed);
  }
  for (const section of sections) {
    while (section.lines.length > 0 && section.lines[0].trim() === '') section.lines.shift();
    while (section.lines.length > 0 && section.lines[section.lines.length - 1].trim() === '') section.lines.pop();
    // Spacing: one blank line between paragraphs inside a section — a run
    // of blanks from a pasted account collapses to one, so no stray <br>
    // survives the join below.
    const collapsed = [];
    for (const ln of section.lines) {
      if (ln.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue;
      collapsed.push(ln);
    }
    section.lines = collapsed;
  }
  return sections;
}

/**
 * Join a wrapped vehicle row onto the row it belongs to. Inside VEHICLES
 * INVOLVED only a V-run opens a row; a line that continues the row above it —
 * the row had not finished its sentence — is that row's own words, so the two
 * print as one row. A blank line, a completed sentence or a new V-run ends it.
 *
 * @param {string[]} lines the vehicles section's source lines
 * @returns {string[]}
 */
function joinVehicleContinuations(lines) {
  const out = [];
  for (const line of lines) {
    const text = String(line ?? '');
    const prev = out.length > 0 ? out[out.length - 1] : '';
    const continues =
      prev.trim() !== '' &&
      text.trim() !== '' &&
      !/^\s*V\d+\b/i.test(text) &&
      !endsSentence(prev);
    if (continues) {
      out[out.length - 1] = `${prev} ${text.trim()}`;
      continue;
    }
    out.push(line);
  }
  return out;
}

function formatLine(line, allowed, vehicles = false, { sentenceCase = false, state = null } = {}) {
  const original = String(line ?? '').replace(/[ \t]+$/, '');
  const hit = matchLabelLine(original);
  if (hit === null) {
    // A vehicle row's own marker is chrome, like a field label: V1:, V2:, …
    // bold, with the colon the sheet's labels use, every word after it
    // untouched except for Arrange Only's capitalisation pass. Only a row that
    // OPENS with the marker and only inside VEHICLES INVOLVED takes it, so a
    // "V2" mentioned inside the facts prose is never dressed as a row.
    if (vehicles) {
      const marker = /^(\s*)(V\d+)(?=[\s:.,;]|$)[\s:.,;]*/i.exec(original);
      if (marker) {
        const rest = original.slice(marker[0].length);
        const cased = sentenceCase && rest !== '' ? caseText(rest, { start: true, vehicleRow: true }) : rest;
        if (sentenceCase && state) state.start = endsSentence(cased);
        return `${escapeHtml(marker[1])}<b>${escapeHtml(marker[2])}:</b>${cased === '' ? '' : ` ${escapeHtml(cased)}`}`;
      }
    }
    const cased = sentenceCase ? caseText(original, { start: state?.start ?? true }) : original;
    if (sentenceCase && state) state.start = endsSentence(cased);
    return escapeHtml(cased);
  }

  const normalized = normalizeLabel(hit.label);
  if (allowed !== null && !allowed.has(normalized)) {
    // Not one of the source's labels (an invented heading in an enhanced
    // answer): leave it exactly as text, never bold it.
    if (sentenceCase && state) state.start = endsSentence(original);
    return escapeHtml(original);
  }

  const label = hit.label.replace(/\s+/g, ' ').trim();
  const rest = hit.rest.replace(/^[ \t]+/, '');
  const kind = sentenceCase ? labelValueKind(normalized) : null;
  const cased = sentenceCase && rest !== ''
    ? caseText(rest, { start: true, placeValue: kind === 'place', nameValue: kind === 'name' })
    : rest;
  // A facts label stands on its own line: what follows it opens a sentence.
  if (sentenceCase && state) {
    state.start = cased === '' && FACT_LABELS.test(normalized) ? true : endsSentence(cased);
  }
  // Arrange Only names the label the way the sheet writes it (sentence case,
  // T/D spelled out as Time/Date) and closes it with a colon — "FACTS." is
  // presented as "Facts:" with the facts following on the next line. The other
  // mode keeps the label exactly as the answer wrote it — except the place
  // label, which always prints short (owner request: "Place:", never the
  // long form), keeping the source's own capitalisation.
  const placeShort = label === label.toUpperCase() ? 'PLACE' : 'Place';
  const shownLabel = sentenceCase
    ? arrangeLabelName(normalized)
    : (/^(?:place|place of incident|place of occurrence|location|incident location)$/.test(normalized) ? placeShort : label);
  const head = `<b>${escapeHtml(shownLabel + ':')}</b>`;
  if (cased === '') return head;
  if (sentenceCase && FACT_LABELS.test(normalized)) return `${head}<br>${escapeHtml(cased)}`;
  return `${head} ${escapeHtml(cased)}`;
}

// Arrange Only's label names (owner request, 2026-11-02). Only the label's own
// presentation changes: sentence case instead of shouting, and the T/D
// shorthand read as Time/Date. An unknown label keeps its own words.
const FACT_LABELS = /^(?:facts|facts of the case|statement|statement of facts|narrative)$/;

function arrangeLabelName(label) {
  if (/^(?:t\/?d(?: of incident)?|time ?\/ ?date(?: of incident)?|time and date|time and date of incident|date and time|date and time of incident|date of incident|time of incident)$/.test(label)) {
    return 'Time/Date';
  }
  if (FACT_LABELS.test(label)) return 'Facts';
  if (/^remarks?$/.test(label)) return 'Remarks';
  // Owner request: the place label prints short — "Place:", never the long form.
  if (/^(?:place|place of incident|place of occurrence|location|incident location)$/.test(label)) {
    return 'Place';
  }
  const words = label.split(' ').filter(Boolean);
  return words
    .map((word, i) => {
      const low = word.toLowerCase();
      if (KEEP_CAPS.has(low)) return word.toUpperCase();
      if (PROPER_WORDS.has(low)) return PROPER_WORDS.get(low);
      return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
    })
    .join(' ');
}

// ---- Arrange Only: formal sentence case ----------------------------------
// Capitalisation only. These helpers never add, remove or reorder a word and
// never touch a number, plate, OR/CR/licence number, DOB or V-marker. The
// report's own name/place slots, the Naga gazetteer, known acronyms and runs of
// unknown ALL-CAPS words are protected as proper nouns; everything else that
// was shouting is written in ordinary sentence case.

const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'on', 'onto', 'or', 'over', 'per', 'the', 'to', 'up', 'via',
  'with',
]);

// Acronyms, document codes and vehicle identifiers that keep their capitals.
const KEEP_CAPS = new Set([
  'dob', 'cr', 'pnp', 'nbi', 'lto', 'bfp', 'afp', 'ctu', 'cctv',
  'ra', 'pwd', 'ip', 'dpwh', 'deped', 'comelec', 'pdea', 'ioc', 'nmax', 'xrm',
  'cbr', 'tct', 'ctc', 'jr', 'sr', 'ii', 'iii', 'iv',
]);

// Proper words that are safe to recognise anywhere in a report.
const PROPER_WORDS = new Map([
  ['naga', 'Naga'],
  ['cebu', 'Cebu'],
  ['philippines', 'Philippines'],
  ['filipino', 'Filipino'],
  ['filipina', 'Filipina'],
  ['cebuano', 'Cebuano'],
  ['bisaya', 'Bisaya'],
  ['tagalog', 'Tagalog'],
  ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
  ['january', 'January'], ['february', 'February'], ['march', 'March'],
  ['april', 'April'], ['june', 'June'], ['july', 'July'], ['august', 'August'],
  ['september', 'September'], ['october', 'October'], ['november', 'November'],
  ['december', 'December'],
]);

// The City of Naga's own place names, so a place slot keeps its conclusive
// spelling (never a correction — only the case of the words already there).
const PLACE_CANONICAL = new Map();
for (const name of NAGA_BARANGAYS) PLACE_CANONICAL.set(name.toLowerCase(), name);
for (const sitio of NAGA_SITIOS) PLACE_CANONICAL.set(sitio.name.toLowerCase(), sitio.name);

// Ordinary English words and report vocabulary. A word here is never treated
// as a proper noun merely because the source typed it in capitals.
const COMMON_WORDS = new Set(String.raw`
a about above across after again against ago all almost along already also although always am an and another any anyone anything are around as at away back be because been before behind being below beside between beyond both but by can cannot could did do does doing done down during each either else even ever every everyone everything except far few for from further get gets getting got had has have having he her here hers herself him himself his how however i if in inside instead into is it its itself just last later least less let like likely may maybe me might mine more most much must my myself near nearly neither never next no none nor not nothing now of off often on once one only onto or other others otherwise our ours ourselves out outside over own past per perhaps plus pm rather really same she should since so some someone something sometimes still such than that the their theirs them themselves then there these they this those though through throughout thus to together too toward towards under until up upon us very via was we were what whatever when whenever where whereas wherever whether which while who whom whose why will with within without would yet you your yours yourself yourselves

accept accompany accuse act add admit affect allege allow alter appear apply approach argue arrange arrest arrive ask attack attempt attend avoid beat become begin believe belong bite block board bring burn buy call capture carry cause cease check claim clarify close collide come commit compare complain complete comply concern conduct confirm confront consider contain continue control cover create cross damage deal decide declare decline deliver deny depart describe destroy detain determine die disclose discover discuss dismiss dispute drive drop employ encounter end enter escape establish evacuate examine explain face fail fall feel fight file find fire flee follow force forget free gain gather get give go grab happen harm have hear help hide hit hold identify ignore include indicate inform injure inquire insist inspect intend interview investigate involve issue join keep kill know land last lead learn leave lend let lie live locate look lose maintain make manage mark meet mention move note notify obtain occur offer open operate order own park pass pay perform permit pick place plan point possess post prepare present prevent proceed produce promise protect provide pursue push put question reach receive record recover refer refuse regain regard register reject release remain remove render reply report request require rescue respond result retain return reveal ride run save say see seek seize sell send serve set settle show sign sit speak stand start state stay steal stop strike submit suffer suggest supply support suspect take talk tell threaten throw transport travel treat turn understand use verify visit wait walk want warn watch wear work write

accident account action address adult age agency allegation ambulance amount area arrival assault assistance attempt attention authority bag barangay barrio body bridge building business car care case cash cause center certificate check child circumstance city claim class clothing collision company complainant complaint condition contact content copy council court crime damage date day death debris deed department description detail direction distance doctor document driver driveway drug duty edge effect emergency end entry event evidence examination example fact family father female fence file finding fire floor force form front gate group guard hand head health help hill home hospital hour house household identity incident information injury inquiry interview item jail job kilometer land lane law left legal letter level license lie life light line list location loss lot male man manner market matter medical member message meter mile minute mode moment money month morning mother motion motorcycle name nation nature night number object office officer operation order owner page parent part party passenger patience person phone photo place plate point police portion possession post power presence problem procedure process property prosecution province purpose quarter question reason receipt record recovery region relation remark report request residence resident response result rider right road robbery role room route rule scene school search seat section security sentence series service session sex side sign situation size source speed statement station status street subject suspect table team term time title today town traffic treatment tree truth type unit use value vehicle version victim view village violence visit wallet way weapon weather week witness woman work year yesterday

able accidental accidentally active actual additional approximate bad black blue brief calm certain clear close common complete current daily dark dead different difficult direct downhill due early easy empty entire equal exact false familiar fast female final financial following formal free full general good green hard heavy high honest immediate injured innocent large late legal light limited local long low main major male medical mental minor missing multiple necessary new normal official old only open opposite other own partial past personal physical possible present previous primary private probable proper public quick real recent red regular related relevant responsible right safe same serious several short significant similar simple single small social special specific stable strong sudden sufficient sure temporary total true unknown unusual uphill valid various verbal visible white whole wrong young

again almost already also always away back down here now once only still then there today tomorrow yesterday morning afternoon evening night midnight noon north south east west left right front back side near far above below inside outside top bottom

one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand first second third

more less about around approximately some any all both each every few many most several

with without within into onto from upon during after before while when where who whom whose which what whatever however therefore because since although though unless until if then than that this these those there their they them he she it we you i his her its our your my

at on in of to for by as per via and or nor but so yet not no none never

the a an

is are was were be been being am do does did done have has had having can could may might must shall should will would

said says stated reported allegedly according claimed claim revealed investigation facts remark remarks certification issued request legal purpose purposes serve what ever

vehicle vehicles driver drivers backrider owner owned driven driving plate plates license registration number or cr dob yrs years old age male female resident address purok sitio barangay brgy city province street road highway avenue lane direction opposite uphill downhill traveling travelling travel collided collision hit encroach encroached accidentally resulting resulted damage damaged undetermined amount portion left right side physical injuries injury sustained bring brought brougt medical treatment hospital infirmary clinic for to at in on buying goods bought buy

parties party amicably settled settle incident incidents complainant complaint respondent victim suspect witness owner driver backrider passenger rider person persons individual individuals group groups

above below under over between among through throughout against toward towards across along around near behind beside beyond during before after since until while when whenever where wherever who whoever whom whomever whose which whichever that whatever this these those there here

full empty blank missing incomplete unknown unidentified undetermined approximately around more less
`.trim().split(/\s+/));

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'in', 'at', 'on', 'to', 'from', 'with', 'by', 'for',
  'of', 'and', 'or', 'as', 'into', 'onto', 'over', 'under', 'upon',
  'during', 'after', 'before', 'near', 'around',
]);

const ENDS_SENTENCE = /[.!?]["'”’)]*\s*$/;
const endsSentence = (value) => ENDS_SENTENCE.test(String(value ?? '').trim());

const capitalizeFirst = (word) => {
  const i = word.search(/[A-Za-z]/);
  if (i === -1) return word;
  return word.slice(0, i) + word[i].toUpperCase() + word.slice(i + 1);
};

function labelValueKind(label) {
  if (/^(place|place of incident|place of occurrence|location|incident location)$/.test(label)) return 'place';
  if (/^(recorded by|reported by|requested by|requestor|investigating officer)$/.test(label)) return 'name';
  return null;
}

function wordTokens(text) {
  const out = [];
  const re = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ i: out.length, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function isCodeToken(token, text) {
  const before = text[token.start - 1] ?? '';
  const after = text[token.end] ?? '';
  return /\d/.test(before) || /\d/.test(after);
}

function properToken(word, { place = false, first = false } = {}) {
  const lower = word.toLowerCase();
  const canonical = place ? PLACE_CANONICAL.get(lower) : null;
  if (canonical) return canonical;
  const parts = word.split(/([’'\-])/);
  let out = '';
  let atStart = first;
  let afterPlaceHyphen = false;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i % 2 === 1) {
      out += part;
      afterPlaceHyphen = place && part === '-';
      continue;
    }
    if (part === '') continue;
    const low = part.toLowerCase();
    if (KEEP_CAPS.has(low)) {
      out += part.toUpperCase();
      atStart = false;
      afterPlaceHyphen = false;
      continue;
    }
    if (PROPER_WORDS.has(low)) {
      out += PROPER_WORDS.get(low);
      atStart = false;
      afterPlaceHyphen = false;
      continue;
    }
    if ((!atStart && MINOR_WORDS.has(low)) || afterPlaceHyphen) out += low;
    else out += low.charAt(0).toUpperCase() + low.slice(1);
    atStart = false;
    afterPlaceHyphen = false;
  }
  return out;
}

function caseWord(token, { start, span, line, next }) {
  const word = token.text;
  if (isCodeToken(token, line)) return word;
  const lower = word.toLowerCase();
  const lookup = lower.replace(/['’]s$/, '');
  const allCaps = word === word.toUpperCase() && /[A-Z]/.test(word);

  if (lookup === 'i') return 'I';
  // OR is a document code only when a number follows it; otherwise it is the
  // conjunction and follows the ordinary word.
  if (lookup === 'or' && /^\s*[:.\-]?\s*\d/.test(next)) return 'OR';
  // AM/PM are clock markers only after a time; "I AM" is the verb.
  if ((lookup === 'am' || lookup === 'pm') && /\d\s*$/.test(line.slice(0, token.start))) {
    return lookup.toUpperCase();
  }
  if (KEEP_CAPS.has(lookup)) return word.toUpperCase();
  if (PROPER_WORDS.has(lower)) return PROPER_WORDS.get(lower);

  if (span) {
    if (!allCaps && /[A-Z]/.test(word.slice(1))) return word;
    return properToken(word, { place: span.kind === 'place', first: span.first });
  }

  if (allCaps) {
    // A lone capital letter that is not an article is an identifier (V, S).
    if (word.length === 1 && !COMMON_WORDS.has(lookup)) return word;
    const out = lookup;
    return start ? capitalizeFirst(out) : out;
  }

  if (start) return capitalizeFirst(word);
  return word;
}

function placeSpanEnd(text, start) {
  const rest = text.slice(start);
  const STARTER = /^(?:NO|WITH|THE|A|AN|HE|SHE|THEY|THIS|THAT|UPON|INVESTIGATION|BOTH|ALL|AFTER|AT|ON|IN|FOR|TO|FROM)\b/i;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === ';') return start + i;
    if (ch === '.') {
      const after = rest.slice(i + 1).trimStart();
      if (after === '' || STARTER.test(after)) return start + i;
    }
  }
  return text.length;
}

function nameSpanEnd(text, start) {
  const rest = text.slice(start);
  const BOUNDARY = /^(?:MALE|FEMALE|FILIPINO|FILIPINA|DOB|AGE|YRS|YEARS|OLD|RESIDENT|AND|WITH|A|AN|THE|WHO|WHOSE|WHICH|FOR|TO|FROM|AT|IN|ON|OF|NO)\b/i;
  let i = 0;
  while (i < rest.length && /[\s"“]/.test(rest[i])) i += 1;
  for (; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === ',' || ch === ';' || ch === '.' || ch === '"' || ch === '”') return start + i;
    if (ch === ' ' && i + 1 < rest.length && BOUNDARY.test(rest.slice(i + 1))) return start + i;
  }
  return text.length;
}

function properSpans(text, tokens, { placeValue = false, nameValue = false, vehicleRow = false } = {}) {
  const spans = new Map();
  const mark = (fromIdx, toIdx, kind) => {
    let first = true;
    for (let i = fromIdx; i <= toIdx && i < tokens.length; i += 1) {
      if (spans.has(i)) {
        first = false;
        continue;
      }
      spans.set(i, { kind, first });
      first = false;
    }
  };
  const markRange = (from, to, kind) => {
    const inside = tokens.filter((t) => t.start >= from && t.end <= to);
    if (inside.length > 0) mark(inside[0].i, inside[inside.length - 1].i, kind);
  };

  if (placeValue) mark(0, tokens.length - 1, 'place');
  if (nameValue) mark(0, tokens.length - 1, 'name');

  // The make/model that opens a vehicle row ("YAMAHA NMAX WITH PLATE …").
  if (vehicleRow && tokens.length > 0) {
    const first = tokens[0];
    const rest = text.slice(first.start);
    const boundary = /\bWITH\b|\bPLATE\b|[,;.]/i.exec(rest);
    const end = boundary ? first.start + boundary.index : text.length;
    for (const t of tokens) {
      if (t.start < first.start || t.end > end) continue;
      const low = t.text.toLowerCase();
      if (COMMON_WORDS.has(low) && !KEEP_CAPS.has(low)) continue;
      mark(t.i, t.i, 'name');
    }
  }

  // "RESIDENT OF PUROK SAMBAG, INOBURAN, …" — the address is a place.
  const PLACE_MARKER = /\bRESIDENT\s+OF\b(?:\s*:\s*|\s+)/gi;
  for (const m of text.matchAll(PLACE_MARKER)) {
    const start = m.index + m[0].length;
    markRange(start, placeSpanEnd(text, start), 'place');
  }

  // Name slots. A comma/period ends a name, so a following role descriptor is
  // ordinary wording; longest alternatives first so OWNED AND DRIVEN BY is one
  // slot, not two. Bare role words (DRIVER, BACKRIDER, …) are NOT slots: in
  // prose they are followed by "and", "of" or another role, not a name. A slot
  // that opens with a function word ("driven by the suspect") is prose too.
  const NAME_MARKER = /\b(?:OWNED\s+(?:AND\s+DRIVEN\s+)?BY|DRIVEN\s+BY|RECORDED\s+BY|REPORTED\s+BY|REQUESTED\s+BY|REQUEST\s+OF|INVESTIGATING\s+OFFICER|NAMED|ALIAS|KNOWN\s+AS)\b(?:\s*:\s*|\s+)/gi;
  for (const m of text.matchAll(NAME_MARKER)) {
    const start = m.index + m[0].length;
    const first = tokens.find((t) => t.start >= start);
    if (first && FUNCTION_WORDS.has(first.text.toLowerCase())) continue;
    markRange(start, nameSpanEnd(text, start), 'name');
  }

  // Facility names: "NAGA INFIRMARY" is a name; "the hospital" is not.
  const FACILITY = new Set([
    'hospital', 'infirmary', 'clinic', 'school', 'college', 'university',
    'church', 'market', 'station', 'office', 'center', 'centre', 'court',
    'hall', 'park', 'bridge', 'laboratory',
  ]);
  for (const t of tokens) {
    if (!FACILITY.has(t.text.toLowerCase())) continue;
    const idxs = [];
    for (let i = t.i - 1; i >= Math.max(0, t.i - 2); i -= 1) {
      const prev = tokens[i];
      if (FUNCTION_WORDS.has(prev.text.toLowerCase())) break;
      idxs.unshift(i);
    }
    const hasProper = idxs.some((i) => {
      const low = tokens[i].text.toLowerCase();
      return !COMMON_WORDS.has(low) || PROPER_WORDS.has(low);
    });
    if (hasProper) mark(idxs[0], t.i, 'name');
  }

  // Two or more consecutive unknown ALL-CAPS words are a name/place written in
  // capitals. A single unknown word is ordinary prose (often a typo), so it is
  // left to the sentence-case path.
  let run = [];
  const flush = () => {
    if (run.length >= 2) mark(run[0], run[run.length - 1], 'name');
    run = [];
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const low = t.text.toLowerCase();
    const allCaps = t.text === t.text.toUpperCase() && /[A-Z]/.test(t.text);
    const unknown = allCaps && !COMMON_WORDS.has(low) && !PROPER_WORDS.has(low) && !isCodeToken(t, text);
    if (!unknown) {
      flush();
      continue;
    }
    if (run.length > 0) {
      const gap = text.slice(tokens[run[run.length - 1]].end, t.start);
      if (/[,.;:!?]/.test(gap) || spans.has(t.i)) flush();
    }
    run.push(t.i);
  }
  flush();
  return spans;
}

function caseText(text, { start = true, vehicleRow = false, placeValue = false, nameValue = false } = {}) {
  const tokens = wordTokens(text);
  if (tokens.length === 0) return text;
  const spans = properSpans(text, tokens, { vehicleRow, placeValue, nameValue });
  let out = '';
  let last = 0;
  let atStart = start;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const gap = text.slice(last, token.start);
    if (i > 0 && /[.!?]/.test(gap)) atStart = true;
    out += gap;
    out += caseWord(token, { start: atStart, span: spans.get(i), line: text, next: text.slice(token.end) });
    atStart = false;
    last = token.end;
  }
  out += text.slice(last);
  return out;
}
