# BlueWrite — Security Notes (Phase 1)

## Authentication

- **Password hashing:** PHP `password_hash()` with bcrypt (cost 10); verification via `password_verify()`. Plaintext passwords are never stored or logged.
- **Session management:** PHP sessions with cookie flags `HttpOnly`, `SameSite=Strict`, path `/`. `session_regenerate_id(true)` on successful login to prevent session fixation. Session name is custom (`BLUEWRITE_SESS`) to avoid default `PHPSESSID`.
- **Session timeout:** server-side idle timeout, 30 minutes (configurable in `config/config.php`). The client mirrors it with a visible countdown for shared-terminal awareness.
- **Account lockout:** 5 consecutive failed attempts locks the account for 15 minutes (`users.failed_attempts`, `users.locked_until`). Lockout events are audit-logged. Counter resets on successful login.
- **Login enumeration:** error messages are identical for unknown user vs. wrong password; unknown-identifier attempts are still audit-logged with `user_id = NULL`.
- **HTTPS note:** the LAN deployment runs plain HTTP (no TLS) for Phase 1; the `secure` cookie flag is therefore off. If TLS is added later (e.g. self-signed or station CA), set `'secure' => true` in `app/core/Session.php`. Documented as a known trade-off — station PCs are on an isolated LAN with no internet exposure.

## CSRF protection

- Every state-changing request (`POST`, `PATCH`, `DELETE`) must send the session-bound token in the `X-CSRF-Token` header; validated with `hash_equals()` (timing-safe).
- Token is issued at login (`/api/v1/login` response) and returned by `/api/v1/me` so the SPA can attach it.
- GET requests are read-only and mutate nothing.

## RBAC

- Three roles: **Admin**, **Officer**, **Staff** (`roles` table, FK from `users`).
- Every API endpoint calls `Auth::requireUser()` or `Auth::requireRole(...)` — role checks are **server-side only**; hiding UI elements is a UX courtesy, never the security boundary.
- Ownership rules (enforced in `ReportsController`):
  - Officers/Staff edit and archive **only their own** reports.
  - Finalized reports are locked for everyone except Admin.
  - Only Admin and Officer may finalize; Staff may not.
- Guards against lockout: the last active Admin cannot be deactivated or demoted; an admin cannot deactivate their own account while signed in.

## SQL injection prevention

- **Prepared statements only.** All queries use PDO prepared statements with bound parameters (`PDO::ATTR_EMULATE_PREPARES => false` for true server-side prepares).
- The two places that build SQL fragments (dynamic `UPDATE ... SET` in controllers) only interpolate **hardcoded column-name allowlists** — user input is always bound as parameters, never concatenated into SQL.

## XSS

- React escapes all rendered values by default; no `dangerouslySetInnerHTML` anywhere.
- API responses are `application/json` with `X-Content-Type-Options: nosniff`.
- Narrative and free-text fields are stored as plain text and rendered as text nodes only.

## Audit trail (UC-019)

- `audit_logs` is **append-only**: inserts via `App\Core\Audit::log()`; no update/delete code paths exist anywhere in the codebase, and the UI never exposes it.
- Logged events: login success/failure/lockout, logout, user create/update/deactivate, report create/update/finalize/archive.
- Each entry records: who (`user_id`, nullable for anonymous failures), what (`action`), which record (`entity_type` + `entity_id`), when (`created_at`), source IP, and a short detail string. No sensitive payloads (passwords) are ever logged.
- Report edits additionally write a full **snapshot** to `report_history` with a change note — the report's prior state is always reconstructable.

## Deletion policy

- Users are **deactivated** (soft), reports are **archived** (soft, `deleted_at` timestamp). No hard deletes in Phase 1 — required for audit integrity.

## Known limitations / next phases

- No TLS on the LAN (see above); recommended before Phase 5 evaluation if feasible.
- Rate limiting beyond account lockout (e.g. per-IP throttling) is deferred; the LAN-only exposure reduces risk.
- Security hardening pass + backup restore drill scheduled for Phase 4 per the roadmap (password policy enforcement beyond minimum length arrives there).
