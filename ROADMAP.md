# 🚔 BlueWrite — Project Roadmap
**An AI-Assisted Real-Time Police Incident Report Generation System**
*Police of City of Naga, Cebu | Timeline: Feb 2026 – Dec 2026 | Methodology: Extreme Programming (XP)*

---

## 🌐 Deployment Model — Local Web (LAN) + Cloud AI API
The system is a **web application hosted inside the police station's network** — accessible from station computers via browser, but **not exposed to the internet**. The **server only** uses an internet connection to call a **cloud AI API** for narrative generation (using an API key). Station PCs never touch the internet.

```
┌────────────────────── Police Station LAN ──────────────────────┐
│                                                                │
│   Local Server (Intel i5, Windows 11)                          │
│   ├─ XAMPP: Apache (PHP web app)  ──►  http://192.168.x.x      │
│   ├─ MySQL (centralized incident DB)                           │
│   └─ PHP cURL ──► Cloud AI API (LLM) with API key              │
│                        │                                       │
└────────────────────────┼───────────────────────────────────────┘
                         ▼ (server's internet connection only)
              ☁️ Online AI provider (API endpoint)
```

**Why this works for BlueWrite:**
- ✅ Station PCs stay LAN-only — they just open a browser; no internet needed on client machines
- ✅ Stronger AI quality — cloud LLMs outperform what modest local hardware can run
- ✅ No GPU/heavy hardware needed — AI runs in the cloud, server stays light
- ⚠️ **Trade-off to document:** incident details are sent to an external AI provider during narrative generation. The blueprint's Security RRL emphasizes protecting sensitive police data — address this in Chapter 4 (data minimization, masking names, provider ToS, and human-in-the-loop review)
- ⚠️ Server needs a **stable internet connection**; build a graceful fallback (queue/retry, or manual narrative mode when offline) — matches your Scope limitation "network interruptions are beyond the system's control"

**LAN + API setup checklist (Phase 4 deployment):**
- [ ] Static local IP for the server (e.g., `192.168.1.10`) so `http://192.168.1.10/bluewrite` never changes
- [ ] Apache + MySQL configured as **Windows services** (auto-start on boot)
- [ ] Server has internet access (wired preferred); station PCs remain LAN-only
- [ ] **API key stored server-side only** (PHP config/env file, never in browser JS or client-visible code)
- [ ] Windows Firewall allows port `80` (Apache) **from LAN only**; no inbound exposure of anything else
- [ ] Network-shared printer or direct USB on server
- [ ] MySQL daily backup to a second drive / external disk
- [ ] Server machine: auto-login disabled, disk encryption optional, UPS recommended

---

## 📍 Phase 0 — Preparation & Planning (Feb 2026)
> XP practice: Planning Game

- [ ] Finalize requirements from blueprint (22 use cases, Tables 1–6)
- [ ] Conduct preliminary survey / interviews at Naga City Police Station (Objective #1)
- [ ] Analyze gathered data → finalize functional & non-functional requirements (Objective #2)
- [ ] Set up dev environment: XAMPP (Apache, MySQL, PHP), VS Code, Git repo
- [ ] **Select cloud AI provider, create account, and secure API key** (see Phase 3 for selection criteria)
- [ ] Design database schema from ERD (users, reports, report_history, audit_logs, roles)
- [ ] Define XP iteration plan (1–2 week iterations)

**Deliverables:** Requirements doc, DB schema, environment ready, API key secured, iteration plan

---

## 📍 Phase 1 — Core System Foundation (Mar – Apr 2026) · Iterations 1–3
> Small releases — build the skeleton first, AI comes later

> **✅ COMPLETE (Sep 2026):** all code deliverables done & verified (24+ test
> PHPUnit suite, security notes in `SECURITY_NOTES.md`, readiness audit in
> `docs/PHASE2_READINESS.md`). The LAN deployment config item remains open —
> it is tracked with the Phase 4 deployment work (needs station-server access).

- [x] Project scaffolding (folder structure: `/public`, `/app`, `/config`, `/api`)
- [ ] Configure app to be accessed via LAN: Apache vhost, bind to `0.0.0.0`, use server's static IP in all links (no `localhost` hardcoding) *(deployment config — deferred to station-server setup, Phase 4)*
- [x] **Authentication module** — secure login/logout (UC-001, UC-003, UC-022)
  - Password hashing, session management (Alshamrani & Myneni, 2020)
  - bcrypt hashing, lockout after 5 fails/15 min, anti-enumeration errors, CSRF tokens
- [x] **User management** — create/update/deactivate accounts (UC-002) — soft deletes only, last-admin guard, uniqueness checks on partial updates
- [x] **Role-based access control** — Admin / Officer / Staff (UC-020, UC-021) — server-side on every endpoint
- [x] **Incident report CRUD** — create, encode details, edit, save as draft (UC-004, 005, 009, 010) — incl. 30s autosave
- [x] **MySQL database** implementation — schema + indexes in `migrations/001_schema.sql`; *(backups = station-server task, Phase 4)*
- [x] Audit trail logging foundation (UC-019) — append-only `audit_logs` + full `report_history` snapshots on every change

**Deliverables:** Working login + RBAC + report encoding (no AI yet) — testable with real users

---

## 📍 Phase 2 — Records Management (May – Jun 2026) · Iterations 4–5
> XP practice: Continuous testing, customer feedback each iteration

> **✅ PROGRESS (Sep 2026):** items 1–6 implemented & verified (31-test PHPUnit
> suite passing, API verified live via HTTP, frontend builds green). Only the
> client demo remains.

- [x] **View reports** list with pagination (UC-012) — server-side pagination
      (`page`/`per_page`, clamped 5–100) + pagination metadata in the API;
      Prev/Next pager in the UI
- [x] **Search & filter** — keyword, date range, report type (UC-013) —
      server-side keyword search (type, location, parties, narrative, officer),
      incident-type + status filters, inclusive date range; all as prepared-statement
      query params with allowlist validation
- [x] **Sort reports** — date, category, status (UC-014) — hardcoded column
      allowlist (incident_datetime, type, status, officer) + ASC/DESC; SQL
      injection-safe (unknown fields rejected 422, covered by tests)
- [x] **Report history tracking** — edit log per report (UC-018) — history
      viewer modal with change timeline + collapsible full snapshots
      (delivered during Phase 1 wrap-up, Item 1)
- [x] **Finalize workflow** — Draft → Final (UC-011), edit restrictions after
      finalization — delivered in Phase 1 (locked for non-admins, Admin
      override, Staff cannot finalize; covered by RBAC tests)
- [x] **Print-ready report generation** (UC-015, UC-016) — formatted HTML→print
      template — formal PNR-style sheet (header, details table, narrative,
      signature lines, footer) with `@media print` isolation, auto print
      dialog, DRAFT/FINAL watermark, print events audit-logged
      (`GET /reports/:id/print`)
- [ ] First client demo at police station → gather feedback *(blocked on
      station-server access — same operational checklist as Phase 1 close-out)*

**Deliverables:** Complete records management without AI; feedback incorporated

---

## 📍 Phase 3 — AI-Assisted Narrative Builder ⭐ (Jul – Aug 2026) · Iterations 6–8
> The core innovation of the capstone — powered by a **cloud AI API**

> **✅ COMPLETE (Sep 2026):** all 8 items implemented & verified (41-test
> PHPUnit suite passing incl. masking/safety regression tests, frontend build
> green, Gemini key configured server-side). Full evidence and the remaining
> close-out items in `bluewrite/docs/PHASE3_STATUS.md` — only a live
> end-to-end generation + client demo remain (blocked on station access).

**Provider selection criteria (decide in Phase 0):**
- Free tier / student budget — enough monthly requests for dev + pilot testing
- Simple REST API callable from PHP (cURL)
- Data handling policy — prefer providers that **don't train on API data** and support zero-retention options
- Low latency + reliable uptime
- Context window large enough for full reports

- [x] **API integration** — PHP cURL client calling the cloud AI endpoint; **API key stored server-side only** (env/config, never in frontend JS)
- [x] **AI narrative generation** — notes/bullets → formal police narrative (UC-006)
  - Prompt engineering with police report format & Philippine police terminology (system prompt + 14-type vocabulary + few-shots)
  - Guardrails: AI output marked as DRAFT, never auto-saves as final (service never writes the report row)
- [x] **Grammar & terminology suggestions** (UC-007) — AI-returned suggestions rendered in the AI panel
- [x] **Missing information detection** (UC-008) — AI gaps merged with deterministic field warnings
- [x] Human-in-the-loop UI — side-by-side draft rail with accept/reject/regenerate-with-feedback; narrative source (`ai-assisted`/`manual`) recorded in history
- [x] **Offline fallback** — queued-retry model (`ai_requests`, 503 + `retry_in`, client auto-retry) + manual narrative mode
- [x] **Data privacy for AI calls** — `MaskingGateway` (placeholders, age bands, no names/addresses/plates to the provider), leaked-token safety gate, hash-only queue records, documented data flow
- [x] Performance tuning — timeouts, Gemini explicit context caching, TTL response cache, output ceiling, payload trimming (live latency numbers pending the station demo)

**Deliverables:** Working AI narrative builder with human-in-the-loop controls — **delivered**; live latency capture + client demo pending

---

## 📍 Phase 4 — Dashboard & Security Hardening (Sep 2026) · Iteration 9–10

> **✅ PROGRESS (Sep 2026):** dashboard (UC-017) implemented & verified
> (9-test DashboardTest suite, 50-test suite green, live browser check as
> Admin; **Admin-only** per team decision Sep 2026 — Officer/Staff get 403). Hardening pass done: headers, per-user rate limit,
> injection/type-filter tests, backup script. Details in
> `bluewrite/docs/PHASE4_DASHBOARD.md`. Station-server items remain
> (vhost CSP, Task Scheduler backup, LAN smoke tests, demo).

- [x] **Dashboard monitoring** — total reports, incident categories, pending vs. finalized, charts (UC-017) — SPA view (`Dashboard.jsx`) + `GET /api/v1/dashboard/stats`; hand-drawn SVG/DOM charts, zero chart dependencies (LAN-only clients); **Admin-only** (sidebar hidden + server-side 403 for Officer/Staff)
- [x] Statistics per date range / per incident type — 7/30/90-day presets + custom range + type filter, KPI trend delta vs. previous period, zero-filled daily series, recent-activity feed from `audit_logs`
- [x] Security hardening pass:
  - SQL injection prevention (prepared statements) — dashboard verified by tests incl. an injection-string attempt; Phases 1–3 already used prepared statements throughout
  - XSS protection, CSRF tokens — React escaping; CSRF enforced on all write endpoints (`Auth::requireCsrf`); dashboard is read-only
  - Audit logs for all critical actions — in place since Phase 1, feeds the dashboard activity feed
  - Database backup routine — `scripts/backup_db.bat` (mysqldump + 7-day rotation) — **Task Scheduler registration is a station-server step**
  - Password policies, account lockout — in place since Phase 1 (bcrypt, 5/15-min lock), documented in `SECURITY_NOTES.md`
  - Phase 4 additions: API security headers, per-user rate limit on the stats endpoint, 366-day query-range cap
- [ ] LAN deployment setup on local server (Intel i5, XAMPP as service) — blocked on station-server access
- [ ] User acceptance testing prep

**Deliverables:** Full-featured system deployed on police station LAN — dashboard & hardening **code-complete**; deployment pending station access

---

## 📍 Phase 5 — Testing & Evaluation (Oct 2026)
> Per Objective #4

- [ ] **Functional testing** — all 22 use cases test scripts
- [ ] **ISO/IEC 25010 evaluation** — functional suitability, performance, compatibility, usability, accessibility, reliability, security, maintainability, portability
- [ ] **UTAUT survey** — administer to police personnel for acceptability
- [ ] Fix bugs from testing → regression test (XP: continuous testing)
- [ ] Pilot run with actual incident data (test/simulated data)

**Deliverables:** Test results, ISO 25010 scores, UTAUT analysis, evaluation chapter data

---

## 📍 Phase 6 — Deployment & Documentation (Nov – Dec 2026)
> Per Objective #5

- [ ] Final deployment at Police Station of City of Naga, Cebu
- [ ] **User training** — officers, desk personnel, records staff, admin
- [ ] User manual + system documentation
- [ ] Finalize capstone paper (Chapters 4–5, results & discussion)
- [ ] Prepare oral defense presentation & demo
- [ ] Turnover: source code, credentials, backup procedures, maintenance guide

**Deliverables:** Deployed system, trained users, complete manuscript, defense-ready

---

## ⚠️ Risk Watchlist (from Cause & Effect Analysis — Table 6)
| Risk | Mitigation |
|---|---|
| AI output inaccurate/unsupported | Human-in-the-loop, draft-only AI, review before finalize |
| Sensitive data sent to cloud AI provider | Data minimization, mask names, provider with no-training/zero-retention policy, document data flow |
| Internet outage stops AI features | Offline fallback: request queue/retry + manual narrative mode |
| API key leaked | Server-side only storage, never in JS/client code, key rotation |
| API quota/rate limits hit during pilot | Monitor usage, cache repeated suggestions, choose provider with adequate free tier |
| Users need training for AI features | Phase 6 training + simple UI + clear labels |
| Server/network/hardware dependency | LAN deployment on reliable server, backup routine |
| Performance with large DB | Indexing, pagination, query optimization |
| Unauthorized edits | RBAC + strict access control + audit trail |

## ✅ Standing XP Practices (all phases)
- Small releases, pair work within team, continuous testing
- Client (police station) demos every iteration
- Refactoring & coding standards (PSR-12 for PHP)
- Git: feature branches, commits per task

---

*Aligned with: BLUEPRINT (1).docx — Objectives, Scope & Limitations, Tables 1–6, ISO/IEC 25010, UTAUT*

> **📝 Note vs. blueprint:** The blueprint's Tables 2 & 4 list Ollama/LLaMA as the AI component, but the team has decided to use a **cloud AI provider via API key** instead. Remember to update Tables 2/4, the Software Specifications pricing, and the References section of the manuscript to reflect the chosen provider before submission.
