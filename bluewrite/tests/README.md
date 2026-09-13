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
