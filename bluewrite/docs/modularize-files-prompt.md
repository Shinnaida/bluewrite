# BlueWrite — "Split my files into modules" prompt

A ready-to-paste prompt for **ChatGPT** or **Claude**. Everything under the line is the
prompt; the notes above it are for you.

## How to use it (for you, not the model)

1. Open a **new chat**. Paste the whole prompt block below.
2. **Attach the file(s) for one step only** — the prompt already asks for one file per turn.
   The model cannot see your repo, so a step without its files attached will just stall.
3. Do the steps in the order in §5. `src/lib/*.js` first, `Reports.jsx` almost last.
4. After each step the model gives you new files + the exact edits to importers. Apply
   them, then run the commands in §7 before continuing. **Do not batch steps.**
5. Files in the repo's `.tmp-*` folders (`bluewrite/.tmp-cascade.mjs`,
   `.tmp-ai-draft-inline-backup/`, …) are scratch backups — never touch them, never split
   them, never count them.

**ChatGPT:** paste the prompt, then attach files one step at a time; it forgets long
context, so re-paste §2 (the hard rules) whenever a step lands.

**Claude:** paste the prompt and attach `src/pages/Reports.jsx` + the tests that read it
together for the big step; Claude handles the large-file window better.

---

## THE PROMPT (copy everything below this line)

You are a senior refactoring engineer. I will give you one source file at a time from a
real, working application, and you will split it into modules. You must preserve behavior
exactly. Read this whole brief before you answer anything.

### 1. What the project is

**BlueWrite** — an incident-reporting system for a Philippine police station.

- **Frontend:** React 18 + Vite 5, plain JSX (no TypeScript), plain CSS files (no Tailwind,
  no CSS modules). Source in `src/`. Entry `src/main.jsx` → `src/App.jsx`.
- **Backend:** PHP 8, hand-rolled MVC. `api/index.php` is the front controller,
  `app/controllers/*`, `app/core/*`, `app/ai/*`, `app/rules/report_rules.php`.
- **Build/serve:** `npm run build` → `public/` (Vite `outDir`, `emptyOutDir: false`, with a
  custom plugin that deliberately keeps the document root whole). Dev server is pinned to
  **port 5180** and proxies `/api` → `http://localhost:8099`. `router.php` serves `public/`.
- **Tests:** Node's built-in runner for JS (`tests/rules/*.test.mjs`, 87 files, run by
  `npm test`) and PHPUnit-style PHP tests (`tests/*.php`, run by `tests/run-tests.php`).
- **Style note that matters:** this codebase carries long, deliberate explanatory comments
  that record *why* a decision was made (not what the line does). They are documentation,
  not noise.

### 2. THE HARD RULES — a refactor is behavior-preserving or it is a failure

1. **Zero behavior change.** No logic edits, no bug fixes, no "while I'm here" improvements,
   no renamed variables/functions/CSS classes, no changed JSX output, no changed render
   order, no changed string literals, no reordering of side effects.
2. **Do not change any public export's name or shape.** If a module exports
   `export function ReportTools(...)`, that name and signature must still be importable
   from the same specifier after your change. Use a barrel/re-export file to keep old
   import paths working when you move code behind them.
3. **Move all comments with the code they explain.** A comment that justifies a decision
   must travel with the decision. Never delete or summarize one. Never invent new
   rationale.
4. **No new dependencies. No build-config changes. No bundler plugins.** No TypeScript
   conversion, no CSS-in-JS, no state-management library, no file renames of anything
   inside `src/lib/` unless I explicitly ask for that file.
5. **Nothing imports the web.** No `fetch` at module top level, no side effects at import
   time that were not already there.
6. **Never touch** `node_modules/`, `public/` (build output), `offline-copy/`,
   `.tmp-*` folders, `.design-backup/`, `package-lock.json`, or `phpunit.phar`.
7. **If preserving behavior requires a choice, say so and pick the conservative option.**
   If two options are equally safe, pick the one that changes the fewest files.

### 3. CRITICAL: many tests read source files as *text* — you must check this FIRST

This repo's tests are not only unit tests. A large number of them `readFileSync` a source
file by path and assert on it with regular expressions (checking that a CSS rule exists, a
label string appears, a JSX element is present, two files agree). **Splitting any file that
a test reads by path will break that test unless you also update the test.**

Before you propose a single new file, do this and show me the result:

```bash
cd bluewrite
grep -rl "<relative/path/to/the/file/I/gave/you>" tests/rules
```

Then, for each test that matches, read it and report:
- which path it reads,
- which regexes/strings it asserts on,
- whether each assertion still holds if the code moves to a new file,
- and if not, the exact minimal edit to the test's path or pattern.

Counts measured in this repo today (treat as a warning, not gospel):

| Read as text by tests | Tests |
| --- | --- |
| `src/incident-report.css` | 18 |
| `src/styles.css` | 16 |
| `src/pages/Reports.jsx` | 15 |
| `src/components/Dashboard.jsx` | 8 |
| `src/components/Shell.jsx` | 6 |
| `src/components/ReportActions.jsx` | 3 |
| `app/controllers/ReportsController.php`, `app/rules/report_rules.php` | 1 each |

Also note: `tests/rules/reportRules.test.mjs` and friends **import** from
`src/lib/*.js` by exact path, and one test asserts that the JS schema and the PHP table in
`app/rules/report_rules.php` stay in lockstep. A module move there breaks an import; a
schema edit there breaks a cross-language assertion.

**Rule:** if a file is read by tests and cannot be split without a large test rewrite,
say so and propose the *safe* alternative — extract the parts nothing asserts on, leave a
thin file with the asserted-on code in place, and keep the asserted code byte-identical.

### 4. Target layout

Frontend (`src/`):

```
src/
  App.jsx  main.jsx
  components/<Feature>/        one component per file
  components/<Feature>/<Feature>.jsx   (the piece that was exported before)
  components/<Feature>/index.js        barrel: re-export the old public names
  lib/                                 pure, testable helpers (already modular)
  styles/ or per-feature .css          only if §3 clearance allows
```

Backend (`app/`): one class per file, existing folders (`controllers/`, `core/`, `ai/`,
`rules/`). Controllers stay thin; pull real units out into new classes/helpers rather than
splitting a class into two halves of itself.

Rules for the split itself:
- **One component per file.** A helper used only by one component goes in the same folder
  (`Feature/helpers.js`), not in `lib/`.
- Presentational subcomponents that are already top-level functions in the file become
  files in the same feature folder.
- Pure functions with no React dependency go to `lib/` **only if** no test asserts on their
  current location — otherwise keep them beside the component and re-export.
- Constants and lookup tables move with their consumers.
- No file over ~400 lines after the split unless it is a single unavoidable component.
- **Never create a barrel that re-exports everything** just to shorten a split — only
  re-export what was public before.

### 5. Work order (do the steps in this order, one per turn)

Sizes are current line counts, so you can sanity-check that we are talking about the file I
attached:

1. `src/lib/*.js` under ~400 lines — audit for duplication only. 40+ small modules already
   exist; the output here may be "nothing to split, here are 3 helpers that should move
   into it." Lowest risk, start here.
2. `src/components/` medium files: `MessagesPanel.jsx` (949), `Users.jsx` (1564),
   `Login.jsx` (1500), `ProfilePanel.jsx` (1050), `NotificationBell.jsx` (518),
   `Chatheads.jsx` (482), `Dropdown.jsx` (470).
3. `src/components/Dashboard.jsx` (2577, reads by 8 tests) — the charts
   (`StackedColumns`, `CategoryRank`, `StatusPie`, `HourChart`) and the cards
   (`KpiCard`, `Sparkline`, `DeltaLine`, `RecentActivity`) are already
   separately exported; they should become their own files behind a barrel.
4. `src/components/AiNarrativePanel.jsx` (2553) and `Shell.jsx` (725).
5. `src/pages/Reports.jsx` (**6956 lines, 96 functions, 6 exports** —
   `ReportWelcome`, `ReportEditor`, `ReportFiles`, `ReportTools`, `ReportShelf`,
   `ReportsTable`). `ReportEditor` alone is ~2900 lines. This is the big one and the
   riskiest because 15 tests read it as text. Split it in *sub-steps*, one
   exported symbol per turn, starting with `ReportTools`/`ReportShelf`/`ReportsTable`.
6. CSS: `src/incident-report.css` (8989), `src/styles.css` (8169),
   `src/login-theme.css` (1309), `src/dark-theme.css` (397). Cascade order and
   specificity are load-bearing — split by feature only if you can prove the
   concatenation order is unchanged, and update the 18 + 16 tests that read them.
7. PHP: `app/controllers/ReportsController.php` (1695),
   `app/ai/GeminiNarrativeProvider.php` (1582), `AuthController.php` (1254),
   `app/rules/report_rules.php` (1135), `UsersController.php` (1133),
   `app/ai/NarrativeService.php` (1119), `app/ai/MaskingGateway.php` (758).

Do **not** jump ahead. Do not start step 5 because it is the interesting one.

### 6. Output format — every single turn, no exceptions

````
## Step N — <file path> (<lines>) → <planned files>

### Test impact (from the grep in §3)
- tests/rules/x.test.mjs reads this file; asserts on: <list>; still holds: yes/no
- <required minimal test edit, if any>

### New / changed files
1. <full/relative/path>  — NEW | EDITED | MOVED
   ```jsx
   <complete file contents, no elisions, no "…rest unchanged">
   ```

### Edits to importers
- <path>: import X from '<old>' → '<new>'   (exact line, before → after)

### Verification
- npm test
- npm run build
- (php -l <file> / php tests/run-tests.php for backend steps)

### Checklist
- [ ] no logic changed
- [ ] all comments carried over verbatim
- [ ] every previous export still importable from its old path
- [ ] no file > ~400 lines (or: single unavoidable component)
- [ ] no new dependencies
````

Never say "and so on", never write `// ... existing code ...`, never summarize what you
skipped. If a file is too long to print in one message, **stop and say so** — tell me the
next slice to ask for — rather than eliding.

### 7. Verification I will run (design your change to pass these)

```bash
cd bluewrite
npm test                 # 87 Node rule/layout/source-text tests
npm run build            # Vite build into public/
npm run dev              # then open http://localhost:5180 and click through
php tests/run-tests.php  # backend, after any app/ change
php -l <changed-file>    # for each changed PHP file
```

`npm test` passing is **not** proof the app still works — several tests assert on source
text and would pass or fail for reasons unrelated to behavior. For each step, tell me
exactly what to click and compare (e.g. "open Reports → Tools, confirm the three tabs
render and search still filters").

### 8. Ask me, don't guess

Stop and ask, in one short message, when:
- the file I attached is not the one you expected (check the line count in §5),
- the file reads another module you cannot see,
- a split would require changing a file the tests read,
- you would have to choose between two ways to divide a thing,
- the split is not actually worth doing — **it is a valid answer to say "leave this one;
  here is why."**

### 9. Definition of done, per step

Behavior identical, all comments intact, old import paths still work, `npm test` green for
the tests that touch this area, `npm run build` green, no new dependency, and a message
from you listing every file created and every file whose imports changed.
