# Presence — the chatheads

**Status: ADOPTED.** The rail down the right edge, the heartbeat behind it, and
the officer photographs it draws are part of the system now, not an experiment.
A new face belongs on this rail rather than in a second "who's online" list.

The one thing still to do on each database:

```bash
mysql -u root -p bluewrite < migrations/014_presence_and_avatars.sql
```

Until that runs, `POST /presence/heartbeat` answers 500 on that database (it
writes `users.last_seen_at`, which does not exist yet) and the rail simply never
appears — it treats an unreadable roster the same way the bell treats an
unreadable feed. (The test harness replays every migration, so the suite is
unaffected — see `tests/BaseApiTestCase.php`.)

Migration 014 is also what a photograph needs: it adds the `users` columns the
files are recorded in. The files themselves live in `storage/avatars/`, made on
demand, **git-ignored** — a photograph is user data, not source.

## What it is

Every account that has said "still here" in the last **two minutes**, as a column
of circles in the **lower right corner** of whatever screen is open. It hangs
upward from the corner: the workspace's own content is top-left heavy (headers,
tables, the dashboard grid), and the corner is the one part of the edge that is
usually empty. The row nearest the corner is also the one that never moves as
colleagues come and go, because the bottom edge is the anchor and the names read
down to it.

```
             ┌────┐   ┌────┐
             │ +7 │   │ PV │  ← the overflow chip, and whoever is next
             └────┘   └────┘   (a second column runs LEFT from the corner)
                      ┌────┐
                      │ ER │  ← everybody but YOU (see below)
                      └────┘
                      ┌────┐
                      │ JD │  ← the face: a photograph, or the initials
                      └───●┘  ← the online dot (bottom-right of the circle)
                                      ↑ the lower right corner
```

The tooltip, and the circle's accessible name — the same sentence, because a
circle of two letters announces nothing on its own:

```
Juan Dela Cruz — Senior Officer · active 2m ago
```

- **The face** is the officer's photograph, or their initials when there is none
  (`lib/profile.js` → `Avatar.jsx`, the same pair used by the top bar and the
  profile panel). **What it is painted with belongs to that component too**: initials
  sit on one of six gradients chosen from the account id (`data-face`), so the same
  officer is the same colour in this rail, in the top bar, in the message list and on
  their own profile. The rail used to paint its faces itself, in `--ir-navy`, which is
  how one officer ended up navy here and a different navy in the bar's own menu — and
  every pair is measured so white initials clear 4.5:1 on both ends of every gradient,
  in both themes, because that ratio *is* the legibility of a face.
- **The dot** is the only mark that means anything on its own. It is drawn
  bottom-right and ringed in the panel's own colour so it reads as attached to
  the face rather than as a hole in it.
- **The unread mark**, when there is one, is drawn top-right — opposite the dot,
  because the two facts are unrelated: one says the officer is at a desk, the other
  says they have said something nobody has read. Red, because it is the only mark on
  this rail that is asking for something. Capped at `9+`.
- **The name is not drawn.** A column of names down the workspace edge is a
  sidebar, and this is not one. The name is in the tooltip and in the accessible
  name, and in the head of the conversation the circle opens.
- **Your own account is not drawn at all.** The rail answers "who else is on".

**Clicking a circle opens that colleague's conversation** in the docked messages
panel — one click, and the caret is already in the composer. There is no officer
card in between: there used to be, and it was two clicks to reach the thing the
circle exists for. The thread head it leads to carries the same identity facts
(name, role, badge), the tooltip still carries the two clocks, and the one thing the
card had that nothing else does — how long ago they moved — is a value that goes
stale the instant it is drawn. See `docs/MESSAGES.md`.

The rail therefore holds **no state at all** for a circle: no open/closed, no
dismissal listeners, no `aria-expanded`, nothing to drift out of step with what is on
screen. Pressing a face IS opening the conversation.

### Everybody but you

`withoutSelf()` in `lib/presence.js` — and it is a **drawing** rule, not a presence
one. Your account still heartbeats, and is still on everybody else's rail. The
filter is applied to what *this* screen paints and to nothing else, because the
server's roster is a fact about the station ("everybody seen in the window") that
the next feature to want it should not have to reconstruct.

The rail exists to answer "who might I be looking for", and your own face is noise
with a cost: a circle that can never be acted on — there is nobody to look up and
nothing to open — sitting in the slot nearest the corner, taking it from somebody
who might be there. You already know where you are: your face is in the top bar,
one click from the profile panel.

Two consequences worth knowing:

- **An officer who is the only one signed in sees no rail at all.** The filter runs
  *before* the empty check, so it draws nothing rather than handing that officer
  their own initials back. That is the common case on a quiet night, and it is the
  case that used to look wrong.
- **Nothing is dropped when self cannot be identified.** An entry only matches on a
  real id, so a session with no id filters nobody rather than filtering by
  accident. Failing toward showing a colleague is the right way round for a roster.

The count in the rail's accessible name is the count of **colleagues**
("2 colleagues online"), not of accounts — because it is a count of what is on
screen, and self is not.

## Why "online" is a window, not a flag

`users.last_seen_at` is a **timestamp**, and "online" is a predicate over it:
seen inside the last 120 seconds. It is deliberately not an `is_online` boolean.

A flag has to be cleared by something, and the only thing that could clear it is
a browser that has already gone away. Close the lid, kill the tab, cut the Wi-Fi,
and the station shows a colleague who is not there for the rest of the day. A
window expires on its own, and its failure mode is the honest one — a chathead
that fades a minute late — rather than a permanent lie.

It is also **not the session table**, on purpose. PHP's sessions live in files on
the server with a 30-minute idle timeout, and reading them to draw a roster would
mean parsing the session store of every other request: a coupling that breaks the
first time the deployment moves to Redis or two app servers. One column on the
account is portable, and the account is what the roster is about.

The consequence worth knowing: **the heartbeat and the session idle timeout are
unrelated.** A tab left open overnight is signed out by the session and off the
roster by the window, at different times, for different reasons.

## The heartbeat

```http
POST /presence/heartbeat
  →  { window_seconds, heartbeat_seconds, online[], message_unread[] }
```

**One route, not two.** A roster read and a "still here" write happen on the same
beat, from the same client, and return the same list. Two endpoints would mean two
requests every thirty seconds per open workspace, and — worse — a client that
could read the roster **without ever reporting itself**, so the station would show
a crowd of officers who are all watching and never seen.

**The request body is ignored entirely.** The account comes from the *session* and
the timestamp from the *database's own clock* (`UPDATE users SET last_seen_at =
NOW() WHERE id = :id`). There is nothing a caller can say that would make the
answer more true, so there is nothing a caller can say. Any signed-in role may
call it: presence is not a privilege, and everybody on the roster is somebody the
same list already shows by name.

**Failure is silent.** This is chrome. A rail that cannot be read simply is not
there, exactly as the bell shows no badge when the feed cannot be read. Reporting
a connection problem belongs to the screens holding real work — an officer with a
half-written report does not need a second, decorative complaint about the LAN.

**It also carries the unread messages**, as `message_unread`: a list of
`{ sender_id, count }` pairs, one per colleague who has written something nobody
has read. They ride this beat because they mark the same faces from the same
request — a second poll would be a second answer to "who has sent me something".
Unlike the roster they are **not aged**: an entry is waiting until somebody reads
it. See `docs/MESSAGES.md` for the reader and why the wire format is a list of
pairs rather than an id-keyed object.

### The numbers, and which side owns each

| Number | Value | Owner | What it decides |
| --- | --- | --- | --- |
| `ONLINE_WINDOW_SECONDS` | 120 | server | how long after the last beat an account stops being online |
| `HEARTBEAT_SECONDS` | 30 | server | the beat the client is expected to keep, echoed on every response |
| `HEARTBEAT_MS` | 30000 | client | how often the open workspace actually beats |
| `STALE_GRACE_SECONDS` | 30 | client | how long a **failed** beat is tolerated before the client starts dropping people |
| `TICK_MS` | 15000 | client | how often the held roster is re-aged and the "active 2m ago" labels re-read |
| `RAIL_SLOTS` | 5 | client | how many circles are drawn before the `+N` chip takes over |

Two minutes against a thirty-second beat: **four missed beats before a colleague's
chathead goes dark**. Tighter (one beat) makes the roster flicker whenever a poll
is slow on a busy Wi-Fi; wider tells the station somebody is at their desk a
minute after they have left.

The window and the beat are stated on **every response** rather than hard-coded in
the browser, so the client's "fade a stale roster out" rule has real numbers to
use instead of its own guess at how long the server waits.

## Ageing: the one thing the client owns

The server says *who is online*. The client owns the **ageing of the list it is
holding** — see `src/lib/presence.js`.

A roster is a snapshot of a moving thing. It arrives every thirty seconds, and
when a beat fails — the server restarted, the Wi-Fi dropped — the newest list the
tab has is the only one it will get for a while. Left alone it would keep a
colleague's face on screen for as long as the tab stays open, which is exactly
the failure the window exists to prevent. So the server sends `idle_seconds` per
account and `window_seconds` for the window, and `ageRoster()` turns those plus
the time since the last beat into "still there" or "gone":

```
still there  while  idle_seconds + seconds_since_last_beat  ≤  window + grace
```

Three rules in there are worth knowing, because each of them fails in the
direction that hides a person:

- **An entry with no age at all is kept.** The server put it on the roster;
  dropping a colleague because a field is missing would be the wrong way to be
  wrong. (Checked *before* the number conversion, because `Number(null)` is `0` —
  a missing age must not quietly become "seen at the beginning of time".)
- **A row that is not an object at all is dropped.** It is not a colleague with a
  missing field, it is junk in the payload.
- **Negative ages clamp to zero.** `TIMESTAMPDIFF` can return a fraction ahead of
  `NOW()`; the server clamps too, so neither side prints "seen -1 seconds ago".

**The beat stops while the tab is hidden**, and that is a decision rather than an
optimisation: presence here means *at a keyboard*, which is what the station wants
to know. A minimised window on a locked workstation should go dark, not sit lit
all night. Coming back to the tab beats **immediately** (`visibilitychange`), so
the rail is correct on the first frame after it is looked at again.

## The roster

```php
WHERE u.status = 'active'
  AND u.last_seen_at IS NOT NULL
  AND u.last_seen_at >= NOW() - INTERVAL 120 SECOND
ORDER BY u.full_name
```

**Ordered by NAME, not by who was seen last.** The circles sit in a column and are
read as a set. Ordering by recency would re-shuffle that column every time a
colleague moved their mouse, and the one thing a reader learns from a chathead —
where it lives on the screen — would be the one thing that changes.

**Inactive accounts are excluded.** A deactivated officer has no way to heartbeat,
so they would never appear anyway; the condition is there so the roster *states*
the rule instead of relying on it.

**The session's own account IS on this list**, and the server does not filter it
out. This is the roster of the station, not of one screen: `withoutSelf()` hides
your own circle at the point of drawing it (above), so the payload stays the fact
and the rendering stays the opinion.

An entry is more than a name, and every field is there for a reason:

| Field | Why the server sends it |
| --- | --- |
| `idle_seconds` | needs the clock that stamped the row — a station PC's clock is whatever somebody set it to |
| `login_age_seconds` | the "signed in 2h ago" clause of the tooltip, as an **age** rather than a timestamp, so the client needs no clock and no parsing |
| `photo_url` | the `v=` cache key comes from `photo_updated_at`; a client that assembled the URL itself would have to be handed the version separately, and the copy that goes stale is the one showing a colleague's old photograph |
| `role`, `badge_number` | the tooltip's second clause, and the thread head's second line; already in the row the roster reads |
| `username` | **served, and drawn by nothing.** It is the account's sign-in name rather than the person, so it belongs on an admin screen, not on a face; it is in the payload because it is one column of the row the query already reads |

## How the rail behaves

Every rule below is in `src/styles.css` under **Presence rail (chatheads)**, and
several exist because the obvious version is broken.

**It shifts clear of the docked panels**, using the *same width variables they
reserve space with* (`--profile-panel-w`, `--ai-panel-w`), so the two cannot
disagree about where the right edge is and end up with a circle sitting on a form:

| Body class | the corner's `right` |
| --- | --- |
| (neither panel open) | `18px` |
| `profile-panel-open` | `calc(18px + var(--profile-panel-w))` |
| `ai-panel-open` | `calc(18px + min(var(--ai-panel-w, 420px), 92vw))` |
| profile + AI | the two widths summed |

**The corner is `.dash-dock`, not the rail.** It holds the rail *and* the chatbox as one
flex row with the rail last, so the box is always exactly to the rail's left — including
when the rail wraps into a second column, which any arithmetic on the rail's width would
get wrong. What shifts with a docked panel is the whole corner; what gets dropped on a
narrow screen is the **rail alone**, because the box is where somebody is writing.

**Below 900px a dock is a drawer over the workspace, not a reflow**, so a rail
shifted left of one would sit on top of the form it just uncovered — there it is
`display: none`. **Below 720px** it goes entirely: a phone has no right edge to
give away, and the rail would cover the workspace it is reporting on. It is also
hidden in `@media print`.

**No `overflow` and no `transform` on the rail**, and both absences are still
deliberate even though the reason they were first written down is gone:

- **`overflow`** would turn the cap into a scrollbar. The rail draws five circles and
a `+N` chip precisely so it never has to scroll — the whole point of the cap is that a
colleague is never scrolled off the edge, and a scrollbar would put the person the
officer is looking for one flick away from invisible. Two columns, then the chip.
- **`transform`** makes an ancestor the containing block for positioned descendants.
The circle's own `translateY(-1px)` hover lift is on the button, not the rail, so
nothing is pinned today — but the rail is still anchored with `right` and `bottom`
rather than the usual `top: 50%` + `translateY(-50%)` edge-rail centring, because that
centring is exactly what would trap anything positioned outside the rail if something
ever is again.

**In preview mode the circles are still controls, and the dashed ring still says they
are not people.** They open an invented conversation — marked, and unable to reach the
server — rather than nothing, because an earlier version drew them as inert marks and
that made the primary interaction of the whole feature untestable on the machine it is
most often looked at from. See the design preview section below and `docs/MESSAGES.md`.

## Five circles, then a count

**The rail draws `RAIL_SLOTS` — five — and then a `+N` chip** that unfolds the rest
when pressed.

The number is a design decision, not a measurement. The rail is a **glance** at the
corner of a screen somebody is working on: it answers "is anyone else around" and
"who", and a station's worth of faces stacked the full height of the workspace stops
being either. Five fits one column on any viewport this app runs on.

This replaced "draw everybody and let CSS wrap the overflow". That version failed in
a way worth writing down: at twelve colleagues the rail ran from the corner to the
middle of the screen, over the dashboard panels, and **nothing on screen said the
list had more in it**. A cap that announces itself is honest about the truncation; a
silent wrap is not.

The chip is a real button, because "there are more" is useless without "show me
them", and it is deliberately not a face: no photograph, no initials, no presence
dot, dashed ring, the ink of a hint rather than of a colleague. Its label says the
number out loud (`Show 7 more colleagues`) since `+7` is not a word, and it sits at
the **end of the drawn list in both states** — so the control that opened the rail is
the one that closes it, and it never moves to a different place on screen.

The boundary is the cap itself: five colleagues out of five is five circles and **no
chip**, because there is nothing being held back to announce. A `+0` would be a lie
told in the one place on the rail that exists to be honest about a truncation.

**Expanded, and only then, the list wraps.** `max-height: min(72vh, 540px)` with
`flex-wrap: wrap-reverse` on the list means the next column runs to the **left** — so
the list is read from the column nearest the corner and continues away from it. That
is the fallback rather than the design, and it is also what makes a very short
viewport survivable. (`max-height` on its own never clips, which is why the rail can
grow a second column past the bottom of the workspace rather than cutting a circle
off — there is no `overflow` to scroll it, by design.)

**Nothing online draws nothing.** An empty rail — a floating sliver with no
circles in it — would be a permanent occupant of the screen edge for a station
that is empty, which is most of the night.

## The photograph

| Route | Who | What |
| --- | --- | --- |
| `POST /me/photo` | the session's own account | multipart `photo`; replaces it, audited `user.photo_set` |
| `DELETE /me/photo` | the session's own account | back to initials, audited `user.photo_remove`, idempotent |
| `GET /users/:id/photo` | **any signed-in role** | the stored bytes |

Under `/me`, and **there is deliberately no admin route that sets another
officer's photograph.** An avatar is part of an account's identity, and identity is
the one thing every role may change about themselves and nobody may change about
somebody else. That is also why `/me/photo` is registered *after* the auth gate,
so the CSRF token is not optional.

`GET /users/:id/photo` is **the only route in `UsersController` that is not
admin-only** — the roster draws every signed-in colleague's face, so every role
has to be able to fetch one. It is also one of only two routes on this API that
answers with something other than a JSON document, and the difference between the
two is the reason the headers below matter: the other is `GET /reports/export`,
which is sent as a `Content-Disposition: attachment` download. This one is
**rendered inline in the page**, so it is the one that has to be unambiguous about
what it is.

### What is accepted, and what is stored

**The type is decided by DECODING the upload**, never by the two things the client
controls: the filename and the `type` it put in the multipart body. A file called
`me.png` that is really a PHP script, or a PNG whose header claims `image/gif`, is
refused rather than stored and served back. `getimagesize()` reads the header, and
the allowed list is three formats — JPEG, PNG, WebP. **SVG is refused**, and not
incidentally: it is a document that can carry script and has no business being
served from our origin.

**A re-encode, not the uploaded bytes.** Even a real JPEG can carry a second
payload in a comment segment, so an avatar is decoded and written back out as a
plain 256×256 JPEG at quality 82. What lands in the folder is something the
server produced, not something a client sent.

| Rule | Why |
| --- | --- |
| 256px square, centre-**cropped** | every face here is drawn in a circle; a stretched face is what makes an avatar look broken |
| composited onto **white** | JPEG has no alpha, so a transparent PNG would otherwise come out as a black square |
| ceiling **2 MB** | PHP's own `upload_max_filesize` on this deployment |
| `u<id>-<unix seconds>.jpg` | identifies whose it is and when, without a lookup |

**No rotation.** The `exif` extension is not installed here, so a photograph
straight off a phone would be stored at whatever rotation its pixels are in. The
**client re-encodes through a canvas first** (`src/lib/avatar.js`:
`createImageBitmap` with `imageOrientation: 'from-image'`, centre-cropped, 512px,
quality 0.9), and a browser applies EXIF orientation when it decodes — so the
ordinary path arrives upright. A hand-rolled `curl` upload of a portrait phone
photo would not, which is the honest limitation rather than something this
pretends to handle.

The client-side shrink is a **courtesy, never a security boundary**: it exists
because a 6 MB phone photo would not arrive at all (and would be refused with a
sentence about size, for a file the officer picked perfectly legitimately). The
only check that counts is the one that decodes the bytes.

### Where the files live

`storage/avatars/`, at the project root, **outside the web root and outside
`public/`** — `public/` is Vite's build output and is emptied on every build
(`vite build && cp -r public-assets/. public/`), so a photograph kept there would
be deleted by the next deploy. Being outside the web root also means an avatar is
only ever readable through the API, under a session.

- **Served with an explicit `Content-Type`** from the file's own extension, under
  `X-Content-Type-Options: nosniff`, so it cannot be interpreted as anything else.
- **`Cache-Control: private, max-age=300` plus an `ETag`** (`sha1(name|stamp)`),
  with a 304 before any body work. A cached photograph that is never re-read is
  the point rather than an oversight — this is the one route that deliberately
  replaces the no-store the front controller sets.
- **The URL carries `?v=` from `photo_updated_at`**, which exists to be a cache
  key and for nothing else. Without it an officer who changes their photo keeps
  seeing the old one wherever the image was cached, which gets reported as "the
  upload is broken".
- **A stored name is refused, not repaired, if it is not a plain filename.** The
  value comes from our own column, but a name is a path component: anything with a
  slash or a `..` in it fails a `^[A-Za-z0-9._-]+$` check, so a corrupted row can
  never read outside the folder. `basename()` alone would silently "fix" it.
- **A missing file is answered 404**, and the client falls back to initials —
  `Avatar.jsx` catches `onError` as **state**, not as a style, because a CSS
  background-image would have nothing to catch a failed load with and the circle
  would simply come up empty, which looks like a person with no face rather than a
  failure the app noticed. The state resets when the URL changes, so a re-upload
  gets a fresh attempt.

## The design preview

**On by default in dev.** The rail is a roster of **other** people, so on a
development machine it is empty — filling it means a second browser with a second
account, and filling it with nine faces means nine accounts. That makes it
impossible to design against: "does a role read next to a badge?", "does the `+N` chip
land on the last circle before the corner?" and "what does a second column look
like?" all need a full rail to look at. So `src/mock-chatheads.js` is a cast of
twelve invented officers, and in dev the rail draws them.

**They ARE pressable, and that is a reversal worth recording.** A circle's job is to
open a conversation, and there is no conversation to open with an account that does not
exist — so the first version drew the mock faces as plain marks: not controls at all,
with an explanation beside them. What that actually produced was the primary
interaction of the whole feature being untestable on the machine it is most often looked
at from. A dev box has one account signed in, the real rail is therefore empty, and the
only chatheads on screen could not be clicked. "I cannot click the chatheads" is what
that costs.

So pressing a mock officer now opens a **preview conversation**: invented messages, in
the shape the controller sends, composed relative to the clock, with a note at the
composer and nothing in it able to reach the server. What makes that honest is the
marking and the dead composer, not the absence of a destination. The full reasoning is
in `docs/MESSAGES.md`.

**The flag is read once, by Shell.** It decides the rail's roster and what pressing one
of its circles opens, so a second read in the box is how an invented officer ends up on a
rail whose box refuses their id.

### The colleague you are talking to leaves the rail

`openPeerId` — the id of the conversation the chatbox is showing, or null — takes that
colleague's **whole circle** off the rail while the box is open. Close the box and the
face is back in its slot.

It is one rule with two consequences and neither needs saying twice: a face you are
already talking to is not somebody you are still looking for, and the unread mark it may
have been wearing goes with it. The press it would take does nothing the open box is not
already doing.

**It is filtered BEFORE the cap.** The rail draws five circles, so hiding one of the five
afterwards would leave a hole where a sixth colleague could have been shown — a station
with six colleagues online and one of them open would draw four circles and a `+1` chip,
holding back somebody the rail had room for. Filtering first means the free slot is
taken: five circles and no chip. There is a test that asserts exactly that pair.

**Nothing is stored and nothing is marked read.** The rail is handed an id and draws the
roster without it; the prop goes null when the box closes and the next heartbeat
re-states whatever marks are still true. That is what makes it self-correcting rather
than a cache.

A two-officer station with the other one's conversation open therefore draws **no rail at
all** — the same rule as the one-officer station above, reached from the other side.
Nobody left to draw is not an empty frame; it is nothing.

```
http://localhost:5180/?chatheads=off     ← the REAL roster (live presence)
```

`off` (or `live`) is the only value that means anything, and it is the one that
matters: checking that presence actually works needs real presence. It wins over
any other value, so a stray `&chatheads=preview` cannot cancel it.

### The default flipped, and why

This shipped as an **opt-in** behind `?chatheads=preview`, on the theory that an
explicit request is safer than something that simply appears. What it produced was
invisibility: the rail was empty on every dev machine, indistinguishable from a
feature that had never been built. A design preview you have to remember a query
string to see is one nobody sees.

**Safety did not move, because it was never in the flag.** The permission is
`import.meta.env.DEV` — Vite folds it to `false` at build time — combined with the
URL saying something other than `off`. A SHIPPED bundle shows no mock officer
whatever the query string says, and that was equally true when the default was off.

**It marks itself, in three places.** A dashed ring on every invented face — the
one that survives being **cropped**, because it is in the image rather than beside
it; the group's accessible name (`Preview: 12 mock colleagues, not real presence`);
and a note above the composer of an invented conversation, which is the one that
has to be read, because it is the one stopping somebody typing into nothing.

A preview that looks exactly like the product is a screenshot somebody later
believes, of officers who do not exist.

**There used to be a caption above the circles, and it was removed.** Two things
about that are worth keeping. The first is the cost: the caption was the only place
ON SCREEN that said `?chatheads=off`, so how to reach the live rail now lives in
this document and in `src/components/Shell.jsx` rather than in front of you. The
second is that it could not have worked where it was: an absolutely positioned child
of the rail has a containing block only as wide as a **circle**, so its `max-width`
never applied and the sentence wrapped into a tall narrow column. The thing to
learn is not "captions are bad" — it is that a marker hung outside a
shrink-to-fit box inherits that box's width, and the rail is exactly such a box.

**The faces are invented; the shapes are not.** Everything in the set is something
`PresenceController::present()` can actually send:

| Constraint | Why |
| --- | --- |
| roles only ever `Admin`, `Officer`, `Staff` | those three rows are the whole of the `roles` table |
| every entry has a badge number | `users.badge_number` is `NOT NULL UNIQUE`; the client's "no badge" branch is defensive, not ordinary |
| ids from 9001 | far above `AUTO_INCREMENT`, so a mock can never be mistaken for an account |
| ~2 KB, dev only | see the note below |

It also covers the states that are easy to forget while designing: **one
photograph and eleven sets of initials** (the two halves of `Avatar`), **every
role**, **a name long enough to be a mouthful in a tooltip**, **ages from 4 seconds to
31 minutes** so both "active just now" and "active 31m ago" appear, and **one row
with no ages at all** — the unreadable-entry case the client keeps on purpose,
which draws "Signed in" with no duty line.

Twelve is deliberately **more than the rail draws**, so the preview opens on the
`+7` chip by itself — pressing it is how the second column gets seen at all.

### One thing this does not do

The mock is imported unconditionally, so its strings — the cast **and** the preview
conversations — **are in the production bundle** as inert data. The
`import.meta.env.DEV` read folds perfectly: in a built bundle the preview state is
the literal `false` (`useState(()=>!1)`), and `chatheadPreview` does not appear in
it at all, because the `false && …` short-circuit let Rollup drop the whole
function. But Rollup cannot drop a value that a ternary still mentions, and a
shipped bundle holds the mock text it can never reach.

Dropping the bytes is possible (gate the import behind `DEV` at module scope), and
it was not done, for one reason worth writing down: it would make the preview
state **unreachable from the render test that exists to check it**, because that
test runs in node, where `DEV` is not true. A checked mock is worth more than two
kilobytes — and the thing that must hold, that a build cannot show a mock officer,
is enforced by the `DEV` read and asserted in `tests/rules/chatheads.test.mjs`
either way.

To check it yourself after a build:

```bash
grep -o 'useState(()=>!1)' public/assets/index-*.js     # the folded preview flag
grep -c chatheadPreviewEnabled public/assets/index-*.js # 0 — tree-shaken away
```

## Three things that look like faults and are not

**An empty rail is a real answer.** Nobody has beaten in the last two minutes —
which is what it looks like at 03:00, and immediately after the migration.

**The rail is empty when you are the only one on.** You are signed in, the
heartbeat is running, and there is still nothing to draw — because the rail is a
roster of other people. It is not a sign that presence is broken; open a second
browser and it will fill.

**A colleague's circle does not move when they go idle.** It disappears at the end
of the window, all at once. There is no half-faded state, because a circle that
looks 60% online is not a fact the server has.

## Files

| File | What it is |
| --- | --- |
| `migrations/014_presence_and_avatars.sql` | **new** — `users.last_seen_at`, `photo_path`, `photo_updated_at`, `idx_users_last_seen` |
| `migrations/014_presence_and_avatars.down.sql` | **new** — the rollback (does not delete stored images; it cannot) |
| `app/controllers/PresenceController.php` | **new** — the beat, the window, and the roster query |
| `app/core/AvatarPhoto.php` | **new** — what is accepted, what is stored, the URL and its cache key |
| `app/controllers/AuthController.php` | `POST` / `DELETE /me/photo`; `photo_url` in the `/me` payload |
| `app/controllers/UsersController.php` | `GET /users/:id/photo` — the one non-admin route in there |
| `api/index.php` | the three photo routes and `POST /presence/heartbeat` |
| `src/lib/presence.js` | **new** — the heartbeat interval, the ageing rule, the "everybody but you" filter, and every sentence the rail says; kept pure so the rules and the wording can be tested |
| `src/lib/avatar.js` | **new** — `checkAvatarFile`, `squareCrop`, `prepareAvatar` (the canvas re-encode) |
| `src/components/Avatar.jsx` | **new** — one face for the whole app: photo, or initials when the load fails |
| `src/components/Chatheads.jsx` | **new** — `ChatheadRail` (draws a roster it is handed) and `Chatheads` (the beat, and the `DEV`-guarded design preview) |
| `src/mock-chatheads.js` | **new** — the twelve invented officers the rail draws in dev, unless `?chatheads=off` |
| `src/components/Shell.jsx` | renders the rail, because Shell is the signed-in frame and the gate has no roster to show |
| `src/components/ProfilePanel.jsx` | the photo control, under Preferences |
| `src/styles.css` | the **Presence rail (chatheads)** section, and `.bw-avatar` |
| `tests/PresenceTest.php` | **new** — the window, the roster and its ordering over HTTP |
| `tests/AvatarTest.php` | **new** — what the endpoints accept, store and refuse |
| `tests/rules/presence.test.mjs` | **new** — the ageing rule and the words |
| `tests/rules/avatar.test.mjs` | **new** — the client's file checks and the square crop |
| `tests/rules/chatheads.test.mjs` | **new** — the rail **rendered**, not read as text |
| `tests/rules/profilePhoto.test.mjs` | **new** — the photo control **rendered**, in both states |

`last_seen_at` is written in exactly one place — the heartbeat. Nothing else in
the application touches it, so "who is online" has one author.

### Why two of those tests bundle and render

Almost every test in `tests/rules` reads source as **text**. That is cheap and it
catches what text can catch — a class name, a copy string, the order two
statements must be in. It cannot catch the failure that has actually shipped twice
in this project: a component that throws, or paints nothing, while all of its
tests pass.

The rail is the worst possible shape for that blind spot, because it returns
`null` on an empty roster: a crash inside it would appear only **after a
successful heartbeat**, on a screen no test ever opens. So those two files bundle
their fixture with esbuild (the bundler Vite already ships — no new dependency)
and render it with `react-dom/server`, then read the markup. The shared harness is
`tests/rules/renderHarness.mjs`.

**What that cannot check, stated plainly: effects.** `renderToString` does not run
them, so the heartbeat, the ticker and the dismissal listeners are invisible to a
render test by construction. That is why `ChatheadRail` takes its roster as a
**prop** and the beating lives in the `Chatheads` wrapper — the drawing is what
gets rendered, and the lifecycle is covered by `presence.test.mjs` and
`PresenceTest.php`.

## Applying it

```bash
mysql -u root -p bluewrite < migrations/014_presence_and_avatars.sql
mkdir -p storage/avatars && chmod 775 storage/avatars   # must be writable by the web server
```

Rollback: `migrations/014_presence_and_avatars.down.sql`. It drops the three
columns and the index. It **does not delete the stored images and cannot** — they
are files, named by rows that then no longer exist, so `storage/avatars/` may hold
orphans. Those are harmless and recoverable only by hand.

After the migration nobody is online (every `last_seen_at` is NULL). The first
tab to load the workspace signs itself in to the roster on mount — the beat fires
once immediately, not thirty seconds in — so the way to see the rail with more
than one face is **two browsers, two accounts**.
