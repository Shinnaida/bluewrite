# BlueWrite — Local Development Startup Guide

This machine has **two MySQL installations**, and only one of them holds the
BlueWrite database. After a reboot, the wrong one can grab port 3306 and the
API will answer every request with
`"Database connection failed. Contact the system administrator."`
This document explains the port conflict and the exact startup order.

---

## Why the port conflict happens

| Instance | Location | Data directory | Has BlueWrite DB? |
|---|---|---|---|
| **MySQL84** (Windows service) | `C:\Program Files\MySQL\MySQL Server 8.4` | `D:\New folder\Data` (via `D:\New folder\my.ini`) | ❌ No — different datadir, no `bluewrite` user |
| **Laragon MySQL** | `C:\laragon\bin\mysql\mysql-8.4.3-winx64` | `C:\laragon\data\mysql` | ✅ Yes — `bluewrite` + `bluewrite_test` schemas, app user `bluewrite` |

Both listen on **3306**. Whoever starts first wins the port. The MySQL84
service was set to **automatic** startup, so after every reboot it took 3306
and Laragon's MySQL (with the real database) could not start.

**Fixed on 2026-09-12:** the MySQL84 service is now set to **manual** startup
(`sc config MySQL84 start= demand`), so it no longer starts on boot and the
port is free for Laragon's MySQL. Do not set it back to automatic.

---

## Correct startup order (after a reboot)

Run these from the `bluewrite/` folder unless noted. Order matters:
the database must be up before the API, and the API before the UI proxies to it.

### 1. MySQL (Laragon) — port 3306

```bash
"C:/laragon/bin/mysql/mysql-8.4.3-winx64/bin/mysqld.exe" \
  --no-defaults \
  --datadir="C:/laragon/data/mysql" \
  --port=3306
```

Or simply open the **Laragon** app and click *Start All* — Laragon starts its
own MySQL with the same data directory.

Verify:

```bash
netstat -ano | findstr ":3306"
# → LISTENING, and NOT owned by "C:\Program Files\MySQL\..."
```

### 2. PHP API — port 8099 (the Vite proxy target)

```bash
cd bluewrite
"C:/laragon/bin/php/php-8.3.33-Win32-vs16-x64/php.exe" -S 127.0.0.1:8099 router.php
```

`vite.config.js` proxies `/api` → `http://localhost:8099`, so this port is
not optional.

Verify:

```bash
curl -s -X POST http://127.0.0.1:8099/api/v1/login \
  -H "Content-Type: application/json" \
  -d '{"username":"m.santos","password":"Passw0rd!23"}'
# → {"user":{...},"csrf_token":"..."}   (a DB error here means MySQL isn't up)
```

### 3. Vite dev server — port 5180

```bash
cd bluewrite
npm run dev -- --port 5180 --strictPort
```

Browse to **http://localhost:5180**.

### The one-step way — `BlueWrite.exe`

**`BlueWrite.exe` sits in the checkout root, beside `Start BlueWrite.bat`** and does
what the three steps above do in that order: it reports each port, starts whatever is
missing, and opens the app. Double-click it.

It is a **front door, not a second house.** The starting itself is `scripts\serve.cmd`
and `scripts\watch-servers.ps1` — the same two files the `.bat` calls — so the two
launchers cannot drift about which port the API is on or which MySQL is correct. What
the `.exe` adds is only what a station workstation needs: the report is **read** rather
than flashed past (a failure waits for a keypress, where the `.bat`'s window closes),
the reason a start failed is named instead of a cmd.exe path message, and it takes two
flags:

```bash
BlueWrite.exe --no-open   # bring the stack up, leave the browser alone
BlueWrite.exe --help      # what it does
```

**Keep it beside the `bluewrite` folder** — it finds the application from its own
location, and says so plainly if it has been moved away from it.

**Rebuilding it** (after editing `scripts\launcher\BlueWrite.cs`):

```bash
bluewrite\scripts\launcher\build.cmd
```

That uses the C# compiler already inside Windows — no SDK download, nothing to
install on the station:

```text
%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
```

The compiler is C# 5, so the launcher's source stays inside that language version.
The built `BlueWrite.exe` is committed (it is a few KB), so a workstation that has
only cloned the repository can double-click it without compiling anything.

---

## Testing with more than one account (two officers, one laptop)

The presence rail and the chatbox are the two features where **one account is not
enough**. The rail draws everybody but you, so a machine with one account signed in shows
an empty corner and nothing to press; and a conversation needs somebody to have it with,
which is also the only way to see the typing dots or an unread mark appear.

**Sign in twice, in two windows, on two hostnames.** The session cookie is
`BLUEWRITE_SESS`, and it carries **no `Domain` attribute** — so a browser keys it to the
exact host it was set from. `localhost` and `127.0.0.1` are two different hosts and both
are served by the same Vite dev server, so they are two independent cookie jars in one
ordinary browser:

| Window | URL | Sign in as |
|---|---|---|
| 1 | http://localhost:5180 | `m.santos` (Admin) |
| 2 | http://127.0.0.1:5180 | `j.delacruz` (Officer) |

Both windows are the same app, the same API and the same database. The only thing that
differs is which session the browser sends — **there is no test mode in the code**, and
the two sessions are ordinary logins. (`Start BlueWrite.bat` prints both URLs when it
launches, so the second one is one copy-and-paste away.)

`127.0.0.1` is also a **secure context** in the browser, exactly as `localhost` is, so
the things that need one — the copy buttons behind `navigator.clipboard` — behave
the same on both origins. Nothing is lost by signing in the second officer there.

Checked against the running dev server, which is where the no-`Domain` claim comes from:

```bash
curl -s -i -X POST http://127.0.0.1:5180/api/v1/login \
  -H "Content-Type: application/json" \
  -d '{"username":"j.delacruz","password":"Passw0rd!23"}' | grep -i set-cookie
# set-cookie: BLUEWRITE_SESS=…; path=/; HttpOnly; SameSite=Strict     ← no Domain=
```

**A third officer needs a third jar**, and there are only two names here — Vite binds the
IPv4 loopback only, so `[::1]` is not a third one. Use an **InPrivate/Incognito** window
(its own jar), a second browser, or a second Chrome profile, and sign in as `e.ramos`
(Staff).

**Different accounts, not the same one twice.** Two sessions of `m.santos` are still one
officer: the rail hides your own account, so the corner stays empty and the second window
has nobody to talk to. That is the rail working correctly, and it is the mistake that
looks like a bug.

What two sessions let you actually check, none of which a single one can show:

- **two faces in the rail**, with the tooltip and the accessible name on somebody you are
  not signed in as;
- **a real thread** — send from one window and watch it arrive in the other, which is the
  only way to see the open thread's poll do anything;
- **the typing dots**, which need a draft in the *other* window to exist at all;
- **the unread mark** on a chathead, and the count clearing when the thread is opened;
- **`openPeerId`** — the colleague you are talking to leaves the rail while the box is
  open, and comes back when it is closed.

Signing out affects **only that window's** session, because it is that host's cookie being
destroyed — the other officer stays signed in, which is the point rather than a bug.

### "Your account does not have permission to perform this action." after switching

**That banner is what mixing two accounts in ONE origin looks like**, and it is worth
recognising because it reads as a broken permission system rather than as a stale tab.
Every window and tab of the same host shares one cookie jar, so signing in as `e.ramos`
in a second `localhost:5180` tab silently replaces the session under the *first* tab too —
while that tab still holds `m.santos` in its own React state, with an Admin's menus
already drawn. Its next request is the new session's, `requireRole('Admin')` refuses it,
and the dashboard keeps the last good numbers on screen while hanging the refusal above
them.

**As of 2026-10-11 the workspace reconciles itself, so this no longer needs a manual
reload.** The role refusal now carries a machine-readable `code: "forbidden"` (see
`Auth::requireRole`, and the register's `created_by` gate), and `src/lib/api.js` raises one
session-mismatch listener for that code or for any 401. `App.jsx` answers it by reading
`/me` again: a DIFFERENT account is adopted — the workspace is keyed on the account, so it
remounts on the new role's own home with no Admin menu left over — a session that is gone
returns to the gate, and a refusal from the SAME account is left for the screen's own
banner (a finalized report, somebody else's draft) because nothing about the session
changed. The refused request still renders its own message; the workspace simply stops
being stale a moment later. The listener is unit-tested against a stubbed fetch in
`tests/rules/sessionRecovery.test.mjs`.

**Switching two accounts inside one origin is still worth avoiding.** Two officers still
share one cookie jar, so the first tab still loses its session the moment the second signs
in — the reconciliation just means the screen catches up on its own instead of waiting for
a human to reload it. Keeping each officer on their own hostname (`localhost` /
`127.0.0.1`) or a window that does not share cookies at all (InPrivate, a second browser,
a second Chrome profile) avoids the refusal altogether.

---

## Troubleshooting

### "Database connection failed" on login
MySQL on 3306 is the **wrong instance** (or not running).
1. `sc query MySQL84` — if it says RUNNING, stop it (below).
2. Start Laragon's MySQL (step 1 above).

### MySQL84 grabbed the port again
Stop it (requires an elevated prompt):

```bash
net stop MySQL84
```

Check its startup type — it must stay **manual**:

```bash
sc qc MySQL84
# START_TYPE : 3  DEMAND_START   ← correct (manual)
# START_TYPE : 2  AUTO_START     ← will hijack 3306 on every reboot
```

### `mysqld: Cannot load component from specified URN: 'file://component_reference_cache'.`

The Laragon MySQL install was missing its whole `lib\` folder (plugin DLLs and
the ICU data). A **newly initialised** MySQL 8.4 data directory registers the
`component_reference_cache` component, and the server loads it from
`<basedir>\lib\plugin\` on every start — so with `lib\` gone, any *fresh* data
directory refuses to start:

```text
mysqld: Can't open shared library 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\lib\plugin\component_reference_cache.dll' (errno: 126 The specified module could not be found.)
mysqld: Cannot load component from specified URN: 'file://component_reference_cache'.
```

Both lines go to the server's **console**, not to `Shinxx.err` — the error log
looks clean, which is what makes this one hard to place. The same missing folder
also produces the `Missing data directory for ICU regular expressions` warning.

**Why the BlueWrite database was never affected:** `C:\laragon\data\mysql` was
created before that component existed, registers no components at all
(`select * from mysql.component` is empty there), and starts fine. That is also
why the error only shows up when MySQL is pointed at a data directory it has to
create — the old `my.ini` said `datadir=C:/laragon/data/mysql-8.4`, which did not
exist, so a fresh directory would be initialised and then fail to start.

**Fixed on 2026-10-03:** `lib\` was restored from the matching archive, and
`my.ini` was repointed at the real data directory (`datadir=C:/laragon/data/mysql`,
the old file kept as `my.ini.orig-backup`).

```bash
# The archive must match the server version exactly: mysqld.exe 8.4.3 loads
# these DLLs, and a later 8.4.x pairing is not guaranteed to be compatible.
curl -L -o mysql-8.4.3-winx64.zip \
  https://cdn.mysql.com/archives/mysql-8.4/mysql-8.4.3-winx64.zip
unzip -q mysql-8.4.3-winx64.zip          # 248 MB download, ~700 MB unpacked
cp -r mysql-8.4.3-winx64/lib "C:/laragon/bin/mysql/mysql-8.4.3-winx64/"
```

Only `lib\` is needed; `bin\`, `share\` and `include\` were intact. Expect
`lib\libmysql.dll`, `lib\plugin\` (33 DLLs, `component_reference_cache.dll`
among them) and `lib\private\icudt73l\` afterwards, ~342 MB in total. Copy it
only while `lib\` is still absent — `cp -r` nests the folder as `lib\lib` if it
already exists.

**One more trap, found while fixing this:** initialising a data directory on a
path that contains a space fails in InnoDB —
`Can't create UNDO tablespace innodb_undo_001 since '.\undo_001' already exists`,
which aborts the server. The same initialise-then-start on a space-free path
(`C:\laragon\tmp\...`) came up clean, so keep scratch data directories off
`C:\Users\Shaine Jayme\`. The real server is unaffected: `C:\laragon\data\mysql`
has no space in its path.

### Login says "Security token missing or expired"
Normal for direct curl tests — the login route is reachable; the request just
lacks CSRF/session context that the real UI supplies. Use the browser UI.

### Seed users (dev only)
Seeded logins (see `database/seed.php`): `m.santos` (Admin),
`j.delacruz` (Officer), `e.ramos` — all with password `Passw0rd!23`.
