# Track D — the inputs only the station can supply

**Status: this file is a FILL-IN TEMPLATE. Nothing here is an example, and
nothing here is enabled.**

Stage 5 Track D (per-language few-shots) cannot start without two things the
software cannot supply. This file is the first one.

---

## What to hand over, and why

| # | Input | Who supplies it | Used for |
|---|---|---|---|
| 1 | **Real officer accounts, anonymized** (the form below) | you / a station officer | the evaluation fixtures, and the drafts of new few-shot examples |
| 2 | **A bilingual reviewer** (a person who reads Bisaya and/or Tagalog well) | you | judging the model's translation, using a review sheet I prepare |

Neither can be done by me: my own Bisaya is the *same* Bisaya the prompt already
teaches the model, so an evaluation written from my own sentences measures
nothing. And a machine cannot certify another machine's translation of a
language it does not speak.

---

## ⚠️ Read this before you paste anything in

1. **Everything you write here ends up in the model's instructions.** A few-shot
   example is part of the system prompt sent to the AI provider on every request.
   So an account that lands here must carry **no** real name, no exact address, no
   plate number, no badge number, no case number, no date of birth, and nothing
   that identifies a person. Use the placeholder tokens below.
2. **Replace, don't invent.** Where the officer wrote `Juan Dela Cruz`, write
   `[VICTIM_1]`. Do **not** substitute a made-up name — a fake name is a real-looking
   fact that can leak into a draft.
3. **Keep the officer's own words.** Do not translate, tidy, or fix grammar. The
   whole point is how a real officer writes when he is not confident in English.
   Spelling and word order as written.
4. **Do not write the English version.** I draft that, and the reviewer checks it.
   If you translate it yourself you have done the machine's job for it, and the
   evaluation becomes a test of your English rather than the model's Bisaya.

### The placeholder tokens the system knows

Wrapping real values in these is what makes the text safe and still readable to
the model:

| Token | For | Token | For |
|---|---|---|---|
| `[VICTIM_1]`, `[VICTIM_2]` | complainant / victim | `[LOCATION]` | place (barangay, street, establishment) |
| `[RESPONDENT_1]` | suspect / respondent | `[WHEN]` | date and time |
| `[WITNESS_1]` | witness | `[VEHICLE_1]` | a vehicle |
| `[INJURED_PERSON_1]` | injured person | `[ARRESTED_PERSON_1]` | arrested person |
| `[MISSING_PERSON_1]` | missing person | `[LAST_SEEN_WITH_1]` | last seen with |

Times and approximations stay as the officer wrote them — `around 2pm`,
`mga alas dos` — because "how the officer said it" is part of what is being
tested.

---

## The accounts

Copy the block below once per account. **6 accounts is a good target.** Aim for
this mix, because each one tests a different failure:

- **2 ordinary, complete** accounts (the normal case)
- **2 thin / sparse** accounts — the officer wrote two sentences and nothing else.
  These test the most important behaviour: *do not pad*. A model that invents a
  follow-up step here has invented a fact.
- **1 repetitive** account where the officer typed the same thing twice or added a
  non-event ("walay samad", "no weapons") — it must come out as ONE statement.
- **1 ambiguous** account where the officer himself was unsure of something — the
  draft must stay least-committal rather than pick a reading.

Languages: whatever your officers actually write. `Bisaya (Cebuano)` and
`Tagalog` are the two enabled ones; say `Mixed` if it is genuinely a mixture.

---

### ACCOUNT 1

**Incident type** (the CPS form's own type — e.g. `Theft`, `Robbery`,
`Traffic Accident`, `Physical Injury`):

```
```

**Language** (`Bisaya (Cebuano)` / `Tagalog` / `Mixed`):

```
```

**What the officer actually wrote** (his own words, placeholders applied):

```
```

**ACTION TAKEN / STATUS as recorded on the form** (this matters: the draft is
required to close on exactly this disposition, restated in formal prose):

```
```

**Notable observations the officer recorded** (one per line, or `none` — an empty
answer here is a valid and useful test):

```
```

**Parties on the form** (placeholder refs only, e.g. `victim: [VICTIM_1], female,
30s` — or `none`):

```
```

---

### ACCOUNT 2

**Incident type:**

```
```

**Language:**

```
```

**What the officer actually wrote:**

```
```

**ACTION TAKEN / STATUS:**

```
```

**Notable observations:**

```
```

**Parties:**

```
```

---

### ACCOUNT 3

**Incident type:**

```
```

**Language:**

```
```

**What the officer actually wrote:**

```
```

**ACTION TAKEN / STATUS:**

```
```

**Notable observations:**

```
```

**Parties:**

```
```

---

### ACCOUNT 4

**Incident type:**

```
```

**Language:**

```
```

**What the officer actually wrote:**

```
```

**ACTION TAKEN / STATUS:**

```
```

**Notable observations:**

```
```

**Parties:**

```
```

---

### ACCOUNT 5

**Incident type:**

```
```

**Language:**

```
```

**What the officer actually wrote:**

```
```

**ACTION TAKEN / STATUS:**

```
```

**Notable observations:**

```
```

**Parties:**

```
```

---

### ACCOUNT 6

**Incident type:**

```
```

**Language:**

```
```

**What the officer actually wrote:**

```
```

**ACTION TAKEN / STATUS:**

```
```

**Notable observations:**

```
```

**Parties:**

```
```

---

## Two categories NOT to include

1. **Domestic Violence and Rape / Sexual Assault.** The plan's D8 keeps these two
   types on a separate arrangement: no native example is written for them unless
   the owner approves the exact wording, and the reviewer — not the owner, not me
   — words it. The evaluation set already has one fixture for each; leave new ones
   out.
2. **Anything still under investigation or in court**, or naming a real officer,
   or a real complainant who has not consented.

---

## What happens after you fill this in

1. **I stop and show you the drafts** — the few-shot examples I would add, in the
   existing masked format, and the review sheet for the bilingual reviewer.
   **Nothing is enabled at this step.**
2. **The bilingual reviewer works the sheet** — for each translation: is the
   English faithful, is anything added, is anything escalated in legal weight.
   Their answers are recorded as theirs.
3. **You decide** — you enable an example, and you record the evidence in the
   registry. **No code path does either** (that is invariant 11, and it is
   enforced by a test).
4. **I run the before/after evaluation** on the same fixtures with the same
   repetition count, and report the hard-failure rates side by side. **If any rate
   gets worse, I stop and report it — I do not tune until the numbers look better.**
   This step spends live model calls: at the current set size, **45 calls per run,
   so 90 for a before/after pair**, and it needs your explicit go-ahead first.

## If you would rather not do this now

Track D is the only unbuilt part of Phase 6. Saying **"drop Track D"** is a
legitimate and complete answer: the plan document would record it as dropped
rather than held, Phase 6 closes, and nothing else is affected — the feature
shipped in Stages 1–5 does not depend on it in any way.
