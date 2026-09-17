# Walkthrough — fill a sample report and generate an AI narrative

This walks you through trying BlueWrite's AI narrative generator on a
pre-filled sample report, end to end.

## 0. One-time setup

```bash
cd bluewrite

# Database + tables + users
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS bluewrite CHARACTER SET utf8mb4"
mysql -u root -p bluewrite < migrations/001_schema.sql

# Sample users (all passwords: Passw0rd!23)
php database/seed.php

# The SAMPLE filled report (a Theft case owned by e.ramos)
php database/sample_report.php
```

`sample_report.php` needs `config/config.php` (copy from
`config/config.sample.php` and set DB credentials) — same as `seed.php`.

## 1. Start the two dev processes

```bash
# Terminal 1 — PHP API (Laragon PHP is at C:\laragon\bin\php\...)
php -S 127.0.0.1:8000 -t public

# Terminal 2 — React dev server (proxies /api to :8000)
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## 2. Log in

Use **`e.ramos` / `Passw0rd!23`** — the sample report is owned by this
account, so you can edit it and generate for it.

## 3. Open the sample report

In **Reports**, open the newest entry: **Theft, 2026-09-12 10:30, Public
market, Purok 3…**. It arrives pre-filled:

- **Parties:** 2 victims (Ana Lopez, Marco Lopez), 1 unidentified suspect,
  1 witness (Lita Cruz, with a statement summary)
- **Stolen item:** black smartphone, ₱8,500 estimated value, taken from a
  shoulder bag at the market
- **CCTV:** available, footage preserved

Every field is editable — add, change, or delete anything and save.

## 4. Generate the AI narrative

Scroll to the **narrative** section (side-by-side AI panel):

1. Optionally type rough notes in the AI panel's notes box, e.g.
   *"bag snatched sa market around 10:30am, victim shouted, suspect ran toward highway"*
2. Click **Generate AI draft**
3. The AI returns a formal draft in the PNP house style plus up to 5
   suggestions (grammar/terminology for your notes), up to 5
   `possibleGaps` (missing info the narrative could not establish), up to 5
   **notable findings** — your step-3 Notable Findings text formalised into
   one-line findings for the sheet — and, under **"Not added — no source in
   your record"**, the details it was tempted to add but withheld for lack of
   source. That last list is advisory only: nothing in it is ever written
   into the report, and an empty list is normal
4. **Accept** copies the draft into your editable narrative field (it is
   never saved automatically); **Regenerate** re-runs with a feedback note
5. The formalised wording needs no separate action: generating **replaces
   two of your own fields** — Notable Findings (one printed line per
   finding, printed in the NOTABLE FINDINGS block) and Action Taken / Status
   (one restated line, printed in the ACTION TAKEN / STATUS block) — because
   those fields are what save, snapshot and print. A generation that finds
   nothing notable, or a report with no recorded disposition, leaves that
   field untouched; check both fields after generating if you had written
   something different, and edit them freely
6. Prefer your own shorthand after all? Each replaced field shows
   **"Formalised by the AI — Undo"** under it until you touch it: one click
   puts your previous wording (or the blank you had) back. The offer
   disappears as soon as you edit that field, and each field reverts
   independently
7. The printed **ACTION TAKEN / STATUS** block states your recorded
   disposition once: your own lines first, then the recorded states
   (suspect/recovery status, protection order, search actions, fire response,
   medico-legal examination — the last only when the sheet's per-type facts do
   not already print it), then the station's on-file or finalization note.
   The station's routing line prints **only** when your disposition does not
   already state an onward action, so the sheet never records two dispositions

> Generating sends the text **currently in** both fields, not the last
> autosaved version, so a note typed seconds before clicking Generate is the
> text the AI formalises.

> **The AI may only re-word — never add.** Its instruction forbids every fact
> your report does not contain (no unstated times, places, persons, injuries,
> weapons, outcomes, motives or scene conditions), permits only wording,
> grammar, tense and sentence-structure changes, and requires a per-sentence
> self-check before answering. It also may not STRENGTHEN an inference you did
> state: "maybe an insider" comes back as "possible insider involvement",
> never as "strongly implies an insider". A section you left blank is reported
> as missing (a blank Action Taken / Status is flagged as a warning, since the
> report cannot be closed without a disposition) rather than filled with
> placeholder text. Casual phrasing is upgraded to formal police
> wording ("gave warning" → "issued a verbal warning") without widening what
> you said, and a thin record correctly yields a short draft rather than a
> padded one. The disposition line is held to this rule most strictly of all.

> The AI never writes the report directly — accepting is always your action
> (one click per Generate: the panel does not retry a request that already
> succeeded).

## 5. If you have no Gemini API key

The AI panel detects this via `/ai/health` and shows the **manual-mode
banner** instead of the Generate button — the rest of the flow (filling
fields, editing the narrative manually) works identically.

To actually exercise generation you need a key:

```bash
# app/config/ai.php (copy from ai.sample.php) or:
export GEMINI_API_KEY="your-key"
```

## What the backend does with the sample's fields

- Names, addresses, and exact ages **never leave the server** — the masking
  gateway swaps them for `[VICTIM_1]`, `[RESPONDENT_1]`, `[WITNESS_1]`
  placeholders, with ages banded ("30s") and plates/driver names placeholdered
- The masked payload + your rough notes go to Gemini with the cached
  instruction block (glossary style rules); the draft comes back with
  placeholders and is unmasked against the server-side map before you see it
- Empty/blank fields are omitted from the payload entirely
