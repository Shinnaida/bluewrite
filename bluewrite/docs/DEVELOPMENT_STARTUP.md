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
