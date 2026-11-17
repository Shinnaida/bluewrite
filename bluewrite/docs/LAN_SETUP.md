# BlueWrite on a LAN — setup

One computer (the **server**) runs PHP and MySQL and holds all records. Other
computers (**clients**) open BlueWrite in a browser. Clients need no PHP or MySQL.

```
Client browsers ──HTTP──▶ Server PC: PHP API + app on 0.0.0.0:8099
                                   │
                                   └─ MySQL on 127.0.0.1:3306 (never exposed)
```

Database credentials stay in `config/config.php` on the server. Browsers never
connect to MySQL.

## 1. Server: find its LAN IP (Windows)

In a Command Prompt or PowerShell:

```
ipconfig
```

Use the **IPv4 Address** under the Wi-Fi or Ethernet adapter that is connected
to the shared network — on this server that is **`192.168.100.6`**, and it is now
**static** (section 5), so it is the same address after every reboot.
Ignore `169.254.x.x` (no DHCP), `127.0.0.1` (this machine only) and
`192.168.100.1` (the router).

## 2. Server: start BlueWrite

From the repo, the launcher starts whatever is missing:

```
cd bluewrite
scripts\serve.cmd
```

or, from the watchdog directly:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1
```

The app and the API are served by **Apache on port 8099**. The configuration is
**generated on every start** from this repo's template, against whatever Apache
and PHP are installed:

```
bluewrite\scripts\apache\bluewrite-httpd.conf.template   the template (source)
bluewrite\storage\apache\bluewrite-httpd.conf            the generated config
```

`watch-servers.ps1` renders it (and creates `storage\logs\` and
`storage\sessions\`). **A Laragon or PHP upgrade needs no edit:** the new
`httpd-2.4.x-…` or `php-8.4.x-…` folder is discovered on the next start and the
config is rewritten to point at it, instead of pointing at a folder that no
longer exists. To regenerate by hand:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -RenderConfig
```

It listens on `0.0.0.0:8099` — **every** network interface, which is what lets the
client PC reach it. Windows Firewall rule `BlueWrite LAN 8099` is what decides
which networks may come in; the config also refuses non-private client addresses
(`Require ip 127.0.0.1 ::1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16`).

### Why Apache and not `php -S`

PHP's built-in server answers **one request at a time**, so with two workstations
on the register the second waits behind the first. Measured on this server, with
no other change:

| Twelve simultaneous requests, each taking 200 ms | Total |
|---|---|
| `php -S` (built-in) | **2,638 ms** — one after another |
| Apache (`ThreadsPerChild 16`) | **577 ms** — sixteen in flight |

### PHP-FPM is not an option on Windows

PHP's Windows binaries ship **no `php-fpm.exe`** — FPM is POSIX-only, and php.net
says so. This Apache has no `mod_fcgid` either, and `php-cgi -b` on its own
answers one request at a time exactly like `php -S`. The concurrent setup on
Windows is **mod_php**, which the config loads. Any response's `Server:` header
reads `Apache/2.4.68 (Win64) PHP/8.3.33`.

### Check it, without starting anything

Render the config, then ask the installed Apache to read it:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1 -RenderConfig
"C:/laragon/bin/apache/<installed version>/bin/httpd.exe" \
  -f "C:/Users/Shaine Jayme/Desktop/BLUEWRITE/bluewrite/storage/apache/bluewrite-httpd.conf" -t
# Syntax OK
```

- PHP errors and access requests: `storage/logs/apache-error.log` and
  `apache-access.log`.
- Session files: `storage/sessions/` — kept out of the machine-wide temp folder
  so BlueWrite's sign-in state has one findable home. **This is isolation, not a
  measured speedup:** moving it made no reliable difference to `session_start()`
  (24–63 ms in both places, varying run to run).
- All three folders are git-ignored.

**If the fallback ever runs, it is not silent.** When Apache cannot start (no PHP
build that Apache can load, a broken template), the watchdog still brings the
register up on `php -S` so the station is not dead — but it logs
`api 8099 DEGRADED`, and `-Status` names the program holding the port:

```
api    http://127.0.0.1:8099/  up  (Apache, threaded)                        <- what you want
api    http://127.0.0.1:8099/  up  (php -S: SINGLE REQUEST - workstations queue)
```

`php -S` remains fine for a solo smoke test in development; it is just not what
the station server runs.

## 3. Server: the address is measured, not typed (no edit per move)

The server detects its own LAN address on every request (see
`app/core/ServerAddress.php`) and serves it at `GET /api/v1/server/address`.
The dashboard's **Client access** card shows it with a Copy button — the
officer at the desk copies it onto the client instead of typing an IP from
memory. Sign-in code emails print the same measured address.

The port shown is the app's LAN port (`8099`, Apache on all interfaces), never
the port the Admin's own browser happens to be on: the dev server is
`127.0.0.1:5180` only, so reading this card from it would otherwise hand a
client an address that times out on every other PC.

`config/config.php`, `app.base_url`, remains only as an OVERRIDE (an https
reverse proxy, a pinned hostname). When it is empty or missing, the measured
address is used — so a server PC that changes networks needs no config edit.
A DHCP reservation (section 5) still helps bookmarks stay valid, but nothing
breaks without one: the dashboard always shows the current address.

## 4. Server: allow the port through Windows Firewall

Windows puts a new network in the **Public** profile, and Public blocks inbound
connections. Two options:

**a. Make the network Private (recommended for a trusted office Wi-Fi).**
Run PowerShell as Administrator:

```
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
```

**b. Allow TCP 8099 on the Private profile only.** Run as Administrator:

```
netsh advfirewall firewall add rule name="BlueWrite LAN 8099" dir=in action=allow protocol=TCP localport=8099 profile=private
```

Do not turn the firewall off. Do not open 3306 (MySQL) or 5180 (dev server).
To remove the rule later:

```
netsh advfirewall firewall delete rule name="BlueWrite LAN 8099"
```

## 5. Stable IP for the server (done — keep it that way)

The server PC's Wi-Fi adapter now holds the **static address `192.168.100.6`**
(mask `255.255.255.0`, gateway `192.168.100.1`, DNS `192.168.100.1`), so the
client's bookmark survives reboots and DHCP lease renewals. Confirm it with:

```
netsh interface ip show config name="Wi-Fi"      # "DHCP enabled: No"
```

Two consequences worth knowing:

1. **Moving this PC to another network needs a DHCP switch first.** A static
   address that belongs to the old subnet has no route out of the new one. Run
   these as Administrator, let the new network hand out an address, then pin the
   new one:

   ```
   netsh interface ip set address name="Wi-Fi" dhcp
   netsh interface ip set dns name="Wi-Fi" dhcp
   ```

2. **A static address inside the router's DHCP pool can still be loaned to
   another device** while this PC is switched off. The durable version of the
   same guarantee is a **DHCP reservation**: in the Wi-Fi router's admin page
   ("DHCP reservation" / "Address reservation" / "Static DHCP"), bind this PC's
   MAC address (`ipconfig /all`, "Physical Address") to `192.168.100.6`. With a
   reservation the PC can go back to DHCP and still keep the address.

## 6. Clients: open BlueWrite

On another computer or a phone on the same network:

1. On the server's dashboard, read the **Client access** card (it shows the
   current address, e.g. `http://192.168.68.109:8099/`).
2. Press **Copy**, paste it into the client browser, and sign in.

Never reuse an old address from memory or history — after a move the card
shows the new one on its own. The port is `8099`. The app opens the
sign-in page. Sign in with the account you were given.

## 7. Database configuration

- `config/config.php` → `db.host = '127.0.0.1'`, `db.name`, `db.user`, `db.pass`.
  The server reads these. They are never sent to a browser.
- MySQL listens on the server only. Clients never need its port.
- Do not run `database/seed_demo.php` or the schema migrations against the live
  database just to start the app. Startup does not reset or seed the database.

## 8. Two-computer test checklist

Use two computers on the same Wi-Fi (or one computer plus a phone). Use synthetic
records only.

1. [ ] Server: `ipconfig` shows the IP; `config.php` `base_url` matches it.
2. [ ] Server: `netstat -ano | findstr :8099` shows `0.0.0.0:8099 LISTENING`.
3. [ ] Client A and Client B both open `http://<server-ip>:8099/` and see sign-in.
4. [ ] Client A signs in as an Officer, completes the emailed code, and lands on Home.
5. [ ] Client B signs in as an Admin and lands on the Dashboard.
6. [ ] Client A creates a report. Client B refreshes Reports and sees it.
7. [ ] Client B edits the report. Client A refreshes and sees the edit.
8. [ ] Audit log names the correct user for each change.
9. [ ] Client A tries to edit a report it did not create: refused (403).
10. [ ] An Officer cannot reach `/admin` or Admin endpoints (redirect or 403).
11. [ ] Opening the app without signing in redirects to `/login`.
12. [ ] Known gap: the server does not block a duplicate *create*. Two rapid
    "Save" clicks can make two draft reports. Check this and remove the
    duplicate by hand if it happens (see Limitations).
13. [ ] Stop and restart the API; both clients recover on refresh, data intact.
14. [ ] Log out on Client A; Client B is unaffected.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Client: "This site can't be reached" | Stale address, or server off the network | Read the dashboard's Client access card (it always shows the current address); confirm both are on the same Wi-Fi |
| Server works, client times out | Windows Firewall blocks 8099 | Section 4; network must be Private or rule must exist |
| Server shows `127.0.0.1:8099` in netstat | Old server still bound to loopback | Stop it (Task Manager), restart `serve.cmd` |
| Sign-in code email has a wrong link | A stale `base_url` override is set | Clear the override (section 3) so the measured address is used |
| Works on server, not on clients, on guest Wi-Fi | Client isolation / AP isolation | Guest networks and some routers block device-to-device traffic; use the main network or ask the admin to disable "AP isolation" |
| Works until the IP changes | No DHCP reservation | Section 5 |
| "Database connection failed" | MySQL not running on the server | Start Laragon's MySQL; the watchdog repairs 3306 when it is free |
| Session lost or repeated sign-in | Idle timeout (30 min) or two IPs in use | Expected; sign in again |
| Phone shows a blank page or no CSS | Phone browser cannot reach the app | Same as first row; test with the browser on the server first |
| Every page 500s, or PHP source is shown as text | Apache started without mod_php | Read `storage/logs/apache-error.log`; the watchdog's fallback is `php -S` |
| Everything is slow with two workstations but fast alone | Something is serving `php -S` instead of Apache | `netstat -ano | findstr :8099` — the owner must be `httpd.exe`, not `php.exe` |

## Limitations

- **Duplicate creates are not blocked by the server.** The client's Save button
  is disabled while a request is in flight, which covers a double-click. A fast
  double-submit from two computers, or a retry after a timeout, can still create
  two draft reports. Fixing this needs a client-supplied idempotency key in the
  create endpoint; that is a change to the API contract and is not in this
  release.
- **Concurrent edits: last save wins, but nothing is lost silently.** Each save
  runs in a transaction that locks the report row, so two saves cannot interleave
  their audit snapshots. The later save overwrites the fields it sends, and the
  earlier values remain in report history.
- The LAN address is pinned on this server (static `192.168.100.6`). Moving the
  PC to another network means switching the adapter back to DHCP first
  (section 5); `base_url` follows the measured address on the next start.
- **Concurrent API calls still contend inside the app.** Apache removes the
  web server's queue (the 200 ms test above), but twelve simultaneous calls to
  `/api/v1/me` measured 761 ms on `php -S` and 792 ms on Apache — the remaining
  limit is the app's own per-request work (session + database), not the server.
  Two officers working normally are far below that; a load test is not what this
  measurement was.

## 10. Security notes

- Only use the LAN on a trusted network. The IP address and Wi-Fi password are
  not sufficient on their own: every page and API call still requires sign-in.
- The app runs over **plain HTTP** on the LAN. Credentials and records are
  visible to anyone who can capture traffic on that network. Use HTTPS when
  possible: put a TLS reverse proxy (for example Caddy or Nginx) in front and set
  `base_url` to `https://…`. The session cookie is marked `Secure` only over HTTPS.
- Do not forward port 8099 on the router. Do not expose MySQL.
- The session cookie is `HttpOnly` and `SameSite=Strict`. Each device has its own
  cookie.
