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
to the shared network (for example `192.168.0.108`). Ignore `169.254.x.x`
(no DHCP) and `127.0.0.1` (this machine only).

## 2. Server: start BlueWrite

From the repo, the existing launcher starts the API bound to all interfaces:

```
cd bluewrite
scripts\serve.cmd
```

or, from the watchdog directly:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watch-servers.ps1
```

The command the watchdog runs is:

```
php -S 0.0.0.0:8099 -t public router.php
```

`0.0.0.0` means "every network interface". To keep the API on this PC only, set
`-ApiBind 127.0.0.1` on `watch-servers.ps1`.

**Development use only.** PHP's built-in server is not a production web server.
For a longer-running deployment, put Apache or Nginx with PHP-FPM in front of
`public/` (the `.htaccess` in `public/` is the Apache routing rules).

## 3. Server: set the URL the app advertises

`config/config.php`, `app.base_url`, is the address written into sign-in code
emails:

```php
'base_url' => 'http://192.168.0.108:8099',
```

It must match the IP and the port the clients type. If the server's IP changes,
update this value. Use a DHCP reservation (section 5) so it does not change.

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

## 5. Stable IP for the server

In the Wi-Fi router's admin page, find **DHCP reservation** (sometimes "Address
reservation" or "Static DHCP"). Bind the server's MAC address (`ipconfig /all`,
"Physical Address") to its current IP. Then `base_url` never needs changing.

## 6. Clients: open BlueWrite

On another computer or a phone on the same network:

```
http://192.168.0.108:8099/
```

Replace the IP with the server's address. The port is `8099`. The app opens the
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
| Client: "This site can't be reached" | Wrong IP, or server off the network | Re-run `ipconfig`; confirm both are on the same Wi-Fi |
| Server works, client times out | Windows Firewall blocks 8099 | Section 4; network must be Private or rule must exist |
| Server shows `127.0.0.1:8099` in netstat | Old server still bound to loopback | Stop it (Task Manager), restart `serve.cmd` |
| Sign-in code email has a wrong link | `base_url` is old or missing the port | Fix `config.php` section 3 |
| Works on server, not on clients, on guest Wi-Fi | Client isolation / AP isolation | Guest networks and some routers block device-to-device traffic; use the main network or ask the admin to disable "AP isolation" |
| Works until the IP changes | No DHCP reservation | Section 5 |
| "Database connection failed" | MySQL not running on the server | Start Laragon's MySQL; the watchdog repairs 3306 when it is free |
| Session lost or repeated sign-in | Idle timeout (30 min) or two IPs in use | Expected; sign in again |
| Phone shows a blank page or no CSS | Phone browser cannot reach the app | Same as first row; test with the browser on the server first |

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
- The LAN address is fixed in `config.php`. Moving the server to a new IP means
  editing `base_url` and retesting from the clients.

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
