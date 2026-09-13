<p align="center">
  <a href="https://github.com/Shinnaida/bluewrite/actions/workflows/ci.yml">
    <img src="https://github.com/Shinnaida/bluewrite/actions/workflows/ci.yml/badge.svg" alt="CI status" />
  </a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-lockup.svg" />
    <img src="docs/logo-lockup-light.svg" alt="BlueWrite — Police Incident Reporting" width="420" />
  </picture>
</p>

<h3 align="center">AI-assisted police incident reporting for the Naga City Police Station</h3>

<p align="center">
  <strong>Professional. Secure. Responsible.</strong><br/>
  A LAN-only report management system that helps officers document incidents
  accurately — with AI narrative assistance that never replaces officer judgment.
</p>

---

## What is BlueWrite?

BlueWrite digitizes the station's incident-reporting workflow end to end:
officers draft reports in a guided editor, submit them for review, and
finalized reports lock for integrity and print on the station's official
PNP certification-letter format. Every login, edit, finalize, and archive is
written to an audit log — nothing is silently deleted.

The AI assist drafts a narrative from the facts the officer entered
(incident type, time, location, involved parties) so the officer edits
instead of staring at a blank page. Sensitive details are masked before any
AI call, and every suggestion carries the system's standing advisory:
**the reporting officer remains responsible for the content.**

## Features

- **Role-based workflow** — Admin, Officer, and Staff with server-side
  permission checks on every endpoint
- **Report lifecycle** — draft → submitted → finalized; finalized reports
  lock (Admin can still reopen per audit-integrity rules) and archive
  instead of delete
- **AI narrative assistance** — Gemini-powered drafting with a PII-masking
  gateway and safety gates between officer data and the model
- **Print-ready output** — official PNP certification-letter format,
  US Letter
- **Admin monitoring dashboard** — interactive trend chart with hover
  tooltips, status breakdown, category deltas, hour-of-day histogram,
  officer workload, security-event flags
- **Audit logging** — sign-ins, lockouts, report changes, user admin —
  all queryable
- **Hardened auth** — session-based with CSRF protection, 30-minute idle
  timeout, 5-strike account lockout, and a logout confirmation for every
  role

## Stack

| Layer | Choice |
|---|---|
| Backend | PHP 8.2+, plain framework-free PHP (PSR-12 style) |
| Database | MySQL 8, numbered SQL migrations |
| Frontend | React 18 + Vite, plain CSS (no framework) |
| Auth | PHP sessions, CSRF tokens, bcrypt |
| AI | Google Gemini via a masking gateway (`app/ai/`) |
| Charts | Hand-drawn SVG, zero chart dependencies |

## Repository layout

```
bluewrite/               the application
  public/                web root: built React bundle + PHP front controller
  app/                   PHP logic: core, controllers, ai, rules
  api/                   /api/v1 router
  config/                config.sample.php → copy to config.php (git-ignored)
  migrations/            numbered .sql schema files
  database/              dev seeders (never run on production)
  src/                   React frontend
  tests/                 PHPUnit API tests + node rule tests
docs/                    architecture notes and brand assets
ROADMAP.md               phase plan and progress
```

## Quick start (from a fresh clone)

Prerequisites: **PHP 8.2+**, **MySQL 8**, **Node 20+**. Laragon on Windows
is the happy path (the app ships with Laragon-friendly defaults) but any
Apache + PHP + MySQL stack works.

```bash
# 1. Frontend dependencies
cd bluewrite
npm install

# 2. Configure — copy the sample and fill in your DB credentials
cp config/config.sample.php config/config.php

# 3. Database: create, migrate, seed (dev data only)
mysql -u root -p -e "CREATE DATABASE bluewrite CHARACTER SET utf8mb4"
mysql -u root -p bluewrite < migrations/001_schema.sql
mysql -u root -p bluewrite < migrations/002_type_specific_fields.sql
mysql -u root -p bluewrite < migrations/003_ai_assist.sql
php database/seed.php

# 4. Build the frontend (outputs into public/)
npm run build

# 5. Serve — point Apache's document root at bluewrite/public/,
#    or for a quick smoke test:
php -S 127.0.0.1:8099 -t public router.php
```

Then open `http://127.0.0.1:8099` (or your vhost) and sign in with a seeded
dev account:

| Username | Role | Password |
|---|---|---|
| `m.santos` | Admin | `Passw0rd!23` |
| `j.delacruz` | Officer | `Passw0rd!23` |
| `e.ramos` | Staff | `Passw0rd!23` |

> **Dev-only credentials.** Never run `database/seed.php` on a production
> station deployment — create real accounts through the admin UI.

For day-to-day frontend work, `npm run dev` starts Vite with an `/api`
proxy to the PHP server. Full station-deployment steps (static LAN IP,
Apache vhost, firewall, backups) live in
[`bluewrite/README.md`](bluewrite/README.md).

## Security posture

BlueWrite is built for a police station intranet and treats that trust
seriously: server-side RBAC on every endpoint, CSRF-protected JSON API,
prepared statements throughout, audit logging of every mutation, soft
deletes only (accounts deactivate, reports archive), PII masked before any
AI call, and a LAN-only deployment posture. Details in
[`bluewrite/SECURITY_NOTES.md`](bluewrite/SECURITY_NOTES.md).

## AI disclaimer

AI-generated narrative suggestions are **writing assistance only**. The
reporting officer reviews, verifies, and remains responsible for every
report content — enforced in the UI advisory and in the product's
audit-integrity rules.

---

<p align="center">
  <sub>Built for the Naga City Police Station · Cebu, Philippines</sub>
</p>
