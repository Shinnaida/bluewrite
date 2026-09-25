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

The beat is also what the account page's **attendance sheet** reads, and that takes a
second migration:

```bash
mysql -u root -p bluewrite < migrations/017_presence_days.sql
```

Until it runs, `POST /presence/heartbeat` answers normally — the tally is guarded, because
the rail and the unread counts ride on the same endpoint — and the account page estimates
the whole year from the trail's sign-ins instead. `presence_days` keeps one row per account
per day, which is what makes "how long was this officer at a desk on the 14th" a question
the record can answer at all; see *The half of absence nobody records* below.

## The half of absence nobody records

A presence rail answers *who is here now*, and the beat behind it is thrown away —
`users.last_seen_at` is one stamp, overwritten on every beat. So the station had no
answer to the question an attendance sheet asks: how long was this officer at a desk on
the 14th. The audit trail could not answer it either: it records when somebody SIGNS IN
and when they press SIGN OUT, and closing the tab, walking away or shutting the PC down
all leave no end mark at all.

`presence_days` (migration 017) is that beat kept as a history. What it measures, exactly:

- **time at a desk**, not first-beat-to-last-beat — the sum of the gaps between
  consecutive beats that are close enough together to be one sitting, using the same window
  that decides who is online. A three-hour lunch is therefore not three hours of work, and
  a slow minute is not a break;
- **first seen and last seen beside it**, because a span and a sum are two facts about a
day. The span is what the sheet shows on hover (`08:02–17:11, 6h 40m at the desk`);
- **the beat count**, because a day with a single beat is a day somebody was there and a sum
  of intervals would call it zero.

WHAT IT CANNOT SEE: the beat runs while the workspace is open, so a station PC left signed
in overnight counts as time at a desk. That is the honest reading of "the workspace was
open", and it is why the page prints the total in words beside the squares rather than
leaving the colours to speak for themselves. For the days before 017 there is nothing to
backfill — the beats were never recorded — so the sheet estimates those from the trail's
sign-ins and marks them as estimates.

## What it is

Every account that has said "still here" in the last **two minutes**, as a column
of circles in the **lower right corner** of whatever screen is open — and **out of
the way until it is asked for**: the rail is invisible until the pointer reaches the
right edge of the window, and it is put away again when the pointer leaves. See
*Coming out for the pointer* below for why it is a listener rather than `:hover`.

Once it is out, it hangs upward from the corner: the workspace's own content is top-left heavy (headers,
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

**No `overflow` on the rail**, and the absence is still deliberate even though the
reason it was first written down is gone:

- **`overflow`** would turn the cap into a scrollbar. The rail draws five circles and
a `+N` chip precisely so it never has to scroll — the whole point of the cap is that a
colleague is never scrolled off the edge, and a scrollbar would put the person the
officer is looking for one flick away from invisible. Two columns, then the chip.
- **`overflow`**, and this is the second thing it would break: a hidden rail slides out
from the edge (see *Coming out for the pointer*), so anything clipped here would cut the
motion off mid-frame.

The **`transform` refusal is retired**, and it is worth saying why rather than deleting
it quietly. It existed because a `transform` makes an element the containing block for
positioned descendants, which was going to trap the officer card that opened leftward
out of a circle in a box one circle wide. **That card is gone** — a circle opens the
conversation directly, and the docs for its removal are in `Chatheads.jsx`. What is left
inside the rail that is positioned at all is the presence dot, and it resolves against
the circle, which is nearer to it than the rail is. So the rail may carry exactly one
transform: the reveal's slide, rung back to `none` at rest. `chatheads.test.mjs` pins
both halves, including that nothing in the rail is `position: fixed` (the one kind of
descendant a transform still captures).

The old note is kept below for the part that still holds:

- **`transform`** makes an ancestor the containing block for positioned descendants.
The circle's own `translateY(-1px)` hover lift is on the button, not the rail, so
nothing is pinned today — but the rail is still anchored with `right` and `bottom`
rather than the usual `top: 50%` + `translateY(-50%)` edge-rail centring, because that
centring is exactly what would trap anything positioned outside the rail if something
ever is again.

## Coming out for the pointer

**Hidden by default.** The rail used to be drawn over every screen for the whole of a
shift, so that a station with four people in it could be told apart from an empty one.
It answered that, at the price of a permanent column of faces on top of every report,
directory and audit list — for a question an officer asks occasionally. It is furniture
that slides out now: invisible until the pointer reaches the right edge, and gone again
a **minute** after the pointer last touched it. **Nothing else about it changed** — the
same roster, the same cap, the same tooltips, the same unread marks.

**The trigger is a listener, not `:hover`, and that is forced.** While the rail is
hidden it takes no pointer events, which is what keeps an invisible column of buttons
out of the way of the clicks aimed at the table underneath — and an element that cannot
be hit cannot be hovered either, so the thing that brings it back cannot be the rail's
own box. `Chatheads.jsx` watches `pointermove` against `RAIL_EDGE_PX` (26px, measured to
the **viewport** edge, not to the rail, which is not on screen when the pointer starts
moving) and marks the rail open. Two further rules fall out of the same listener:

| State | What holds the rail open |
| --- | --- |
| The pointer is at the edge | `atEdge` — the listener above |
| The pointer is on the rail | `overRail` — enter/leave on the rail's root |
| **A minute of silence** | `held` — `RAIL_DWELL_MS`, armed and re-armed by the two above |
| A keyboard is inside it | `:focus-within` in CSS |

**It stays out for a minute** (`RAIL_DWELL_MS = 60000`), and that is the row in that
table worth reading twice. The two cursor states say where the *pointer* is, and that is
the wrong question to close the rail on: the rail is read, not used — the faces, their
ages and their unread marks all want more than the second or two a pointer spends on its
way past — and closing it the instant the pointer left would mean re-seeking the edge to
check a name, a gesture somebody has to remember. So both cursor states only ever arm the
dwell, and the countdown is re-armed by every interaction: what expires is a minute of
**silence**, not a minute from the first touch of the edge. A keyboard inside the rail
still holds it open beyond that, which is the one thing the minute cannot close.

The `overRail` half is the one that is easy to miss: without it, moving from the edge
onto a face would close the rail on the frame that reached it and the click would land
on the table. It is enter/leave rather than over/out so that crossing between two
circles does not read as leaving. A pointer that leaves the window at the edge produces
no further move event, so `pointerleave` on the document corrects the last one.

**Hidden is `opacity: 0`, never `visibility` or `display`.** This is the accessibility
decision in the rule rather than a styling one: an opacity-zero element stays in the tab
order, so tabbing to the first circle opens the rail and the whole roster is reachable
without a pointer. `visibility: hidden` would take the rail out of the tab order *and*
the accessibility tree, making it a mouse-only feature. The cost is that the box keeps
its place in the corner while invisible, which is deliberate: an invisible box that
holds its place is cheaper than a chatbox that jumps right the moment somebody touches
the edge.

**It slides out of the edge, and it fades on the way.** The travel is
`translateX(22px)` — the rail's own 18px inset plus a little, so the tucked-away rail is
a sliver past the viewport edge and the motion starts off-screen rather than from an
offset anybody can see. Nothing is clipped doing it: the corner is `position: fixed`, so
a child past the right edge contributes no scrollbar, and the rail is invisible in that
state anyway. `transform` returns to `none` the moment it arrives, which is what keeps
the containing-block question above closed for everything except the 180ms in flight.
The slide carries the motion and the fade covers its tail, so there is never a moment
where a fully opaque column is moving over the table.

Both transitions are gated with the corner's others on `prefers-reduced-motion`; **the
states are not**, so for a reader who asked for less motion the rail is simply there or
not, instantly, in the right place.

**Nothing is lost while it is hidden.** The unread count an officer acts on is on the top
bar's Messages button — always drawn, always counted, announced as "Messages, 2 unread".
The rail's marks are the per-colleague detail of the same fact, not the only place it
appears.

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
| `POST /me/photo` | the session's own account | multipart `photo`; replaces it, audited `user.photo_set` with the officer as the actor |
| `DELETE /me/photo` | the session's own account | back to initials, audited `user.photo_remove`, idempotent |
| `POST /users/:id/photo` | **Admin only** | the same upload for somebody else, audited `user.photo_set` with the **admin** as the actor |
| `DELETE /users/:id/photo` | **Admin only** | their face back to initials, audited the same way, idempotent |
| `GET /users/:id/photo` | **any signed-in role** | the stored bytes |

The officer's own face lives under `/me`, and both `/me/photo` routes are
registered *after* the auth gate, so the CSRF token is not optional. The ordinary
way a face is chosen is by its owner.

**The admin route exists because of one case the owner cannot answer: an account
that has not signed in yet.** It was added deliberately, and the note that used to
say no such route existed was right for the version of the station that had no
directory. What changed is that accounts are now created here — an administrator
sets a name, a badge and a role, and the account may sit unused for days. "Their
face is theirs to choose" left the roster drawing a blank circle for that whole
time, which is not a principle being honoured; it is a hole in the record.

**So it is an Admin action, and it is audited as one.** `UsersController::setPhoto`
and `clearPhoto` write the same `user.photo_set` / `user.photo_remove` actions
the officer's own upload does, against the officer's id, with the admin as the
actor — so the trail can always answer who put that photograph there. An officer
who replaces it later does not erase that entry: the trail records acts, and this
one happened. Everything else about the two routes is shared, including every rule
below — **an admin route is not a weaker upload.**

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

## Where the roster comes from

**`POST /presence/heartbeat`, and nothing else.** The rail draws whatever the server
last filtered, aged by the client against the server's own window, so every circle on it
is a real account signed in on this station. There is no second source and there is no
design preview any more: the rail used to have one — a cast of twelve invented officers
in `src/mock-chatheads.js`, drawn by default on a dev machine and switched off with
`?chatheads=off` — and it went when the real conversations went in. A rail that can draw
officers who do not exist is a screenshot somebody later believes, and the two surfaces
that read it (this rail and the chatbox beside it) now read the live server for one
answer.

The cost is real and it is known: **on a development machine the rail is empty**, because
a roster of other people with nobody else in the building has nothing to say. Seeing more
than one face means two browsers with two accounts — which is also the only way to check
that the heartbeat actually works.

## The colleague you are talking to leaves the rail

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
| `src/components/Chatheads.jsx` | **new** — `ChatheadRail` (draws a roster it is handed) and `Chatheads` (the beat) |
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
