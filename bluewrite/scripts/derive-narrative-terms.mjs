#!/usr/bin/env node
// BlueWrite — Phase 6 Stage 2: derive the machine-readable terminology table
// from the glossary.
//
//   node scripts/derive-narrative-terms.mjs            # write the derived file
//   node scripts/derive-narrative-terms.mjs --check    # fail if it is stale
//   node scripts/derive-narrative-terms.mjs --worksheet # also write the review sheet
//
// The glossary (docs/bluewrite-police-terminology-glossary.md §13) is the
// source of truth; resources/ai/narrative_terms.json is DERIVED from it and
// must never be edited first. This mirrors the existing type_vocabulary.json
// rule: update the glossary first, then propagate.
//
// APPROVED ENTRIES ONLY. Drafts are inert by construction — deriveApproved()
// drops them, so nothing downstream can see a draft even by accident.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseGlossaryTerms,
  validateEntries,
  deriveApproved,
  serialiseDerived,
  GLOSSARY_SECTION_HEADING,
} from '../src/lib/narrativeTerms.js';
import { setLanguageRegistry } from '../src/lib/languageRegistry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const glossaryPath = resolve(root, 'docs/bluewrite-police-terminology-glossary.md');
const derivedPath = resolve(root, 'resources/ai/narrative_terms.json');
const worksheetPath = resolve(root, 'docs/phase6-stage2-review-worksheet.md');
const registryPath = resolve(root, 'resources/ai/language_registry.json');

// Phase 6 Stage 5 (Track A, D3) — the languages the table covers come from the
// language registry. Install it ONCE here: this script runs in Node, outside
// the app's bootstrap, so nothing else would have set it.
setLanguageRegistry(JSON.parse(readFileSync(registryPath, 'utf8')).languages);

const args = new Set(process.argv.slice(2));

const markdown = readFileSync(glossaryPath, 'utf8');
const { entries, errors: parseErrors } = parseGlossaryTerms(markdown);
const errors = [...parseErrors, ...validateEntries(entries)];

if (errors.length > 0) {
  console.error(`The glossary §13 table is invalid — nothing was written:\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const approved = deriveApproved(entries);
const drafts = entries.filter((e) => e.status === 'draft');
const output = serialiseDerived(approved);

if (args.has('--check')) {
  let current = '';
  try {
    current = readFileSync(derivedPath, 'utf8');
  } catch {
    current = '<missing>';
  }
  if (current !== output) {
    console.error(`resources/ai/narrative_terms.json is STALE — re-run the derivation.`);
    process.exit(1);
  }
  console.log(`resources/ai/narrative_terms.json is up to date (${approved.length} approved entries).`);
  process.exit(0);
}

writeFileSync(derivedPath, output, 'utf8');
console.log(
  `Wrote resources/ai/narrative_terms.json — ${approved.length} approved, ${drafts.length} draft (drafts excluded).`,
);
if (approved.length === 0) {
  console.log('  note: zero approved entries means the officer lookup shows its "not yet published" empty state.');
}

if (args.has('--worksheet')) {
  writeFileSync(worksheetPath, buildWorksheet(drafts), 'utf8');
  console.log(`Wrote docs/phase6-stage2-review-worksheet.md — ${drafts.length} draft candidates for review.`);
}

/**
 * The review worksheet for the station's records/legal officer. Draft entries
 * only; confidence is stated HERE and nowhere in the glossary, so nothing in
 * the source of truth can be mistaken for an approval.
 */
function buildWorksheet(draftList) {
  // Editorial confidence notes. Kept beside the worksheet builder, never in the
  // glossary: the glossary records the term, not the author's certainty.
  const confidence = {
    'ceb-sakpan': 'HIGH — nasakpan / gisakpan are ordinary Cebuano forms for "caught"; "apprehended" is the least-committal accurate English.',
    'ceb-pusil': 'MEDIUM — gipusil reads as "shot" (at). The outcome must not be read in.',
    'ceb-dunggab': 'MEDIUM — gidunggab reads as "stabbed".',
    'ceb-samad': 'MEDIUM — samad is a generic injury word; the formal register names the wound type, which the source does not.',
    'ceb-bun-og': 'LOW — blunt-force injury/contusion register is a station convention; confirm the preferred English.',
    'ceb-reklamo': 'MEDIUM.',
    'ceb-tubag': 'MEDIUM.',
    'ceb-saksi': 'HIGH.',
    'tl-huli': 'HIGH — nahuli / hinuli are ordinary Tagalog forms for "caught".',
    'tl-binaril': 'MEDIUM.',
    'tl-saksak': 'MEDIUM.',
    'tl-sugat': 'MEDIUM — generic injury word.',
    'tl-reklamo': 'MEDIUM.',
    'tl-sagot': 'MEDIUM.',
    'tl-saksi': 'HIGH.',
  };

  // Terms the brief lists that were NOT drafted, because a guess would be
  // worse than a blank. Editorial — this is the reviewer's worklist.
  const toBeSupplied = [
    ['natulog', 'The plan §4 lists this, but its incident-report sense is unclear ("slept"). Supplied by the officer, or dropped.'],
    ['pasa', 'Overlaps bun-og; the bruise/contusion distinction is a station convention. Two senses must not be merged by the software.'],
    ['Statute — RA 8353 (Rape / Sexual Assault)', 'SENSITIVE TYPE — no entry drafted. The `sensitivity` instruction is written for English register; a Cebuano/Tagalog rendering of the offence carries real harm if wrong.'],
    ['Statute — RA 9262 (Domestic Violence)', 'SENSITIVE TYPE — no entry drafted. Same reason; "Respondent", never "Suspect".'],
    ['Statute — RA 9165 (Drug-Related Incident)', 'A statute citation is language-neutral, so it does not fit a table whose `language` column is only ceb/tl. Needs a format decision before an entry is written.'],
    ['Statute — Article 308 / Article 294 (Revised Penal Code)', 'Same language-neutral citation question as RA 9165.'],
  ];

  const rows = draftList.map((e) => {
    const wrong = e.do_not_render_as.length > 0 ? e.do_not_render_as.join('; ') : '—';
    return (
      `| ${e.id} | ${e.language} | ${e.term} | ${e.forms.join('; ')} | ${e.category} | ` +
      `**${e.english}** | ${wrong} | ${e.note || '—'} | ${confidence[e.id] ?? '—'} | ☐ | ☐ | ☐ | |`
    );
  }).join('\n');

  const supplied = toBeSupplied
    .map(([term, why]) => `| ${term} | ${why} | ☐ | ☐ | |`)
    .join('\n');

  return `# Phase 6 Stage 2 — review worksheet: approved report terminology

**AI-drafted candidates — require your review. NOTHING HERE IS APPROVED.**

This table was drafted with AI assistance and has **not** been checked by a
speaker of Bisaya or Tagalog. Every row below is a \`draft\` entry in
\`docs/bluewrite-police-terminology-glossary.md\` §13. **No entry is approved**,
so the officer-facing lookup currently publishes **nothing**. Terms go live only
when you approve them in the glossary and the derived file is re-generated.

You are the **records/legal officer** (or the officer the station names). For
each row, mark **Approve**, **Change** (write the correction) or **Reject**.
Approval is recorded in the glossary as \`status: approved\` with your
identification in \`approved_by\` and the date (\`YYYY-MM-DD\`) in \`approved_on\`.

Scope reminder: this is **report terminology, not a translator**. An entry says
*"the report renders this term exactly this way"*; it does not translate
sentences, and a word not in the table is simply not covered.

Generated by \`scripts/derive-narrative-terms.mjs --worksheet\`; do not edit by
hand — edit the glossary and re-run.

## 1. Draft candidates — approve / change / reject

| id | language | term | forms | category | english (official) | do NOT render as | note | confidence (AI's, not a review) | Approve | Change | Reject | Comments |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## 2. Terms to be supplied by you (no entry was drafted)

These were left blank on purpose: a guess is worse than a blank. Write the
official English rendering, or mark it "drop".

| term / class | why it is blank | Supply | Drop | Comments |
| --- | --- | --- | --- | --- |
${supplied}

## 3. Sensitive-type reminder

No entries were drafted for **Rape / Sexual Assault** or **Domestic Violence**
(the two \`SENSITIVE_TYPES\`). Their rendering is a real harm risk if wrong, and
their \`sensitivity\` instruction was written for English register. Their terms
are yours to supply, if any. Stage 3's evaluation will treat both types as
mandatory cases regardless.
`;
}
