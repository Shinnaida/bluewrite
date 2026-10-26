# Blotter capture on a phone — setup and use

One job: photograph the written blotter, read it through the portal's own
OCR, and file photo plus reviewed text into a Write Report draft. Checking
happens in the portal's draft sheet, where each photo sits beside the
narrative it produced — exactly as with an Upload / drag-drop capture on
the web.

```
Phone (station Wi-Fi) ──HTTP──▶ Server PC: PHP API on 0.0.0.0:8099
                                    │      (see LAN_SETUP.md)
                                    └─ MySQL on 127.0.0.1:3306 (never exposed)
```

The web's on-device engines (Tesseract, TrOCR) are JavaScript and cannot
move to Flutter. The phone does no recognition itself: the photo is offered
to the server's POST /ocr/read (Gemini vision first, then the image-to-text
API — the keys stay on the server), and when that misses the officer types
the account by hand.

## 1. Server: reachable on the LAN

This is the existing LAN setup, not a new one. From `docs/LAN_SETUP.md`:

1. `ipconfig` → the server's IPv4 (e.g. `192.168.0.108`).
2. The API already binds `0.0.0.0:8099` (the watchdog starts it that way).
   Confirm: `netstat -ano | findstr :8099` shows `0.0.0.0:8099 LISTENING`.
3. Firewall (run as Administrator, once):
   `netsh advfirewall firewall add rule name="BlueWrite LAN 8099" dir=in action=allow protocol=TCP localport=8099 profile=private`
4. `config/config.php` `base_url` matches the IP and port.
5. Apply the phone-app migrations to the station database (once — new
   tables, no existing data touched). Without this every phone call that
   touches a device token or a capture photo answers 500:
   ```
   mysql -h 127.0.0.1 -P 3306 -u bluewrite -p bluewrite < bluewrite/migrations/024_device_tokens.sql
   mysql -h 127.0.0.1 -P 3306 -u bluewrite -p bluewrite < bluewrite/migrations/025_report_captures.sql
   ```
   Confirm: `SHOW TABLES LIKE '%device%'; SHOW TABLES LIKE '%capture%';`
   names `device_tokens` and `report_captures`. (The test suite applies
   these itself via `BaseApiTestCase` — this step is for the real database
   only.)

## 2. Phone: install and set up (once per phone)

1. Install the `blotter_capture` APK on the officer's Android phone.
2. Open the app, enter the server address (e.g. `http://192.168.0.108:8099`
   — no `/api/v1` tail) and press **Test connection**. The phone must be on
   the station Wi-Fi.
3. Sign in with the officer's own portal account: username or badge number,
   password, then the emailed 6-digit code. Recovery codes work where mail
   does not.
4. Set the daily app PIN (digits, at least 4). It unlocks this phone only —
   it never leaves the phone and the portal never sees it.

What setup creates (migration 024): a device token off the fully signed-in
session, presented as `Authorization: Bearer` on every later call. The phone
never holds the password. The portal lists each phone under its account
(officers see their own; an Admin manages accounts, not phones).

## 3. Daily use

1. Open the app, enter the PIN.
2. Fill the frame with the blotter page, hold steady, **Capture**.
3. The server reads the photo. Correct anything it got wrong — a reading is
   a proposal, never a write — pick the incident type, name the place, and
   press **File photo + text to a draft**.
4. Open the Write Report sheet on the portal: the text is in the narrative
   and the photo sits under it in "Captured blotter photos". Check image
   against text, then keep writing the report.

## 4. Leaving and losing

- **Sign out on the phone** (the logout icon): revokes exactly the token the
  phone holds. The portal inventory shows it ended.
- **Forgotten PIN**: run setup again. There is no back door.
- **Lost phone**: on the portal, revoke that phone's token. A revoked token
  answers `device_token_invalid` and the app must be set up again.
- **Finalized reports are locked** for everyone but Admin — captures too, so
  a filed page cannot gain a photo after it is closed.

## 5. Security notes

- Same LAN rules as the portal: trusted network only, plain HTTP on the LAN
  (see LAN_SETUP.md §10 for the HTTPS hardening), never forward port 8099,
  never expose MySQL.
- Tokens live a year, are hashed at rest on the server, and are shown once —
  at issue. There is deliberately no endpoint that returns one again.
- Tokens cannot mint tokens: issue and inventory demand the cookie session.
  Only the phone's own sign-out accepts the token itself.
