# Walkthrough — fill a sample report and generate an AI narrative

This walks you through trying BlueWrite's AI narrative generator on the
pre-filled sample reports, end to end.

## 0. One-time setup

```bash
cd bluewrite

# Database + tables + users
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS bluewrite CHARACTER SET utf8mb4"
mysql -u root -p bluewrite < migrations/001_schema.sql

# Sample users (all passwords: Passw0rd!23)
php database/seed.php

# The SAMPLE filled reports (a Theft and a Traffic Accident, owned by k.abalo)
# Change SAMPLE_OWNER_USERNAME in the script to file them under another account.
php database/sample_report.php

# …or just one of them, when you want another draft case to try:
php database/sample_report.php traffic
php database/sample_report.php theft
```

`sample_report.php` needs `config/config.php` (copy from
`config/config.sample.php` and set DB credentials) — same as `seed.php`.

## 1. Start the two dev processes

```bash
# Terminal 1 — PHP API (Laragon PHP is at C:\laragon\bin\php\...)
# router.php is required: the built-in server ignores .htaccess, so it is what
# routes /api/* to public/api.php.
php -S 127.0.0.1:8000 -t public router.php

# Terminal 2 — React dev server (proxies /api to :8000)
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## 2. Log in

Sign in as **`k.abalo`** (badge **123123**) with its own password. That account
was created in the app rather than by `seed.php`, so the demo password
`Passw0rd!23` does **not** apply to it — use whatever password you set on it.
It owns the sample reports, so it can edit them and generate for them; any
Admin (`m.santos`) can also edit them.

If you sign in as a different account the reports still open, but the AI
assistance card is not offered on a report you do not own — that is the
owner-only rule, not a fault.

## 3. Open a sample report

In **Reports**, open one of the two samples. Search **`market`** for the Theft
case or **`East Poblacion`** for the Traffic Accident one — the list is sorted
by incident date, so on a database with demo volume seeded they sit a page or
two in rather than at the very top. They are deliberately different shapes, so
the draft can be read against two different field sets:

**Theft, 2026-09-12 10:30, Public market, Purok 3…**

- **Parties:** 2 victims (Ana Lopez, Marco Lopez), 1 unidentified suspect
  (description only), 1 witness (Lita Cruz, with a statement summary)
- **Stolen item:** black smartphone, ₱8,500 estimated value, taken from a
  shoulder bag at the market
- **CCTV:** available, footage preserved

**Traffic Accident, 2026-09-19 17:40, National Highway, Brgy. East Poblacion…**

- **Parties:** 2 drivers (Ricardo Mendoza, Ramil Desierto)
- **Vehicles:** motorcycle KJ-48213 and light truck GAB-7715, each with its
  own damage described
- **Injured:** 1 backrider (Marites Mendoza, minor injury) — a nonzero injured
  list and zero fatalities on the sheet
- **Witness:** Lourdes Bacaltos, who saw the overtake
- **Cause / violation:** overtaking on a no-overtaking stretch; reckless
  driving

Both carry the **informal account** an officer would type before asking for a
draft — that IS the AI's source (see step 4). Every field is editable — add,
change, or delete anything and save.

## 4. Generate the AI narrative

Scroll to the **AI assistance** card at the foot of the report (under
Investigator-on-Case in the continuous document format; on the LAST step,
**Review**, in the stepped format — one place to generate from, where the
report reads back in one piece, and the stepper jumps straight there).

There is **no notes box**: the account is the report you just filled in, and
the narrative's own "Detailed Description of Events" is where it lives. The
samples already carry that rough account ("around 10:30am, public market.
Ana Lopez (34)…"), so there is nothing to paste in first. Write in whatever
shorthand you like — the AI's job is to turn it into the station's house
style.

1. Click **Generate AI draft**

   The draft comes back **inline in the card**, not in a side panel, and in the
   three labelled parts the printed sheet uses for the same three things:
   **Facts of the case** (the narrative), **Notable findings**, and **Action
   taken / status**.

   They arrive in that order as well: each of the three **types itself in**,
   one after the other — the facts, then the findings (only when the draft has
   any, otherwise the action taken follows straight on), then the action
   taken. As each one finishes it becomes an editable box, so you can start
   correcting the facts while the findings are still being written. Only a
   draft generated in front of you plays that sequence; one restored from the
   tab's own store is simply there.

   While the draft is still arriving, **nothing else on the panel is shown** —
   the writing suggestions, the possible gaps, the gloss, the warnings and the
   Accept button all wait for the text they describe. Two controls stay live
   throughout: the panel's **✕**, and **Skip typing** in whichever part is
   playing, which shows the whole rest of the draft at once.

   All three boxes are editable while you review — the model's wording and
   yours are one text, so a phrase you want changed is changed there, on the
   text you are about to accept. An edit in any of the three is **draft-local**:
   it reaches the report when you accept, not as you type.
2. The AI returns a formal draft in the PNP house style plus up to 5
   suggestions (grammar/terminology for your notes), up to 5
   `possibleGaps` (missing info the narrative could not establish), up to 5
   **notable findings** — the report's own Notable Findings text formalised
   into one-line findings for the sheet — and, under **"Not added — no source
   in your record"**, the details it was tempted to add but withheld for lack
   of source. That last list is advisory only: nothing in it is ever written
   into the report, and an empty list is normal
3. **Accept into report** copies the WHOLE draft — the facts, the notable
   findings and the action taken — into the report's own fields in one action.
   Nothing is written before you press it and nothing is saved automatically,
   so a draft you close without accepting leaves the report exactly as you
   wrote it; **Regenerate…** re-runs with a feedback note; **✕** (or Escape)
   hides the draft and keeps it — "A draft is ready" in the card is the way
   back in
4. Those two formalised blocks are what the Accept above writes into the
   report — there is no separate action for them. **Notable Findings** is
   replaced with one printed line per finding (printed in the NOTABLE FINDINGS
   block) and **Action Taken / Status** with one restated line (printed in the
   ACTION TAKEN / STATUS block), because those fields are what save, snapshot
   and print. A generation that finds nothing notable, or a report with no
   recorded disposition, leaves that field untouched
5. Prefer your own shorthand after all? Each field the Accept replaced shows
   **"Formalised by the AI — Undo"** under it until you touch it: one click
   puts your previous wording (or the blank you had) back. The offer
   disappears as soon as you edit that field, and each field reverts
   independently. It always restores the wording you had **before** the AI
   ran, even after you have edited the block in the card
6. The printed **ACTION TAKEN / STATUS** block states your recorded
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
- The masked payload + the account text go to Gemini with the cached
  instruction block (glossary style rules); the draft comes back with
  placeholders and is unmasked against the server-side map before you see it
- Empty/blank fields are omitted from the payload entirely
