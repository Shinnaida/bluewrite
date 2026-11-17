# Troubleshooting — failures we have actually hit

Written from the 2026-11-17 → 18 session (station server + Filipino blotter
phone app). Every entry is a failure that really happened, what caused it, how
it was proved, and what fixed it. Kept in symptom order so the next person
starts where the frustration starts.

Contents

1. [Phone: empty "Recognized blotter text" / "no readable text"](#1-phone-empty-recognized-blotter-text)
2. [Filing succeeds but the draft never appears in Phone files](#2-filing-succeeds-but-never-appears-in-phone-files)
3. [Could not file the draft. type 'List<dynamic>' is not a subtype of ...](#3-could-not-file-the-draft-type-error)
4. [Building and installing the phone app on this Windows PC](#4-building-and-installing-the-phone-app)
5. [ML Kit on-device OCR — tried, failed, reverted](#5-ml-kit-on-device-ocr--tried-failed-reverted)
6. [Phone does not open when the station Wi-Fi connects](#6-phone-does-not-open-on-the-station-wi-fi)
7. [Portal: the "Possible gaps" advisory panel](#7-portal-the-possible-gaps-advisory-panel)
8. [Session log: what shipped, which version](#8-session-log-2026-11-17--18)
9. [Diagnostic cheat sheet](#9-diagnostic-cheat-sheet)

---

## 1. Phone: empty "Recognized blotter text"

**Symptom.** After a capture, the review screen shows an empty box, "0 words to
check", and *"The photo held no readable text — try a sharper, straighter shot
of the blotter page."* The photo is perfectly legible.

**What is actually happening.** `POST /api/v1/ocr/read` answers
`200 {"configured": false}` — **20 bytes** — and the app treats that as "read it
by hand". The station tries, in order:

1. Gemini vision (`NarrativeService::transcribePhoto`, the only AI provider);
2. `imagetotext.info` — only if `IMAGETOTEXT_API_KEY` is set (it usually is not).

Both silent ⇒ `configured:false` ⇒ the phone has nothing. **The phone does no
OCR of its own** (see §5 for why we stopped trying to add it).

**Three causes, in the order they have bitten us**

| Cause | Fingerprint |
|---|---|
| Station's Gemini key is over its **project monthly spend cap** (HTTP 429 `RESOURCE_EXHAUSTED`) | No new row in `audit_logs`; `/ocr/read` is `200` and 20 bytes |
| Station unreachable (LAN down, Apache stopped) | App says it cannot reach the station; no HTTP hit in the access log |
| Photo genuinely unreadable / page cut off | An `ocr.read` audit row exists with a small `characters:` count |

**Diagnose it in three commands** (all from the project root)

```bash
# a) Did the request reach the station, and what did it answer?
grep -a "ocr/read" bluewrite/storage/logs/apache-access.log | tail -5
#    ... 200 20      → configured:false, i.e. no engine answered
#    ... 502 1xx     → the upstream reader answered but refused

# b) What did the station itself think it read?
#    (audit row = an engine DID answer; the count is the characters returned)
php -r '$p=new PDO("mysql:host=127.0.0.1;dbname=bluewrite;charset=utf8mb4","bluewrite","<db password>");
foreach($p->query("select created_at, detail from audit_logs where action=\"ocr.read\" order by id desc limit 10")->fetchAll(PDO::FETCH_ASSOC) as $r) echo $r["created_at"]."  ".$r["detail"]."\n";'
#    → "engine: gemini, characters: 2673"  = healthy read
#    → only "engine: gemini, characters: 0..120" = the model answered but refused the page

# c) Is the KEY itself alive? (reads the key from config, never prints it)
php -r '$c=require "bluewrite/app/config/ai.php"; $g=$c["gemini"]??$c;
$k=(string)(getenv("GEMINI_API_KEY") ?: ($g["api_key"]??"")); $m=$g["model"]??"gemini-3.6-flash";
$ch=curl_init("https://generativelanguage.googleapis.com/v1beta/models/".rawurlencode($m).":generateContent");
curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_TIMEOUT=>45,CURLOPT_HTTPHEADER=>["Content-Type: application/json","x-goog-api-key: ".$k],CURLOPT_POST=>1,CURLOPT_POSTFIELDS=>json_encode(["contents"=>[["parts"=>[["text"=>"Reply OK"]]]])]);
$r=curl_exec($ch); echo curl_getinfo($ch,CURLINFO_HTTP_CODE)." ".substr($r,0,220)."\n";'
```

**The cap error looks like this** and is project-wide, not model-wide:

```
429 RESOURCE_EXHAUSTED
"Your project has exceeded its monthly spending cap.
 Please go to AI Studio at https://ai.studio/spend to manage your project spend cap."
```

Every model on that key returns the same 429 (`gemini-3.6-flash`,
`gemini-3.5-flash`, `gemini-flash-lite-latest`, `gemini-2.5-flash-lite`,
`gemini-2.5-flash`) — **do not waste time model-shopping**, and don't mint a
second key in the same project: the cap is per **project**.

**Fixes, in order of preference**

1. **Raise the project's monthly spend cap** — https://ai.studio.google.com/spend
   (the **Spend** page, not `/billing`) → *Monthly spend cap* → *Edit spend cap*.
   Takes up to ~10 minutes to take effect (billing data lag, per Google's own
   docs). The billing page's prepaid balance is irrelevant while the cap is hit.
2. **A key from another project that has headroom** — put it in
   `bluewrite/app/config/ai.php` (`'gemini' => ['api_key' => …]`, git-ignored).
   No restart needed; PHP re-reads it every request.
3. **A key from a project with no billing** — runs on the free tier: no spend
   cap, but rate-limited (RPD resets midnight Pacific) and free-tier traffic may
   be used to improve Google's products. Acceptable stopgap, not for blotter
   pages carrying names and allegations.

**Facts that save an hour next time**

- **A Google AI Pro / Ultra subscription does NOT fund the API.** Google's own
  [AI plans](https://aistudio.google.com/docs/google-ai-plans) page: benefits
  "apply only within the Google AI Studio web interface … Google bills and
  manages Gemini API usage (such as using API keys or external applications)
  separately." A Pro subscription does not lift an API spend cap.
- The per-project cap lives on **Spend**; the **$250 Tier 1** figure on the
  Billing page is the billing-account tier cap (Tier 2 = $2,000, Tier 3 =
  $20,000+) and pauses **all** projects until the 1st of the month.
- Prepay accounts that run to **$0 balance** fail with a different message —
  turn on auto-reload or top up before a duty shift.
- Rotate any key that was pasted into chat or logs: AI Studio → API keys →
  create new, delete the old.

**Verify the fix end to end** (not just the raw API) — this runs the station's
own transcription function on a stored capture:

```bash
php -r '
$root="C:/path/to/BLUEWRITE/bluewrite/app";
foreach(["core","ai"] as $d) foreach(glob("$root/$d/*.php") as $f){ if(basename($f)==="cache_cli.php") continue; require_once $f; }
$bytes=file_get_contents("C:/path/to/BLUEWRITE/bluewrite/storage/report_captures/<capture>.jpg");
$t=microtime(true); $txt=(new App\Ai\NarrativeService())->transcribePhoto($bytes,"image/jpeg");
printf("chars=%d secs=%.1f\n", mb_strlen($txt), microtime(true)-$t); echo substr($txt,0,200);'
# healthy: chars=1377 secs=4.4   + recognisable blotter text
```

---

## 2. Filing succeeds but never appears in Phone files

**Symptom.** A capture files cleanly ("Draft #N is waiting…"), the draft exists
on the portal, but the Phone files folder never lists it as *Capture N*.

**Two portal rules decide that**, both in `src/pages/Reports.jsx`:

1. `captureEdited()` — a capture is hidden from Phone files when the first ~80
   characters of its text already appear in the draft's **narrative**. The
   portal reads that as "already inserted".
2. The arrival banner ("Phone capture filed — draft #N is waiting") additionally
   needs `updated_at == created_at`; opening the draft on the web bumps
   `updated_at` and the filing stops looking fresh.

**Consequence for the phone flow.** The app files the reviewed text **into the
narrative** (owner decision, 2026-11-17, see §8) *and* sends it as the capture's
`ocr_text`. So the new capture is treated as inserted and does not appear in
Phone files. That is expected with this filing shape, not a bug.

**If the officer wants the "Capture N / Draft #N" listing** the filing must be
made with an **empty narrative** and the text carried by the capture only —
`review_screen.dart`, the `'narrative'` field in the draft payload. `docs/MOBILE_APP.md`
§3 documents that shape. Capture 45 / Draft #497 (`reports.id = 497`,
`report_captures.id = 45`) is a live example of the listing.

**Check what actually landed:**

```sql
SELECT id, incident_type, location, status, CHAR_LENGTH(narrative) AS narr,
       created_at, updated_at
  FROM reports ORDER BY id DESC LIMIT 5;

SELECT id, report_id, engine, CHAR_LENGTH(ocr_text) AS ocr, reviewed_at
  FROM report_captures ORDER BY id DESC LIMIT 5;
```

`caps=0` on a filed draft means the photo upload was refused (the app keeps the
draft and shows "The photo could not be attached"). A capture with
`ocr_text` = the narrative text is exactly the case in rule 1.

---

## 3. "Could not file the draft. type error"

**Exact words.**

```
Could not file the draft. type 'List<dynamic>' is not a subtype of type
'Map<String, dynamic>?' in type cast
```

**Cause.** `blotter_filing.dart` read the AI account read with hard casts
(`as Map?`), and the model legitimately answers a **list** for fields such as
`type_specific` / injuries. One list-shaped answer killed the whole filing.

**Fix (shipped 0.1.12).** Tolerant coercion — `_mapOf()` accepts a Map, a list
of pairs, or anything coercible, and yields `{}` instead of throwing; every
field read in `blotterFilingFields` goes through it. `_send()` in
`review_screen.dart` (0.1.11) also catches **all** errors (not just
`PortalError`) and prints them on screen, because a silent button looked dead.

**Rule for future code:** never cast the model's answer. Coerce it.

---

## 4. Building and installing the phone app

### The build must not run inside the repo path

The Windows account is `C:\Users\Shaine Jayme\…` — **the space breaks
`flutter build apk`** in that path. Mirror to `C:\bw-app` and build there:

```bash
robocopy "C:\Users\Shaine Jayme\Desktop\BLUEWRITE\blotter-app" "C:\bw-app" \
  /MIR /XD build .dart_tool /NFL /NDL /NJH /NJS /NP
cd /c/bw-app && /c/Users/Shaine\ Jayme/flutter/bin/flutter build apk --release
# output: C:\bw-app\build\app\outputs\flutter-apk\app-release.apk
```

Copy the APK (and `pubspec.lock`) back into `blotter-app/` afterwards. A release
build takes ~7 minutes on this machine and exceeds a 5-minute command budget —
run it with a background shell and poll the log (`Built build\app\outputs…`,
`FAILURE: Build failed with an exception`).

`flutter analyze` runs fine inside the repo and is the cheap pre-build gate.
Known-benign output: `curly_braces_in_flow_control_structures` infos.

### Wireless ADB, without asking for the port again

```bash
export MSYS_NO_PATHCONV=1
export PATH="$PATH:/c/Users/Shaine Jayme/AppData/Local/Android/Sdk/platform-tools"
adb tcpip 5555                      # once per boot: pins the port
adb connect 192.168.0.104:5555      # phone's Wi-Fi IP
adb -s 192.168.0.104:5555 install --no-streaming -r <apk>
adb -s 192.168.0.104:5555 shell dumpsys package com.nagapolice.blotter_capture | grep versionName
adb -s 192.168.0.104:5555 shell am start -n com.nagapolice.blotter_capture/.MainActivity
```

- The port rotates when wireless debugging is toggled; `adb tcpip 5555` ends
  that. If the device drops when the phone sleeps, `adb connect` again.
- `--no-streaming` avoids the install failing mid-push on this connection.
- USB is unreliable here: Windows reports *Unknown USB Device (Device Descriptor
  Request Failed)* / WPD 2022.
- **The app is PIN-locked.** The assistant cannot reach the Capture or Review
  screens; screen-level confirmation has to come from the officer. State that
  plainly instead of claiming a flow was tested.

---

## 5. ML Kit on-device OCR — tried, failed, reverted

**Why it was tried.** When the station's key is out of quota (§1) the phone had
no fallback at all, so a readable page produced "no readable text".

**What was built (0.1.15).** `google_mlkit_text_recognition: ^0.16.0` (resolved
by `flutter pub add`; 1.x needs Flutter ≥ 3.44 and this project is on 3.35) plus
`lib/ocr/on_device_reader.dart`: upright read first, then 90°/180°/270° passes
with `package:image`, the pass with the most ink wins.

**Why it was reverted.** `flutter build apk --release` died in Gradle:

```
Execution failed for task ':app:minifyReleaseWithR8'.
> A failure occurred while executing com.android.build.gradle.internal.tasks.R8Task$R8Runnable
   > Compilation failed to complete
```

R8 needs keep rules for ML Kit's optional/reflectively-loaded classes. If this
is attempted again: add the keep rules, test with `flutter build apk --debug`
first, and budget for the APK growing by the bundled model.

**Where the app stands.** 0.1.16 is the 0.1.12 behaviour (station Gemini read,
reviewed text into the narrative) with no local OCR. A different, working key is
the supported fix for an empty read.

---

## 6. Phone does not open on the station Wi-Fi

**Why it is native.** Flutter/Dart cannot observe Wi-Fi while the app is closed,
so this lives in Kotlin: `StationWatcher.kt` (foreground service) +
`StationBootReceiver` + manifest permissions (`ACCESS_NETWORK_STATE`,
`FOREGROUND_SERVICE`, boot receiver).

How it decides:

1. `ConnectivityManager.NetworkCallback` for a Wi-Fi network;
2. probe `GET /api/v1/station` — a station answers 200 **or 401** with JSON;
3. one open per network join (dedupe on `network.networkHandle`, reset on
   `onLost`) — the old flat 45-second debounce is gone;
4. probe retries at 0 / 3 / 9 / 21 s for the DHCP race;
5. `startActivity` to `MainActivity` — allowed in the background only because
   the **`SYSTEM_ALERT_WINDOW` appop is granted** (`adb shell appops set
   com.nagapolice.blotter_capture SYSTEM_ALERT_WINDOW allow`). Revoke that and
   auto-open silently stops.

**No notification.** 0.1.6 removed the "station server found" notification and
`USE_FULL_SCREEN_INTENT`; the overlay grant makes a notification unnecessary.
`StationWatch.clearFoundNotification()` clears any leftover on launch. Verify
nothing lingers with `adb shell dumpsys notification | grep -i bluewrite`
(channel `bluewrite_watch`, only the service's own id remains).

---

## 7. Portal: the "Possible gaps" advisory panel

- **The live panel is `src/components/ai/AiNarrativePanel.jsx`** (imported by
  `src/pages/Reports.jsx`). `src/components/AiNarrativePanel.jsx`,
  `src/components/Reports.jsx` and `src/pages/Reports.jsx`'s flat twin are
  **stale** — editing them changes nothing.
- 2026-11-17: the whole *Possible gaps (advisory)* list was removed on request
  (title, "Tap a card to stamp…" hint, count chip, "Worth a look"/"Note" cards).
- What was put back and stays: **only the red closing-line warning** — a
  *Missing closing line* block with up to two red *Missing line* cards for
  **Recorded by** and **Requested by**. Those two are `severity: 'error'` in
  `src/lib/closingLines.js` on purpose: a certification with no recorder or no
  requester must not go out. Tapping a card stamps the line (with its `____`
  blank) onto the paper and the input under it types the name into the
  narrative. Both lines present ⇒ no block at all.
- The panel's selectors are `closingGaps` (filtered over the existing
  `gapList`), the wrapper condition includes `closingGaps.length > 0`, and the
  cards reuse `.gap-panel` / `.gap-link--error` (CSS untouched).
- **Build and verify:** the portal is Vite, served from `public/`

  ```bash
  cd bluewrite && node node_modules/vite/bin/vite.js build     # ~20 s
  grep -c "Missing closing line" public/assets/index-*.js      # 1 in the referenced chunk
  grep -o "assets/index-[A-Za-z0-9_-]*\.js" public/index.html  # which chunk the browser loads
  ```

  A dev server on `localhost:5180` hot-reloads the source; the Apache-served
  portal needs the build. A failed build leaves `public/` untouched (the write
  stage is last), but the build also copies `public-assets/api.php` back in — do
  not delete that file.

---

## 8. Session log, 2026-11-17 → 18

| Version | What changed |
|---|---|
| 0.1.4 | Station Wi-Fi watcher: foreground service, boot receiver, probe + one open per join |
| 0.1.6 | "Station server found" notification removed, `USE_FULL_SCREEN_INTENT` dropped |
| 0.1.7 | Camera frame painter + "fit the page inside the frame" pill removed |
| 0.1.8 | Tray caption line removed; header became logo + "BlueWrite" |
| 0.1.9 | Edge-to-edge preview (`BoxFit.cover` in a `ClipRect`) — the side bars were `AspectRatio` letterboxing |
| 0.1.10 | Title reverted to "Capture the blotter" |
| 0.1.11 | "Apply certification format" button and "Place of incident" field removed; `_send` catches every error; capture upload made non-fatal; blank place falls back to `'To be identified'` because `ReportsController::store()` hard-requires `location` |
| 0.1.12 | `_mapOf()` tolerant coercion — the `List<dynamic>` crash (§3) |
| 0.1.13 | Draft filed with an **empty** narrative (Phone files shape) |
| 0.1.14 | Reverted 0.1.13 on request: reviewed text + certification format back in the narrative |
| 0.1.15 | ML Kit on-device reader — **build failed at R8, never installed** (§5) |
| 0.1.16 | Reverted 0.1.15; app is behaviourally 0.1.12 (+ version bump so it installs over 0.1.14). **Installed.** |

Same session, station side: the Gemini key was replaced after the monthly spend
cap 429 (§1); `bluewrite/app/config/ai.php` now holds the working key and is
git-ignored.

---

## 9. Diagnostic cheat sheet

```bash
# --- station ---
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.0.107:8099/api/v1/station   # 401 = alive

# --- database (local only) ---
php -r '$p=new PDO("mysql:host=127.0.0.1;dbname=bluewrite;charset=utf8mb4","bluewrite","<db password>");
foreach($p->query("select id,incident_type,location,status,created_at from reports order by id desc limit 5")->fetchAll(PDO::FETCH_ASSOC) as $r) print_r($r);'

# --- logs ---
tail -50 bluewrite/storage/logs/apache-error.log
grep -a "ocr/read" bluewrite/storage/logs/apache-access.log | tail -10

# --- phone ---
adb -s 192.168.0.104:5555 shell dumpsys package com.nagapolice.blotter_capture | grep -E "versionName"
adb -s 192.168.0.104:5555 shell dumpsys notification | grep -i bluewrite
adb -s 192.168.0.104:5555 shell appops get com.nagapolice.blotter_capture SYSTEM_ALERT_WINDOW

# --- portal ---
cd bluewrite && node node_modules/vite/bin/vite.js build
```

**Local coordinates used throughout:** station API on this PC at
`http://192.168.0.107:8099`, database `bluewrite` / user `bluewrite` (decide the
password per machine, never commit it), phone `192.168.0.104:5555`, app id
`com.nagapolice.blotter_capture`.
