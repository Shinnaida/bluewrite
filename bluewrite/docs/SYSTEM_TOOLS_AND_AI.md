# BlueWrite — Functions, Processes, Tools and AI

BlueWrite is a LAN-deployed incident-reporting system for police stations. It has a
React frontend and a PHP JSON API backed by a MySQL/MariaDB database, with an
optional AI drafting assistant (Google Gemini).

---

## 1. Main functions

| Area | What it does | Where (main files) |
|---|---|---|
| Sign-in | Login screen, email OTP, MFA, recovery codes, password policy, idle warning, session recovery | `src/components/Login.jsx`, `app/core/EmailOtp.php`, `app/controllers/AuthController.php`, `tests/RecoveryCodesTest.php`, `tests/PasswordPolicyTest.php` |
| Dashboard | Date range filters, incident-type filter, station/personal scope, charts (status pie, hour chart, category chart and rank), info cards | `src/components/Dashboard.jsx`, `app/controllers/DashboardController.php` |
| Incident reports | Create, edit, autosave, view, delete/restore, history snapshots, change notes | `src/components/Reports.jsx`, `app/controllers/ReportsController.php` |
| Report rules | Field validation, minimum lengths, casualty/narrative cross-checks, warnings before finalize | `src/lib/reportRules.js` |
| Printing | Printable incident sheet, action/status block, activity sheet, source-text appendix | `src/components/ReportPrint.jsx`, `src/lib/printActions.js` |
| Export | CSV export of reports | `app/controllers/ReportsController.php` |
| Verification | Second-officer review of translated reports (append-only, hash-bound) | `app/controllers/VerificationController.php` |
| Multilingual input | Declared/detected narrative language (English, Bisaya/Cebuano, Tagalog, mixed, other); bilingual terminology lookup | `src/lib/reportLanguages.js`, `src/lib/narrativeTerms.js`, `src/components/NarrativeTermsLookup.jsx` |
| Users & accounts | Profiles, avatars, account requests, roles (Admin, officer), user directory | `app/controllers/UsersController.php`, `src/components/ProfilePanel.jsx` |
| Messages & presence | Officer-to-officer messages, unread counts, online presence roster | `app/controllers/MessagesController.php`, `app/controllers/PresenceController.php` |
| Notifications | In-app notifications and seen-state | `app/controllers/NotificationsController.php` |
| Audit | Audit log of sensitive actions (e.g. AI generation) | `app/controllers/AuditsController.php` |
| Station settings | Station profile and incident types | `app/controllers/StationController.php`, `app/core/Station.php`, `app/core/IncidentTypes.php` |
| Connection handling | Offline cache, connection banners, watchdog, tab identity | `src/lib/` (offline and connection modules) |

---

## 2. Processes

### 2.1 Request flow
1. The React app (`src/`) calls the API through `src/lib/api.js`.
2. `api/index.php` is the single entry point and routes requests to controllers in `app/controllers/`.
3. Controllers use `App\Core\Database::pdo()` — one shared PDO connection with
   exceptions on error, real prepared statements, and no emulated prepares.
4. Sessions are handled by `app/core/Session.php`; the role and user come from the session, never from the request body.

### 2.2 AI narrative drafting (Phase 3)
1. The officer enters notes and presses **Generate** in `AiNarrativePanel.jsx`.
2. `NarrativeController` checks the server-side language guard (AI works on English reports only).
3. `MaskingGateway` replaces names, addresses, ages, plate numbers and contact numbers with placeholders (`[VICTIM_1]`) **before** anything leaves the server.
4. `NarrativeService` sends the masked payload to Gemini via `GeminiNarrativeProvider` (REST `generateContent`, timeout, rate-limit handling).
5. The reply is scanned for leaked or surviving placeholders (the safety gate). One retry, then manual mode.
6. Placeholders are restored locally; the draft is shown as DRAFT. The officer chooses to apply it. The AI never writes the report row.
7. Failures return 503 with a retry hint; the client retries up to three times. Responses are cached briefly (`ai_cache`) and requests are queued (`ai_requests`) with a payload hash only.

### 2.3 Translation (Phase 6)
- Source text is stored verbatim (`narrative_source_text`) and shown beside the English.
- Translation is optional and never blocks filing.
- A second officer can record a `verified` or `disputed` review, bound by SHA-256 to the exact texts reviewed.

### 2.4 Build and deployment
- `npm run build` runs Vite and copies the deploy files (`public-assets/`) back into `public/`.
  Running `vite build` alone deletes `public/api.php` and `public/.htaccess`.
- The app is deployed on the station LAN. Clients are LAN-only, so fonts and assets are bundled, not loaded from a CDN.
- Database changes are numbered SQL migrations in `migrations/` (e.g. `001_schema.sql`, `007_narrative_language.sql`), with `.down.sql` rollbacks where written.

### 2.5 Testing and CI
- **Frontend rule tests:** Node's built-in test runner (`node --test`) over `tests/rules/*.test.mjs`, listed in the `test` script in `package.json`. These are source-level checks on components, CSS and rules.
- **Backend tests:** PHPUnit 11 (`phpunit.phar`) over `tests/*Test.php`, run against a scratch database `bluewrite_test` on a local test server (`tests/run-tests.php`).
- **CI:** GitHub Actions (`.github/workflows/ci.yml` at the repo root) downloads PHPUnit and runs the suites.
- **Safety checks:** tests for masking, leak gate, prompt rules, and migration round-trips.

---

## 3. Tools and technologies

### Frontend
| Tool | Version / role |
|---|---|
| React | 18.3 — UI components |
| React DOM | 18.3 |
| Vite | 5.4 — build and dev server |
| @vitejs/plugin-react | 4.3 — React support for Vite |
| GSAP | 3.15 — text animation (`TextType.jsx`) |
| three | 0.186 — 3D backdrop (`AiOrbBackdrop.jsx`, `gradient-orb.tsx`) |
| ogl | 1.0 — WebGL effect (`SpecularButton.jsx`) |
| postprocessing | 6.39 — declared dependency for WebGL effects |
| face-api.js | 0.22 — declared dependency; no source import was found in `src/` during this review |
| CSS | Plain stylesheets (`incident-report.css`, `login-theme.css`, `styles.css`) |

### Backend
| Tool | Role |
|---|---|
| PHP | Server-side API (`strict_types=1`) |
| MySQL / MariaDB | Database, accessed through PDO with prepared statements |
| PHP autoloading | Manual `require` lists in `api/index.php`; no `composer.json` in the repo |
| PHPUnit 11 | Backend test runner |
| cURL | Outbound calls to the Gemini API |

### Development and operations
| Tool | Role |
|---|---|
| npm | Frontend package manager (`package-lock.json`) |
| Node.js `node --test` | Frontend rule tests |
| Git / GitHub | Source control and CI |
| Apache-style `.htaccess` | Routing for the LAN deployment |
| Bash / PowerShell | Local scripts and commands |

---

## 4. AI used in the system

### 4.1 Runtime AI (inside the product)
| Item | Detail |
|---|---|
| Provider | Google Gemini (REST `generateContent`) — the only shipped provider |
| Model | `gemini-3.6-flash` (set in `app/config/ai.php`; `gemini-2.0-flash` was retired in September 2026) |
| Used for | Formal narrative drafting, grammar and terminology suggestions, missing-information detection, Bisaya/Tagalog-to-English translation with an "understood as" gloss, and tightening |
| Privacy | Personal data is masked before sending. The API key stays on the server (`app/config/ai.php` is git-ignored, or `GEMINI_API_KEY` env var). Masking maps are not stored or logged |
| Cost controls | Explicit context caching of the instruction block (`CachedInstructionStore`, `cache_cli.php invalidate`), response cache (10 minutes), output-token ceiling 4,096, thinking level `low` |
| Prompts and data | `resources/ai/narrative_system_prompt.txt`, `type_vocabulary.json`, `narrative_few_shots.md`, `narrative_terms.json` |
| Human control | The AI only proposes. The officer applies, edits or discards the draft. Drafts are marked DRAFT |
| Switch-off | `enabled` in the AI config, and a per-incident-type translation kill switch |
| Fallback | Manual narrative mode works with the AI off or down |

### 4.2 AI used to build the system
The repository does not record which AI coding assistants were used during development. Add that here if you want it documented.

---

## 5. Known limitations (from the project docs)
- The masking layer does not yet handle native-language names in different word orders or spellings.
- Language detection is rule-based and misses Bisaya written mostly in words shared with English or Tagalog.
- Live Gemini latency and quota numbers still need to be captured for the performance section.
- The face-api.js dependency is declared but not used in `src/`; it can be removed if it is not needed.
