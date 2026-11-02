# BlueWrite — System Flow and Tools

AI-assisted police incident report system for the **City of Naga Police Station, Cebu**.
Two clients share one backend: a **web app** (`bluewrite/`) and a **Flutter phone app** (`blotter-app/`).

## 1. Big picture

```
┌──────────────────┐        JSON API (/api/v1)        ┌─────────────────────┐
│  Web app (React) │ ◄──────────────────────────────► │  PHP backend + AI   │
│  bluewrite/src   │                                 │  bluewrite/api|app  │──► MySQL 8
└──────────────────┘                                 └─────────────────────┘
        ▲                                                        ▲
        │ prints / certifies                                    │ OCR, reports,
┌───────┴──────────┐        ┌────────────────────┐   captures, narrative
│  Bondpaper sheet │        │ Phone app (Flutter)│             │
│  (same component │        │ blotter-app/lib    │─────────────┘
│  on screen+print)│        │ camera → review →  │
└──────────────────┘        │ POST to portal     │
                            └────────────────────┘
```

- **One paper, two surfaces.** `src/components/reports/ReportSheetBody.jsx` renders the
  bondpaper everywhere: the on-screen reveal, the AI draft preview, and the printed
  page. Editing the letter writes through the form's own setters, so every keystroke
  is an ordinary draft edit (dirty flag, autosave, validation, history).
- **A blotter certification prints as itself.** When the narrative carries the closing
  issuance line (`This certification is issued upon the request of …`), the sheet uses
  the certification layout — the blotter's own title, place, labeled T/D time, V1/V2
  vehicle paragraphs, facts, REMARKS, recorded/prepared-by — instead of the
  predetermined per-type web layout. Helpers: `src/lib/blotterText.js`
  (`isBlotterCertification`, `splitBlotterSections`, `extractIncidentTitle`,
  `extractLabeledDatetime`, `extractRecordedBy`; formal Arrange casing via
  `src/lib/printCasing.js` (`toFormalCase`, `formalWordSet`) — sentence case
  with title-cased recorded names/places, codes and plates kept whole.

## 2. End-to-end flows

### Flow A — Capture the written blotter (web or phone)

1. Officer photographs the blotter page (web: `src/components/reports/BlotterCapture.jsx`;
   phone: `blotter-app/lib/screens/capture_screen.dart` → `review_screen.dart`).
2. Text is read **on the device** — vendored Tesseract (`tesseract.js`, `eng.traineddata`)
   and the handwriting model under `bluewrite/public-assets/handwriting/`
   (`src/lib/ocrBlotter.js`, `ocrHandwriting.js`, `ocrOnline.js`) — or via the portal
   `POST /ocr/read` (`app/controllers/OcrController.php`).
3. The officer reviews and corrects the text; **Insert** appends it to the narrative.
   A read is a proposal, never a write (`mergeBlotterText`, `formatBlotterCertification`).
4. Captures are kept as evidence of what the page showed (`app/core/ReportCaptures.php`,
   `POST /reports/:id/captures`, `CapturesController.php`).

### Flow B — Write the report with AI assistance (sheet format)

1. Officer types the whole account on the sheet; structured fields start empty.
2. **Generate Report → account read.** `POST /ai/classify` names the incident type,
   date/time, place, people and disposition from the officer's own words
   (`resources/ai/classification_prompt.txt`, `GeminiNarrativeProvider.php`).
   `POST /ai/classify/details` then reads the type's own fields (vehicles/plates,
   items, injuries — `classification_details_prompt.txt`).
3. **Fill blanks only** (`src/lib/classifyFill.js` — `buildClassifyFill`,
   `src/lib/nagaPlaces.js` gazetteer: near-miss barangay spellings map to the
   closest of the station's 28 barangays, scope City of Naga, Cebu — the same
   names Google Maps carries; exact variants, puroks and unknowns are kept,)
   `buildTypeDetailsFill`): a field the officer already filled is never touched; the
   read's legal wording is folded to the form's type list and kept verbatim as the
   Category; exact-words guards keep the blotter title, strip invented severity/
   fatality codes, and print the labeled T/D time verbatim (`src/pages/Reports.jsx` →
   `readAccountForForm`).
4. The draft saves if it can (`ensureReportId`); a refused save never blocks Arrange.
5. **Two generation modes** (`src/components/ai/AiNarrativePanel.jsx`):
   - *Arrange only — keep my wording*: whitespace-normalized account as the draft
     (`src/lib/arrangeDraft.js`). No LLM call, no rewording.
   - *Enhance wording*: Gemini drafts the narrative plus formalised NOTABLE FINDINGS /
     ACTION TAKEN lines (`NarrativeService.php`, `narrative_system_prompt.txt`,
     `narrative_few_shots.txt`), screened by the safety gate and economy rules
     (`NarrativeEconomy.php`) with PII masked in transit (`MaskingGateway.php`).
6. **Provisional arrival**: a plain result is written onto the paper on landing
   (Keep confirms, Discard restores the snapshot); the paper auto-switches to Edit so
   corrections start on the letter at once. Guided/translation results stay proposals.
7. **Tighten my draft** reworks prose economy without touching the record's facts.

### Flow C — Review, finalize, print

1. Rule engine validates on save vs. finalize (`app/rules/report_rules.php` mirrored by
   `src/lib/reportRules.js`; per-type fields in `app/core/IncidentTypes.php` /
   `src/lib/incidentTypes.js`; derived/mirrored values via `syncMirrors`).
2. Multilingual path keeps the officer's source text verbatim beside the English draft
   (`app/core/ReportVerification.php`, `app/core/LanguageRegistry.php`).
3. Sheet facts compose from recorded data only (`src/lib/sheetFacts.js`,
   `src/lib/printActions.js`, casing in `src/lib/printCasing.js`).
4. Finalize + print (`ReportPrint.jsx`, signature block: recorded-by/creator, IOC,
   noted-by). Everything audited (`app/core/Audit.php`, `AuditsController.php`).

### Flow D — Supporting surfaces

Auth & accounts (session + CSRF, email-OTP second factor, MFA/recovery codes —
`AuthController`, `app/core/EmailOtp.php`, `RecoveryCodes.php`, `AccountRequests.php`);
presence heartbeat + avatars; officer-to-officer messages with typing latch;
notifications bell; dashboard charts; admin/users; station settings (letterhead
document + style, seals, contact, sign-off — `StationController.php`,
`app/core/Station.php`, `StationSeal.php`).

## 3. Tools used

| Layer | Tools |
|---|---|
| Languages / runtimes | PHP 8.2+ (plain PHP, PSR-12, no framework), Node 20+, Dart (Flutter) |
| Web frontend | React 18, Vite 5, GSAP, Three.js, OGL, Tesseract.js (`bluewrite/package.json`) |
| Backend | Plain-PHP JSON API (`bluewrite/api/index.php` → `/api/v1`), MySQL 8, numbered SQL migrations (`bluewrite/migrations/`), seed (`bluewrite/database/seed.php`) |
| Phone app | Flutter + `camera`, `http`, `crypto`, `flutter_secure_storage`, `image`, `path_provider` (`blotter-app/pubspec.yaml`) |
| AI | Google Gemini behind `app/ai/` providers; versioned prompt/wording files in `bluewrite/resources/ai/` (classification ×2, narrative system + few-shots, terminology, type vocabulary) |
| OCR | On-device Tesseract (`eng.traineddata`, TroCR handwriting model in `public-assets/`); server `OcrController` |
| Tests | `node --test tests/rules/*.test.mjs` (run via `npm test` — ~80 rule suites pinning pure helpers + source shape); PHPUnit (`bluewrite/phpunit.phar`, `bluewrite/tests/*.php`) |
| Local run | Windows + Laragon (PHP/MySQL/Apache), `Start BlueWrite.bat`, `BlueWrite.exe`; PHP dev router `bluewrite/router.php` |

## 4. Where to look (by task)

| Task | Start here |
|---|---|
| Sheet look / wording | `src/components/reports/ReportSheetBody.jsx`, `src/lib/sheetFacts.js`, `src/lib/blotterText.js`, `src/styles.css`, `src/incident-report.css` |
| AI draft behavior | `src/components/ai/AiNarrativePanel.jsx`, `src/pages/Reports.jsx` (`readAccountForForm`, provisional apply/keep/restore), `src/lib/arrangeDraft.js`, `src/lib/classifyFill.js` |
| AI backend / prompts | `bluewrite/app/ai/`, `bluewrite/app/controllers/NarrativeController.php`, `bluewrite/resources/ai/` |
| Validation / types | `bluewrite/app/rules/report_rules.php`, `src/lib/reportRules.js`, `app/core/IncidentTypes.php`, `src/lib/incidentTypes.js` |
| Capture / OCR | `src/components/reports/BlotterCapture.jsx`, `src/lib/ocr*.js`, `app/controllers/OcrController.php`, `blotter-app/lib/` |
| Ops docs | `bluewrite/docs/` (`DEVELOPMENT_STARTUP.md`, `LAN_SETUP.md`, phase notes, `architecture/`) |
