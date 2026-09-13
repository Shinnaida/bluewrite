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
   suggestions (grammar/terminology for your notes) and up to 5
   `possibleGaps` (missing info the narrative could not establish)
4. **Accept** copies the draft into your editable narrative field (it is
   never saved automatically); **Regenerate** re-runs with a feedback note

> The AI never writes the report directly — accepting is always your action.

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
