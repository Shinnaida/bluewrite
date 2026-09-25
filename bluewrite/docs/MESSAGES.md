# Messages

Officer-to-officer messages: a docked panel on the right edge, opened from a chathead,
unread marks on the faces that are waiting.

This document is the reasoning, not the tour. `docs/NOTIFICATIONS.md` covers the *other*
half of "what do I need to look at" — what happened to your own reports — and the two are
deliberately separate systems: the bell is a feed about records, and this is a
conversation between two people.

---

## What it is

A circle per colleague in the presence rail, and a **floating chatbox** that opens beside
it when one of them is pressed.

```
                                ┌────┐
   ┌────────────────────────┐   │ ER │
   │ ‹ (JD) Juan Dela Cruz  │   └────┘
   │        Senior Officer ˄ │   ┌────┐   the rail, minus the
   │        Badge 4417  + × │   │ FL │   colleague you are
   ├────────────────────────┤   └────┘   talking to
   │ ─────── Yesterday ─────│   ┌────┐
   │ ┌──┐┌────────────────┐ │   │ GA │
   │ │JD││ Did you take.. │ │   └────┘
   │ └──┘│ 09:14          │ │
   │     └────────────────┘ │
   │         ┌────────────┐ │
   │         │ Taken. She │ │
   │         │ 09:15  ✓✓  │ │  ← ✓✓ solid = read
   │         └────────────┘ │
   ├────────────────────────┤
   │ ( Message Juan…    ) ➤ │
   └────────────────────────┘
     ↑ the box floats in
       the corner, to the
       rail's left
```

Three screens live in the one window, and one piece of state (`peer`) plus one flag
(picker) choose between them: the **list** of conversations, the **thread** with one
colleague, and the **contacts picker** for starting a new one.

| Where it opens from | What you get |
|---|---|
| **Clicking a chathead** | that colleague's thread, already focused in the composer |
| The title bar's **+** | the picker, filtered by name, badge or role |

The panel used to have a third doorway: a messages icon on the top bar, beside the
notification bell, which opened the list of conversations from anywhere. It was removed
by request. The panel, the rail's unread marks and the picker are unchanged — what went
is only the always-there shortcut to the LIST, so a conversation is started from a
colleague's own circle on the rail (which is on every signed-in screen), and the `+` in
the window's title bar still searches the roster for anyone not already on it.

**One click, not two.** A chathead used to open an officer card first — a small panel
with the colleague's name, role, badge and idle time — and the conversation was behind a
Message button inside it. That was two clicks to reach the thing the circle exists for.
The card is gone: the window's own title bar carries the identity facts, the circle's
tooltip carries the rest, and the one thing the card had that nothing else does (how long
ago they moved) is a value that goes stale the instant it is drawn.

**And the circle you pressed leaves the rail while the box is open.** Not just its unread
mark — the whole circle, and it comes back the moment the box is closed. The rail answers
*who might I be looking for*; once the conversation is open that face has been found, the
press would do nothing the box is not already doing, and the slot nearest the corner is
better spent on somebody who has gone unread while you were typing. See
`docs/PRESENCE.md` for where in the rail that filter happens (before the cap, so hiding
one colleague frees a slot rather than leaving a hole).

## Every conversation is a real one

**There is one source of threads and it is the server.** A thread is the answer to
`GET /messages/{id}`, polled while it is open, marked seen against the newest id it drew
— and there is no second path for a conversation drawn from invented data. The panel used
to have one (`mockThreadFor` in a dev-only `src/mock-chatheads.js`, opened by clicking an
invented chathead), and it was removed when the real threads went in.

What that buys is the absence of a whole class of bug: nothing in this panel can show
words nobody wrote, and nothing can accept a reply that has nowhere to go. What it costs
is the dev machine with one account signed in — its rail is empty, so seeing a
conversation means a second browser with a second account. That is the honest price, and
it is cheaper than a mock thread that looks exactly like a real one.

---

## The rules that shape it

### 1. Messages are marked read against ids, not against the clock

The server records `read_at`. What it does *not* do is mark "everything up to now".

When a thread is first loaded, the client posts `/messages/{id}/seen` with
`up_to: <newest message id it just drew>`. Not `now`, which is the tempting version and
the wrong one: a message that arrives *during* that request would be swept up as read
without ever having appeared on screen. The same rule the notification bell's watermark
follows, for the same reason — a mark that clears something nobody saw is worse than a
mark that stays.

The `read_at` column is written **only by the recipient** — `seen()` marks
`WHERE recipient_id = :me` and nothing else — so it cannot be forged from the sender's
side, which is the property the whole thing rests on.

**And the sender can see it.** That is a reversal, made deliberately: `read_at` was
always on the wire (it is the recipient's unread predicate and the row carries it), the
panel took it and drew nothing with it, and this document said the station did not promise
it back. Two accounts of one fact is one too many, and a double check beside your own
sentence is what tells an officer whether the person at the other end has actually seen
it — on a station line, the difference between having handed something over and having
left it in a box.

What did **not** change: only the recipient can set it, and there is no third state.
`read_at` null means "not read yet", never "unknown".

### 2. The unread marks ride on the presence heartbeat

`POST /presence/heartbeat` already answers with the roster. It now also answers with
`message_unread`, a **list of pairs**:

```json
{ "sender_id": 9, "count": 3 }
```

A list rather than an id-keyed object, and the client reader is written to match — see
`unreadFor` in `src/lib/messages.js`. The reason is the marshalling: a PHP map with one
integer entry serialises as `[3]`, and `{"7":2}` with keys from a database looks like an
array until the day it does not. A client that guessed would eventually read one as the
other.

Riding the beat has two costs and they are both worth paying:

* **The marks are thirty seconds stale.** There is no push on a LAN tool; the server is
  told about a message when somebody asks. An open thread polls itself — at
  `THREAD_POLL_MS` (8s) when nothing is happening and `THREAD_ACTIVE_POLL_MS` (3s) while
  it is, which is what makes three dots appear while a colleague writes rather than after
  they have finished — but a thread nobody has open waits for the beat.
* **The marks are not aged.** Everything else the heartbeat returns goes stale and is
  dropped by `ageRoster`; a message that is waiting is waiting until somebody reads it,
  so the counts are held in their own state and replaced whole on each beat.

The alternative — a second poll for a second fact — would be a second answer to "who has
sent me something", and the two would eventually disagree on screen about one colleague.

### 3. Escape closes the box. A press outside does not.

This is inherited from the dock it used to be, where the reason was that this surface is
**written in**: an officer reads the report a message is about and types a reply while
looking at both. A box that shut on the next click in the workspace would close every
time they went to check a detail. The AI narrative panel makes the same call for the same
reason, and it is the precedent this follows.

It matters **more** now, not less: the box floats over the workspace, so the press that
would dismiss it is a press on the work underneath — reading the report is the thing you
do between sentences. The ways out are the **×** in the title bar and **Escape** — and
**˄**, which puts the window away without closing it.

### 4. Typing is a latch in its own table, and it expires by ageing

`message_typing` holds **one row per ordered pair of accounts** — writer, reader, and a
stamp — replaced in place by `POST /messages/{id}/typing`. It is not a column on a message,
because it is not about a message: nothing has been sent yet, and that is exactly the fact
a station line needs and cannot derive from what has been said.

Why a latch rather than a log, why the writer is the session and the reader is the body,
and why the read is one indexed seek on a two-column primary key: `016_message_typing.sql`.
Four things are worth repeating here, because each is a bug this design avoids:

* **It is addressed.** The read asks for `user_id = <them> AND peer_id = me`, so a draft is
  visible to exactly one person — the colleague it was aimed at. Not to their author, and
  not to an administrator, who would otherwise be able to watch who is writing to whom.
* **Nothing sweeps it.** A stamp older than `TYPING_WINDOW` (6s) is simply not fresh. A
  laptop that went into a bag mid-sentence leaves a row that stops meaning anything rather
  than three dots that pulse all afternoon.
* **The message clears it.** `send()` deletes the sender's stamp for that peer in the same
  request, so the recipient never reads a reply with the dots still going underneath it.
  (Reading the id *before* that delete is load-bearing: `lastInsertId()` belongs to the
  connection's most recent write, so a statement in between returns the wrong id — and it
  fails as "that message could not be sent" three lines later, not as an obvious mistake.)
* **The client pings on keystrokes, not on a timer.** An interval would keep saying "still
  typing" for as long as a draft sat in the box — a half-written reply left on screen over
  lunch would show dots all afternoon. A ping triggered by characters arriving stops when
  they stop, throttled to `TYPING_PING_MS` (2.5s) against the server's 6s window.

### 5. The thread follows the bottom until you scroll away from it

New messages auto-scroll — that is the one thing a chat has to get right. But it pauses
the moment somebody scrolls up to read, and that is the same rule seen from the other
side: yanking a reader back to the bottom is how a transcript becomes unreadable for the
job it exists for.

The decision comes from the **scroll position** (`atBottom`), not from a "did they touch
the wheel" flag, so a dragged scrollbar, the End key and a trackpad flick all give the same
answer, and a thread that grows past the viewport while somebody is already at the bottom
keeps following. It is read from a **ref** rather than from state, because the scroll
decides inside an effect that sees the render it was called for — reading state there uses
`paused` from *before* the scroll that paused it, i.e. follows exactly one message too long.

While paused and messages arrive, a small **"2 new messages ↓"** pill appears, sticky to
the bottom of the transcript. Without it, pausing would silently withhold a colleague's
words, which is worse than the jumpiness it was fixing. Sending always snaps back down:
somebody who has scrolled up and then replies is not reading history any more.

---

## How the box behaves

It **floats in the lower right corner, to the rail's left**, and it publishes nothing. It
used to be a dock: a third panel pinned to the right edge that set
`body.messages-panel-open` and made the workspace reserve a 24rem stripe with a
`margin-right`. None of that is left.

**Why it moved.** A dock is the right shape for the AI narrative and the profile panel —
surfaces you work *in*, for a while, with the workspace still live beside them. A
conversation is glanced at, answered and dismissed, and a permanent 24rem stripe out of
the register is a lot of desk to pay for that.

**One corner owns the position, and it is not the rail.** `.dash-dock` is fixed at
`right: 18px; bottom: 18px` and holds the box and the rail as a flex **row** with the rail
last, so the box is always exactly to its left. The alternative was arithmetic — the box
at `right: calc(18px + rail width)`, with the rail's width written down somewhere — and a
number can only ever describe **one** of the rail's states: the moment it wraps into a
second column, the box is on top of it.

| Condition | Behaviour |
|---|---|
| any width | floating over the workspace; **no reflow**, no reserved width, no `body` class |
| the box's size | `width: min(21.25rem, 100vw - 2.5rem)`, `height: min(28.75rem, 100dvh - 5rem)` — 340 × 460 |
| < 900px | the box keeps its place and the **rail** hides — see below |
| < 720px | the rail is gone for good (presence is a desk feature); the box remains |
| print | neither the box nor the messages button prints |

The width is a **reading measure** — 21.25rem is about 40 characters at this type size,
which is the short end of comfortable and the right end for a one-to-one chat: two
replies read side by side without either wrapping to four lines. The height is a fraction
of the viewport rather than a content size, because a conversation has no natural length:
it is however much two officers typed.

**It is 460px tall, and that is a decision rather than drift back toward the dock this
window replaced.** The window grew and the *thread* grew more, because the composer
stopped being a 128px empty box and the bubbles got tighter:

```
          window   composer      thread
  was      368px   128px ← bug   ~211px
  now      460px     ~34px       ~360px
```

The composer was the bug, and it is worth keeping the story. A global
`textarea { min-height: 8rem }` in `styles.css` — written for the report form's narrative
box, a paragraph somebody settles into — applied here too, because this composer's rule
overrode `resize` and never `min-height`. So a window had 128px of it as a flat empty box:
a third of the whole panel spent on nothing, while `rows={2}` and `resize: none` both
already said two lines. `min-height: 0` on `.messages-draft` is what fixed it, and there is
a test that pins it *and* that the global rule still exists — because a `min-height`
inherited from an unrelated corner of the stylesheet survives every review. The field is
**one line and exactly the height of the send button** — `height: 34px` on
`.messages-draft`, the same number as `.messages-send` — and anything longer **scrolls
inside the field** rather than growing it, which is what keeps a pasted paragraph from
eating the transcript. It was two rows (~55px) against a 34px circle, so the composer had
two heights and the paper plane sat below the words it sends; the test asserts the two
heights are equal to *each other* rather than to a number written into the test, so moving
either one is a change it sees.

### What it is made of, and the one colour that does not flip

The window, the bubbles and the composer read `--msg-*` tokens rather than `--panel` and
`--line`, because **a bubble is not a card**: a card is a slice of the document and takes
the document's ink, while a bubble is correspondence — a transcript with two speakers to
tell apart. The tokens are declared in `:root` (light) and overridden in `dark-theme.css`,
which is where the navy tint comes from.

One thing in the box is **not** a token: the title bar's `--ir-navy`. It is the colour the
top bar wears, it is lifted rather than inverted in dark, and white on it is right in both
themes — the same argument the chathead faces used to make. Everything else, including the
subtitle's grey, is stated once and answered for by both themes; a test asserts the whole
block contains exactly two literals and names what they are for.

**The read receipt is white, not blue.** The design asked for a blue double check, which on
a filled accent bubble is blue on blue — the one request in it that is not legible. So the
axis is brightness, the only one this surface has: one translucent tick is *sent*, a solid
white tick is *read*, and both states carry their words on `aria-label` and `title`,
because two shades of white are two states to a sighted officer and no information at all
to anybody else.

**The rail is what gets dropped on a narrow screen, not the box.** Below 900px the rail
goes, because a corner shifted left of a drawer would sit on top of the form the drawer
just uncovered — but the conversation stays. Hiding a half-written message because the
window got narrow would be losing work to a breakpoint.

**One right edge, and now only two docks.** Opening messages no longer closes the profile
panel, because the box is not on that edge any more: it sits in the corner with the rail,
over whatever is there.

**Putting it away is not closing it.** The **˄** folds the window down to its title bar,
and it does so with **a class, not by unmounting anything**: `.messages-box.is-minimized`
sets `height: auto` and hides everything except the head. Everything underneath stays
mounted, which is what makes expanding instant, keeps a half-written reply, and leaves a
poll in flight able to finish. **×** is the one that ends the conversation, and it is a
separate control because it is a different intention.

A minimized box still counts as open, so the colleague's circle stays out of the rail
alongside it. Put the window away mid-thread and the corner is consistent: the rail says
who is around, and the bar says who you are talking to.

### The one thing that could silently break the layout

`.messages-thread` is the only scrolling region in the box, and it is a flex child:

```css
.messages-thread {
  flex: 1;
  min-height: 0;          /* ← this */
  overflow-y: auto;
}
```

Without `min-height: 0` a flex child refuses to shrink below its content, so a long
conversation pushes the composer **off the bottom of the window** instead of scrolling —
and it only starts happening once somebody has written enough messages to make it happen.
A test asserts both declarations are present.

---

## Everybody but you

Your own account is **not drawn** in the rail and **cannot be picked** in the contacts
picker — `/messages/contacts` excludes the session's own id server-side, and the rail
filters self the same way it always has. There is no conversation with yourself.

The roster the heartbeat returns still *includes* you, unchanged. That is a fact about the
station and the next feature that wants "everybody on, including me" should not have to
reconstruct it; the filter is a **drawing** rule, applied to what this screen paints.

---

## The API

Five routes, all session-scoped. Nobody can read a conversation they are not in.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/messages` | conversations, each with its `peer`, `last` message and `unread`; plus `unread_total` |
| `GET` | `/messages/contacts` | everybody who can be messaged, with `online` from the same two-minute window the rail uses |
| `GET` | `/messages/{id}` | the thread with one colleague: `peer`, `messages`, `has_more`, `unread`, `peer_typing` |
| `POST` | `/messages` | send. `{ recipient_id, body }` → `201` with the stored message |
| `POST` | `/messages/{id}/seen` | mark read. `{ up_to }` → `{ unread, unread_total }` |
| `POST` | `/messages/{id}/typing` | "I am writing to you" — one latch row, replaced in place, aimed at one colleague |

A message row the client draws:

| Field | Meaning |
|---|---|
| `id` | identity, and the only thing two reads are merged by |
| `body` | the words |
| `mine` | whether the session wrote it, which decides which side it is drawn on |
| `age_seconds` | seconds since the server wrote it |
| `created_at` | the exact timestamp, kept for the tooltip |
| `sent_label` | `HH:MM`, **formatted by the server** |
| `day_group`, `day_label` | the day it belongs to, and the server's word for it |
| `read_at` | when the **recipient** opened it. Drawn as a receipt on your own messages, and ignored on theirs |

`age_seconds` is turned into `"2h ago"` by `relativeAge` from `src/lib/notifications.js` —
one vocabulary for "how long ago" across the whole app. Past 30 days it returns `null` on
purpose, and the conversation row falls back to `day_label` rather than printing
`"31d ago"`, a number nobody converts in their head.

**Nothing dates anything client-side.** `day_group` and `day_label` are the server's, and
`threadRows` only decides where the heading goes. Flooring an age into 24-hour buckets
files a 23:50 message from yesterday under "Today", and a station PC's clock is whatever
somebody set it to.

---

## What it does not do

No edits, no deletions, no attachments, no emoji picker, no group threads, no broadcast,
no calls. Each is a feature somebody will ask for and each is a promise about the other
person that this does not need to make.

**Typing and read receipts are no longer on that list** — they were added deliberately (see
rules 1 and 4), and the paragraph that used to sit here saying the station never tells a
sender their message was read was wrong the moment that changed. The two that remain
deliberate absences, and the reason to keep them absent:

* **A typing signal says nothing about a draft's contents or length.** It is one bit, aimed
  at one colleague. The moment it carries anything else it becomes a way to watch somebody
  compose a sentence, which is not a thing this system does.
* **`read_at` is a timestamp, not a surveillance feed.** There is no "last seen reading",
  no per-message seen time on the recipient's side, and no aggregate anywhere.

---

## Three things that look like faults

**A mark that will not go away.** Opening a thread clears it, and the clearing is
best-effort: if that `POST /seen` fails, the mark survives to the next visit. A count that
will not clear is almost always a server that was unreachable for one request, and it
fixes itself on the next thread open.

**A reply that takes up to eight seconds.** The open thread polls; it does not push. A
message sent by a colleague while you have the thread open appears within
`THREAD_POLL_MS` — or within about three seconds if either of you is mid-exchange, which
is when `threadPollMs` drops the interval — and not at all while the tab is hidden, which
is the same rule the heartbeat follows: a background tab is not somebody reading.

**Three dots that stay up for a moment after they stop.** The indicator is a claim with an
age on it, not an event: the sender re-stamps every 2.5s while characters arrive, and the
server's window is 6s. Stop typing mid-sentence and the dots go out a few seconds later;
send instead and they clear at once. A **stuck** indicator means the watch window is not
being read — not that somebody is still there.

**A thread that stops following and does not jump.** That is rule 5: auto-follow pauses
while somebody is reading history. If it paused and new messages were withheld silently the
pill would say so; if there is no pill, nothing has arrived.

**A circle that keeps its unread mark for a beat.** The marks arrive on the heartbeat,
so opening a thread clears its sender's mark in the rail immediately — Shell passes the
open peer id down and the rail suppresses that one id (`readPeerId`) — while the *rest*
of the rail keeps whatever the last beat said. Closing the panel drops the suppression
and the next beat re-states the truth. Without that suppression a circle would go on
advertising three messages for up to half a minute after they had been read.

**An empty panel on a one-officer station.** The picker says so in words ("There is nobody
else on the station to message") rather than showing an empty box, and the rail draws
nothing at all. Both are correct and neither is a bug.

---

## The views and the container

`src/components/MessagesPanel.jsx` exports six things, and the split is load-bearing:

* `MessagesBoxHead` — the window's title bar, one for all three screens.
* `MessageThreadView`, `ConversationListView`, `ContactPickerView` — **pure**: everything
  they draw arrives as a prop, and none of them fetches.
* `MessageLine`, `TypingLine` — one message, and the three dots that stand in for one being
  written. Both pure, and both exported so a test can render a receipt, a face and a
  typing row without a browser.
* `MessagesPanel` (default) — the container: state, requests, the clock.

Because `renderToString` never runs an effect, a component that fetches **cannot** be
rendered by a test at all. `tests/fixtures/messagesRender.jsx` renders the views for real
and `tests/rules/messagesPanel.test.mjs` reads the markup — including the things that have
actually gone wrong in this project: a hook depending on a value declared below it (which
throws on the first paint and passes every text test), a day heading drawn once per message
instead of once per day, a receipt drawn on the wrong side of the conversation, and a face
drawn on somebody's own sentence.

**What a render still cannot see**, and is therefore checked on the source: whether the
poll's rate is read from a ref rather than depended on, and whether auto-follow is decided
from a ref. Both are effects, and `renderToString` runs neither of them.

---

## Files

| File | What it carries |
|---|---|
| `migrations/015_messages.sql` (+ `.down.sql`) | the `messages` table: sender, recipient, body, `created_at`, `read_at`, and the two covering indexes |
| `migrations/016_message_typing.sql` (+ `.down.sql`) | the typing latch: one row per ordered pair of accounts, and the reasoning for each of its three columns |
| `app/controllers/MessagesController.php` | all six routes, the validation, the `MAX_BODY` limit and the typing window |
| `api/index.php` | the six routes, and `message_unread` on the heartbeat |
| `app/controllers/PresenceController.php` | the heartbeat's unread counts |
| `src/lib/messages.js` | the pure rules: `canSend`, `mergeThread`, `threadRows`, `previewOf`, `unreadFor`, `unreadSum`, `lastSeenLabel`, `receiptOf`, `receiptLabel`, `shouldAnnounceTyping`, `threadPollMs`, `atBottom` |
| `src/components/MessagesPanel.jsx` | the five views and the container |
| `src/components/Avatar.jsx` | the one face in the app, and which of the six gradients an account gets |
| `src/components/Chatheads.jsx` | the unread marks, and the handover on a circle's press |
| `src/components/AppTopBar.jsx` | the bar itself — no messages control since it was removed; the notification bell and the profile pill are what it carries |
| `src/components/Shell.jsx` | the panel's state and the corner it lives in |
| `src/styles.css` | the `--msg-*` and `--bw-face-*` tokens, the window, the bubbles, the composer, the marks |
| `src/dark-theme.css` | the same surfaces after dark — the navy tint, and the one design grey that had to be lifted to be readable |

### Applying it

Run `migrations/015_messages.sql` and then `migrations/016_message_typing.sql` against the
database, and register both in `tests/BaseApiTestCase.php` alongside the others so the
scratch DB the suite uses has the tables. 016 is easy to forget and fails unhelpfully: the
thread read that carries `peer_typing` becomes an unknown-table 500, and the test that
would have noticed is looking at a conversation that never opens.

Then the PHP suite (`php tests/run-tests.php`, against a test server started with
`BLUEWRITE_DB_NAME=bluewrite_test`) and `npm test`.
