# BlueWrite — API test suite (Item 4)

End-to-end tests: real HTTP calls against the real API, running on a **scratch
database** (`bluewrite_test`) that is dropped, recreated from
`migrations/001_schema.sql`, and reseeded **before every test**. The dev
database and any station database are never touched.

## One-time setup (local dev machine only)

```bash
# Let the app DB user reset the scratch DB (it deliberately has no global rights)
mysql -u root -e "GRANT ALL PRIVILEGES ON bluewrite_test.* TO 'bluewrite'@'localhost'; FLUSH PRIVILEGES;"
```

## Running

```bash
cd bluewrite

# 1) Download PHPUnit (already git-ignored; do not commit)
curl -sL -o phpunit.phar https://phar.phpunit.de/phpunit-11.phar

# 2) Start the dedicated test API server (scratch DB + logged mail, via env vars)
export BLUEWRITE_DB_NAME=bluewrite_test
export BLUEWRITE_MAIL_TRANSPORT=log
php -S 127.0.0.1:8098 -t public public/api.php &

# 3) Run the suite
php tests/run-tests.php
# or directly:
php phpunit.phar --bootstrap tests/bootstrap.php tests
```

## What is covered (358 tests)

- **AuthTest** — login success, badge-number login, wrong-password 401 with
  anti-enumeration message parity, lockout after 5 failed attempts (423),
  inactive-account rejection, `/me` requires session, missing CSRF → 419.
- **RbacTest** — Staff cannot finalize, Officer can finalize own, non-owner
  cannot edit, Admin can edit anyone's, finalized locked for non-admin but
  editable by Admin, last admin cannot be demoted, no self-deactivation,
  Staff cannot list users.
- **ReportsTest** — incident-type allowlist, missing location 422, invalid
  datetime 422, finalize requires narrative, archive is soft-delete only,
  user deactivation is soft only, restore (Item 2) is Admin-only and writes a
  history snapshot, history endpoint shape (Item 1).
- **SystemInstructionTest** — standalone (no server/DB): all 14 canonical
  incident types present in `type_vocabulary.json`, base prompt loads with
  maintainer comments stripped, matching type vocabulary + sensitivity note
  appended once, unknown/empty types fall back to the base instruction.
  Run directly: `php phpunit.phar --bootstrap tests/bootstrap.php tests/SystemInstructionTest.php`
- **AiClassifyTest** — Phase 7, standalone (no server, DB or key): the
  free-form account read's contract. The type is an enum of the station's own
  list; every answer field is required and may be empty; a type off the list, a
  datetime that is not one, a role that is not one and a party with no name are
  rejected rather than repaired; the instruction actually carries the station's
  types and today's date; and `NarrativeService::classifyAccount()` is driven
  through the stub provider.

  The same file covers the SECOND half of that read,
  `POST /ai/classify/details` — the incident type's own fields. There the field
  list is assembled by the app (`ReportRules::scalarKeysFor()` /
  `groupsFor()`), so what is asserted is that the list reaching the model is
  exactly the form's own: every scalar and row field of the type and nothing
  else, no mirrored scalar (`vehicle_1_plate_number` belongs to vehicles[0]),
  no `required` anywhere (an empty field is the honest answer), and an answer
  about a field that was not asked dropped rather than passed on.
  Run directly: `php phpunit.phar --bootstrap tests/bootstrap.php tests/AiClassifyTest.php`
- **AiClassifyApiTest** — the routes and the guards in front of them (session,
  CSRF, empty account → 422), for both `POST /ai/classify` and
  `POST /ai/classify/details` — the second one adds the guard that a type with
  no field list (`Vehicular Accident`, a legacy spelling the create still
  accepts) is refused rather than read against a form that does not exist.
  **Neither test sends a non-empty account**: the station's key is configured,
  so that would be a real, billed model call, and a test must not spend the
  station's budget or depend on an answer. The reading itself is covered
  offline above.
- **NotificationsTest** — the bell's feed (`GET /notifications`) and its read
  watermark (`POST /notifications/seen`): only reports the account itself
  recorded, only acts OTHER people performed, the autosave note is not an event,
  a dispute carries its own words and supersedes an earlier review, an archived
  report's reviews drop out while the archive itself stays, and the watermark
  moves forward only, per account, never into the future. See
  `docs/NOTIFICATIONS.md`.
- **PasswordPolicyTest** — standalone: the one home of the password rule, and
  what it refuses (short, repeated character, the username or badge number
  inside the password, the obvious guesses, the current password) and what it
  accepts. Includes the bcrypt 72-byte ceiling, which is a real limit rather
  than a style rule: everything past 72 bytes is ignored by the hash, so two
  different long passwords would otherwise be the same password.
  Run directly: `php phpunit.phar --bootstrap tests/bootstrap.php tests/PasswordPolicyTest.php`
- **PasswordChangeTest** — `POST /me/password`: the CSRF gate, the difference
  between holding a token and holding an account, re-authentication with the
  current password, the policy enforced server-side rather than only in the
  form, and the two facts a user needs to be able to trust — the session really
  is gone afterwards, and the NEW password is the one that works. The password
  policy itself is `app/core/PasswordPolicy.php`, and it is also mirrored in
  `src/lib/passwordPolicy.js` with its own rules test in `tests/rules/`.
- **EmailOtpTest** — the second factor end to end: a correct password that
  signs nothing in (a pending sign-in cannot read `/me`, reports or users), the
  code screen being told where the code went, an account with no email address
  refused at sign-in AND signed out of a session already open, the emailed code
  completing the sign-in, a code that cannot be used twice, a malformed code
  that spends no attempt, a resend that is throttled and replaces the old code,
  five wrong codes locking the factor with the wait advertised at sign-in, an
  Admin reset clearing an outstanding code (and an Officer refused it), and no
  six-digit code anywhere in the audit trail. See `docs/EMAIL_OTP.md`.

  Two harness notes, because both look like bugs in the app and are not:
  `BaseApiTestCase::login()` completes the second factor for every account it
  signs in (an Admin or Officer sign-in stops at a code screen, so ~40 existing
  tests would otherwise be asserting about a session that was never created),
  and it reads the code out of the MAIL LOG. That writes each message to
  `config/mail.log` instead of sending it; there is deliberately no endpoint that
  returns a code, because the server keeps only a hash of one.

  A readable code and a real mail transport CONFLICT, so start the server with
  **`BLUEWRITE_MAIL_TRANSPORT=log`** and leave `config/config.php` set to whatever
  the machine actually needs. The env var forces the 'log' transport for that
  process only (app/core/Config.php, beside `BLUEWRITE_DB_NAME`), which means a
  station configured to send real codes through Gmail can still run this suite —
  without it, every sign-in test fails with "no sign-in code was written to …".
  `tests/run-tests.php` reports the variable if the shell is missing it.
