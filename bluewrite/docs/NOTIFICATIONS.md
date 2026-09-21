# The notification bell

**Status: ADOPTED.** This is BlueWrite's notification surface, not an
experiment, and it is expected to be put to real use: the bell, the feed it
opens, the count on the tab, and the endpoints and migration behind them are all
part of the system now. Keep it working as the rest of the app grows — a new
kind of act worth telling an officer about belongs in this feed rather than in a
second one.

The one thing still to do on each database:

```bash
mysql -u root -p bluewrite < migrations/011_notifications_seen_at.sql
```

Until that runs, `GET /notifications` answers 500 on that database. (The test
harness replays every migration, so the suite is unaffected — see
`tests/BaseApiTestCase.php`.)

What is *temporary* is only the SAMPLE DATA: `src/mock-notifications.js`, kept
on purpose so the panel can be demonstrated before real reviews exist — see the
end of this document for what it is and how to take it out.

## What it is

A bell at the right end of the top bar, beside the profile control, that reports
what has happened **to the reports the signed-in account recorded**:

- **a translation review** — another officer verified or disputed the report
  (with the dispute's own note, because a dispute must say what differs);
- **a finalization, an archive or a restore** performed by somebody else.

**Closing** the panel marks what was shown as read (see the filters below on why
it is not opening). The badge then clears until the next event.

It appears for **every role**, because the feed is scoped to the session's own
reports — an admin reads their own here too. It is not a message system: nothing
is emailed, pushed, or announced anywhere else, there is no cross-user view, and
there is no way to send somebody a notification.

## There is no events table, on purpose

Both event kinds are already stored permanently by the feature that performed
them:

| Event | Stored in | Written by |
| --- | --- | --- |
| verified / disputed | `report_verifications` (migration 009) | `VerificationController::store` |
| finalized / archived / restored | `report_history` (migration 001) | `ReportsController::snapshot` |

A second copy of those facts would be a second place for them to disagree with
the report, its History panel and the audit trail. The feed **reads** them.

The only thing the events cannot know is where the officer has read up to, and
that is the whole of migration 011: one nullable timestamp per account.

## What decides an item appears

1. **The report is the officer's own.** `reports.created_by = me`. Reviews of
   somebody else's report are not news to them.
2. **Somebody else performed the act.** `verifier_id <> me`,
   `changed_by <> me`. A bell that reports your own work back to you is noise,
   and the report's History panel is where the whole sequence belongs.
3. **The act is one of the whitelisted ones.** `'Report updated.'` is written on
   **every autosave**, so the raw history table would drown the events that
   matter; only `Finalized`, `Archived` and `Restored` are read, and the
   whitelist matches those notes as prefixes because the finalize note can
   continue with how the narrative was authored or which language it was filed
   in.

Two deliberate asymmetries:

- **An archived report's reviews drop out** of the feed (every read path filters
  `deleted_at IS NULL`, so an item pointing at one would be a dead link).
- **The archive event itself stays**, flagged `report_archived`, and the client
  renders it as a statement rather than a link. A report must not leave the
  working set in silence.

## The row

A feed like this is **scanned, not read**: an officer opens it to answer one
question, "is any of this mine to act on?", and leaves. So every row has a
strict hierarchy and the parts are always in the same order:

```
[dot] [glyph]  Headline                     2h
               BW-0042 · Theft
               | the reviewer's own words
```

| Part | Job |
| --- | --- |
| glyph | says WHAT HAPPENED before a word is read: check, alert, box, restore arrow |
| headline | names the act and the person; has to stand on its own |
| meta | the report it is about, and its type |
| detail | the one thing the row must add: a dispute's own note, clamped to two lines |
| time | relative while that means something, absolute once it stops |

**Unread is said once, in two halves:** a dot in the gutter and a heavier
headline. Not a dot plus a tint plus bold plus a left border, which is four ways
of saying one thing and the usual way a feed starts to look broken. Read rows
are a step quieter rather than greyed out, because the read state is most of the
feed.

**The glyph reads in colour only as a second signal** — the shape has to carry
it, so each act gets a distinct mark and the palette stays at the app's own
`--green-ok` / `--ir-red` / `--ir-blue`. The marks are hand-drawn in the app's
single icon style (24-unit box, 1.8 stroke, no fill) because the app carries no
icon library: eight small marks do not justify a dependency, and a borrowed
family would be the only one in the product.

**Rows are grouped under `Today` / `Yesterday` / `Earlier`**, as a real `<h3>`
heading so a screen reader gets the grouping too. The group is decided by the
**server**, from the database's own calendar — flooring `age_seconds` into 24h
buckets would file an act from 23:00 yesterday under "Today".

**Non-feed states** are built, not left blank: skeleton rows shaped like the
real ones while the first load lands, an empty state that says the work is done,
and the one failure state (see below).

**No per-item actions, on purpose.** The watermark model has no per-item read
state, so "mark as unread" and "archive this notification" have nothing behind
them, and there is no "mark all read" button because dismissing the panel
already is one (below).

## The filters

Three, in the header beside the title: **All**, **Unread**, **Disputes**. They
are client-side over the loaded feed — no endpoint, no server state.

- `all` is the default, and **every open resets to it**: a panel that can be
  reopened onto a feed quietly hiding rows is a panel that lies.
- `unread` is the same rule as the unread dot, not a second copy of it —
  `isUnread()` lives in the lib and both call it, so the filter and the dot
  cannot disagree about what "new" means.
- `disputes` is about the ACT, not about being new, and it **keeps a dispute a
  later review overtook**. The row says so itself ("Superseded by a later
  review."); hiding it would hide an act the officer was notified about.

An empty filtered view says which filter emptied it and offers the way back
("Show all"). An empty feed says the work is done. Neither renders as a blank
box.

### Why the watermark moved to CLOSE

The read watermark is advanced when the panel closes, not when it opens, and the
Unread filter is the reason: marking read on open would erase the unread dots —
and empty the Unread view — in the same click that revealed them, which makes the
filter theatre. So the panel opens with the dots still on, and dismissing it is
what says "I have seen these".

Two consequences, both deliberate:

- a panel left open keeps the badge lit on the bar, and the tab title counting;
- what gets marked is **the newest act that was on screen** — so a filter that
  hid rows does not mark them read. (The watermark is still one timestamp, so an
  older act hidden behind a newer visible one is covered; that is the model's
  documented granularity, not a new limitation.)

The feed is re-read after the mark rather than the badge being adjusted locally:
`unread` is counted by the server over the WHOLE feed while the panel holds one
page of it, so a local subtraction would drift from the number on the bar.

## The watermark

`users.notifications_seen_at`, per **account**, not per browser: the station PCs
are shared workstations, so an officer who reads the bell at one desk must not
find everything unread again at the next one.

`GET /notifications` returns `unread` counted over the **whole** feed — not just
the page it returned, which would under-report exactly when there is most to
report — and closing the panel POSTs **the newest event actually shown**, not
"now". That is what stops an event arriving during the round trip from being
marked read without ever having been displayed. The server stores it only if it
is newer than the value already there, and clamps it to the server clock, so the
watermark can neither move backwards (a stale second tab cannot bring the badge
back) nor sit in the future (which would mute the bell until the clock caught
up).

**Granularity.** Event times are `DATETIME` (whole seconds), so an act recorded
in the *same second* as the newest act already shown reads as seen. That is
deliberate: marking the whole second unread instead would be a phantom badge
every time the panel was opened, in exchange for a sub-second window nobody can
act on.

## The tab title

The same count also goes in front of the browser tab title —
`(3) BlueWrite — Naga City Police Station` — because an officer working in
another tab, or with the window behind something else, is exactly who a badge
*inside* the page cannot reach.

It is written by `NotificationBell`, not by Shell, because the count is already
polled there: a second reader for the title would double the requests to say the
same thing. The title is captured on mount and **restored on unmount**, so
signing out leaves the sign-in screen with its own title rather than a stale
count.

The count is placed first (a browser truncates a tab from the right, so the
count is the part that has to survive a narrow tab) and it is **not capped** at
`9+` the way the badge is: the badge sits in a 34px circle where `9+` is the
honest way to say "more than fits", while a tab title has room for the real
number. `documentTitle()` is idempotent — it strips any prefix it wrote before
applying a new one — so it can never produce `(3) (3) Title`.

## Files

| File | What it is |
| --- | --- |
| `migrations/011_notifications_seen_at.sql` | **new** — `users.notifications_seen_at DATETIME NULL` |
| `migrations/011_notifications_seen_at.down.sql` | **new** — the rollback (loses the watermarks, keeps every event) |
| `app/controllers/NotificationsController.php` | **new** — the feed query joins the two sources with `UNION ALL`; the watermark read and the forward-only write |
| `api/index.php` | `GET /notifications`, `POST /notifications/seen` (after the auth gate, so CSRF applies to the POST) |
| `src/lib/notifications.js` | **new** — every sentence the bell says, the age arithmetic, and `documentTitle()`; kept pure so the wording can be tested |
| `src/components/NotificationBell.jsx` | **new** — the trigger, the badge, the panel, the polling, and the tab title |
| `src/components/AppTopBar.jsx` | renders the bell beside the profile control |
| `src/components/Shell.jsx` | hands the bell the route to open a report |
| `src/incident-report.css` | section **7b**, the bell and its panel |
| `tests/NotificationsTest.php` | **new** — the feed's rules and the watermark over HTTP |
| `tests/rules/notifications.test.mjs` | **new** — the wording, the ages, and that nothing overclaims |
| `src/mock-notifications.js` | **temporary** — sample items for looking at the panel; delete when done |

`age_seconds` is computed by the **server** and sent instead of only a
timestamp: a `YYYY-MM-DD HH:MM:SS` with no offset is read as local time by most
engines, so "3h ago" would differ per workstation. For the same reason the panel
compares `happened_at` to the watermark as *text* — both are the same form from
the same clock, which orders correctly and needs no parsing at all.

Three fields exist for the row's time and its day heading, and all three are
server-side for that one reason:

| Field | Why not the browser |
| --- | --- |
| `age_seconds` | needs the clock that recorded the event |
| `happened_label` | the absolute fallback ("Aug 10, 2026"); formatted here so the panel never prints the database's `Y-m-d H:i:s`, and single-digit days are not left space-padded by MySQL's `%e` |
| `day_group` | `today` / `yesterday` / `earlier`, from the database's calendar |

## The sample data (the only temporary part)

`src/mock-notifications.js` is **sample data, not a prototype**: six items, in
the server's own payload shape and using the server's own note strings, so the
panel, the badge, the tab count and the filters can be demonstrated before real
reviews exist. It holds its state in memory, so the badge comes back on reload —
otherwise the panel could be seen once per session.

It is kept deliberately, and marked so nobody sweeps it away as scaffolding. The
thing it stands in for is the real feed, which is already built and working
(`GET /notifications`); nothing about the bell depends on it beyond the two
marked call sites in `NotificationBell.jsx`, and setting
`MOCK_FEED_ENABLED = false` switches to the real API without deleting anything.

**To remove it when the real feed is in use:** remove the file, then remove the
import of
`MOCK_FEED_ENABLED` / `mockFeed` / `mockMarkSeen` and the two `MOCK_FEED_ENABLED`
ternaries in `NotificationBell.jsx` (each is marked `TEMPORARY MOCK`), leaving
the plain `api()` calls. That is the whole of it: no route, no migration, no
database row, no CSS. Setting `MOCK_FEED_ENABLED = false` runs against the real
API without deleting anything.

Clicking a sample row opens `report_id` for real, so with placeholder ids a
click can land on "Report not found" — or on an unrelated real report holding
that id. That is the mock's, not the bell's, doing.

## Applying it

```bash
mysql -u root -p bluewrite < migrations/011_notifications_seen_at.sql
```

Rollback: `migrations/011_notifications_seen_at.down.sql`. It loses how far each
account had read; no event is lost, because the events were never here.

The bell degrades quietly if the feed cannot be read: no badge, no error. A
connection problem belongs to the workspace-wide banner that Shell already
shows, not to a second notice over a report somebody is writing.
