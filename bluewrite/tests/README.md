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

# 2) Start the dedicated test API server (scratch DB via env var)
export BLUEWRITE_DB_NAME=bluewrite_test
php -S 127.0.0.1:8098 -t public public/api.php &

# 3) Run the suite
php tests/run-tests.php
# or directly:
php phpunit.phar --bootstrap tests/bootstrap.php tests
```

## What is covered (24 tests)

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
