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
them. Reload every tab after a switch and the state and the session agree again.

**The way out is not to switch inside one origin.** Either reload after switching, or
give each officer their own hostname (`localhost` / `127.0.0.1`) or a window that does
not share cookies at all: InPrivate, a second browser, or a second Chrome profile.

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

### Login says "Security token missing or expired"
Normal for direct curl tests — the login route is reachable; the request just
lacks CSRF/session context that the real UI supplies. Use the browser UI.

### Seed users (dev only)
Seeded logins (see `database/seed.php`): `m.santos` (Admin),
`j.delacruz` (Officer), `e.ramos` — all with password `Passw0rd!23`.
