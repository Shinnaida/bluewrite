# Changelog

All notable changes to BlueWrite are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [1.0.0] — 2026-09-13

First tagged release: the complete Phase 1–4 system as deployed for
station use, plus the new brand identity.

### Added — platform (initial commit `e9fc18c`)

- Full-stack incident reporting: framework-free PHP 8 JSON API under
  `/api/v1` with MySQL 8, and a React 18 + Vite frontend in the cyan HUD
  theme
- Role-based access control (Admin / Officer / Staff) enforced
  server-side on every endpoint, with session auth, CSRF protection,
  30-minute idle timeout, and 5-strike account lockout
- Report lifecycle: draft → submitted → finalized, with finalized-report
  locking, soft-delete archiving, and full audit logging
- AI narrative assistance (Gemini) behind a PII-masking gateway and
  safety gates
- Print-ready PNP certification-letter output (US Letter)
- Type-specific report fields per incident type (migrations 002/003)
- Admin monitoring dashboard: interactive trend chart with hover
  tooltip and crosshair, three-status donut, category deltas, median
  draft-to-final time, hour-of-day histogram, officer workload,
  security-event flags, skeleton loaders, and 60s silent auto-refresh
- Logout confirmation dialog for every role
- PHP + node test suites under `bluewrite/tests/`

### Added — brand (`636acc6` → `d832fb8`)

- BlueWrite logo: a police shield holding report text bars, the last
  line ending in a blinking block caret — shipped across sidebar,
  login, welcome screen, and as a simplified 16px favicon; master SVGs
  and light/dark lockup variants live in `docs/`
- BLUEWRITE hero wordmark on the welcome screen with the same
  treatment as the login hero
- Shared `HeroGlitchText` component: RGB-split ghost burst + character
  scramble on a randomized idle loop (`a8e9136`), reduced-motion aware

### Changed

- Welcome screen "Recent reports" now leads with unfinished drafts
  (`8098cae`) so open work is one click to resume
- Decorative logo usages are hidden from the accessibility tree
  (`eee0757`)

### Infrastructure

- Git repository initialized with a hardened ignore list: DB
  credentials, the 229 MB Laragon installer, a real-reports SQL dump,
  and source requirement documents are all kept out of version control
- Published to GitHub as a private repository with a branded front
  page README (`c45ae5b`)

[1.0.0]: https://github.com/Shinnaida/bluewrite/releases/tag/v1.0.0
