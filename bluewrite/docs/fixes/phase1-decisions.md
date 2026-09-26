# Phase 1 — Decisions (D-1, S-01 / S-04)

**Status:** DECIDED — implementation in Sub-phase 2.
**Date:** 2026-09-26
**Context:** `officer-role-gaps.md` → Phase 1 "Unblock sign-in (S-01, S-04)".

---

## D-1 — Offline second factor for Admin/Officer

**Decision:** build **single-use recovery codes** as the offline fallback
(Option A), with a **documented, audited break-glass procedure** (Option C) as
the last resort. **TOTP (Option B) is deferred** — it is the only *unlimited*
offline factor, so it should be reconsidered later if mail outages turn out to
be frequent (recovery codes deplete), but it carries the most implementation
risk and assumes a phone + authenticator app for every officer.

### Sub-decisions

| # | Question | Choice |
|---|---|---|
| D-1a | Which model? | Recovery codes + break-glass |
| D-1b | Enrolment | **Mandatory at onboarding, Admin-assisted** (in person at account setup) |
| D-1c | Code custody | Officer keeps one printed copy; the **station seals a second** |

### Why recovery codes first

- Works for **every** officer, with or without a smartphone or app.
- Smallest and safest to implement correctly: random generation + a password
  hash. No long-lived secret, no encryption key to manage (TOTP needs both).
- Fits the station: the printed sheet is a natural artefact for a police
  office, and a sealed copy gives a second route when an officer loses theirs.
- Matches the standards: NIST SP 800-63B-4 names **look-up secrets** (recovery
  codes) — ≥6 digits, single-use, stored hashed, delivered in person or over a
  protected channel; OWASP recommends single-use recovery codes at setup and a
  secure reset procedure.

### Constraints carried forward

- **Enrolment happens once, before an outage** — a fallback that was never set
  up protects nobody. This is why D-1b is mandatory at onboarding.
- **The email factor is unchanged and stays primary**; recovery only
  *supplements* it. A station with working mail signs in exactly as before.
- **No TLS yet** (S-02, out of scope) — NIST accepts **in-person** delivery of
  look-up secrets, which is why enrolment is Admin-assisted at the station
  rather than self-service over plain HTTP.

### Break-glass form (Option C)

Implemented as a **server-side, audited CLI procedure** — not a standing
account that bypasses the second factor. The operator with physical access to
the server runs `scripts/break-glass.php` to regenerate a locked-out account's
recovery codes and print them; every use writes an audit row
(`mfa.break_glass`). Rationale: a bypass account is a permanent hole in the
"MFA is mandatory" rule, whereas an audited on-server procedure is not.

See `docs/RECOVERY_CODES.md` (implementation) and `docs/BREAK_GLASS.md`
(policy) once Sub-phase 2 lands.
