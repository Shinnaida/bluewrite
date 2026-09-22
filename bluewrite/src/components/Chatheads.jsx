// BlueWrite — the chatheads: who is at a desk right now, down the right edge.
//
// WHAT THIS IS FOR. Every officer who signs in is invisible to every other officer.
// There is no roster, no "who else is on", and no way to tell a station with four
// people in it from an empty one. This rail is that roster: a circle per signed-in
// account, drawn over whatever screen is open, so it answers "who is here" without
// anybody leaving what they were doing.
//
// WHERE "ONLINE" COMES FROM, and why this file does not decide it. The rail beats:
// POST /presence/heartbeat every thirty seconds, and the answer is the roster the
// SERVER just filtered on the server's own clock. Nothing here compares a timestamp
// against this machine's clock — a station PC's clock is whatever somebody set it
// to. The one thing the client owns is AGEING the list it holds, because a tab that
// loses the server keeps the last roster it was given; that rule is in
// src/lib/presence.js and is tested there.
//
// THE BEAT STOPS WHILE THE TAB IS HIDDEN, and that is a decision rather than an
// optimisation: presence here means "at a keyboard", which is what the station
// wants to know. A minimised window on a locked workstation should go dark after
// the window closes, not sit lit all night, and the officer is not looking at the
// screen anyway. Coming back to the tab beats immediately, so the rail is correct
// on the first frame after it is looked at again.
//
// FAILURE IS SILENT. This is chrome: a rail that cannot be read simply is not
// there, exactly as the bell shows no badge when the feed cannot be read. Reporting
// a connection problem belongs to the screens holding real work — an officer with a
// half-written report does not need a second, decorative complaint about the LAN.
// The one thing it must not do is LIE, which is why the roster it is holding is aged
// against the server's own window instead of being left on screen.
//
// ONE CIRCLE, THREE FACTS AT MOST. The face (a photograph, or the initials from
// lib/profile.js when there is none), the presence dot, and an unread count when one
// is waiting. The name is not drawn: a column of names down the edge of the workspace
// is a sidebar, and this is not one — the name is in the tooltip, in the accessible
// name, and in the head of the conversation a press opens.
//
// IT SHOWS EVERYBODY BUT YOU. The rail is a roster of the people you might be looking
// for, so the session's own account is filtered out of what it DRAWS — see
// `withoutSelf` in lib/presence.js for why that is a drawing rule and not a presence
// one. You are still heartbeating, and still on everybody else's rail.
//
// WHY THERE ARE TWO COMPONENTS HERE AND NOT ONE. `ChatheadRail` below draws a roster
// it is handed; `Chatheads` is the wrapper that fetches it. The split is not tidiness
// — it is the difference between a component that can be tested and one that cannot.
// The drawing is the part that has been wrong before now: a rail that returns null on
// an empty roster paints nothing at all in the first frame, so a crash inside the
// card would show up only AFTER a successful heartbeat, on a screen nobody is
// watching in a test. renderToString never runs an effect, so anything that beats or
// unsubscribes is invisible to a test by construction — but a component that takes
// its roster as a prop renders for real. tests/rules/chatheads.test.mjs renders this
// one and reads the markup, which is the only check that would have caught it.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import {
  HEARTBEAT_MS,
  RAIL_SLOTS,
  ageRoster,
  chatheadTitle,
  railSlots,
  withoutSelf,
} from '../lib/presence.js';
// How many unread messages one colleague has sent, from the heartbeat's
// `message_unread` — a rule of the same kind as the presence ones, so it lives
// beside them rather than in this file.
import { unreadFor, unreadSum } from '../lib/messages.js';
import { MOCK_CHATHEADS } from '../mock-chatheads.js';
import Avatar from './Avatar.jsx';

/**
 * How often the labels are re-read and the held roster re-aged.
 *
 * Fifteen seconds is finer than anything the labels can show (relativeAge speaks in
 * minutes) and coarse enough that a rail of circles is not re-rendering every
 * second on a screen where nothing is happening. It only matters between beats —
 * the heartbeat itself replaces the whole list.
 */
const TICK_MS = 15000;

/** One shared no-op, so a caller that hands the rail nothing gets a stable function
    rather than a new inline one on every render. */
const NOOP = () => {};

/**
 * The rail itself: a roster in, circles out. Pure with respect to everything it
 * shows — no fetch, no clock of its own, and only one piece of state, which is
 * whether the overflow has been unfolded.
 *
 * `elapsedSeconds` is how long ago the roster arrived, and it is passed in rather
 * than read here because ageing a roster is a decision that belongs with the rules
 * in lib/presence.js, not with the drawing.
 *
 * `preview` swaps the roster for the invented one in src/mock-chatheads.js. It is a
 * PROP all the way down — read once by Shell and passed here and to the messages
 * panel — because it now decides two surfaces' worth of behaviour, and a flag read
 * separately in each is how they end up disagreeing about whether the officers on
 * screen are real.
 *
 * `unread` is the heartbeat's own list of {sender_id, count} pairs, and `onOpen` is
 * how a circle hands a colleague over to the messages panel. Both are props for the
 * same reason `preview` is: the rail draws, the wrapper fetches.
 *
 * CLICKING A CIRCLE OPENS THE CONVERSATION. There used to be an officer card in
 * between — press the face, read a panel of facts, then press a Message button in it
 * — and it was two clicks to reach the thing the circle exists for. The card is gone;
 * everything it was carrying is in the thread head (name, role, badge) or in this
 * circle's own tooltip, and what was left over, the idle line, was a value that goes
 * stale the moment the panel opens it and the panel has no clock of its own.
 *
 * `openPeerId` is the colleague whose conversation is on screen right now, if any, and
 * it takes their CIRCLE off the rail while the box is open. Two things follow from that
 * one rule and neither needs saying twice: a face you are already talking to is not
 * somebody you are still looking for, and the unread mark it may have been wearing
 * goes with it. The press it would take would do nothing the open box is not already
 * doing.
 *
 * Nothing is stored, and nothing is "read": the rail is handed the id of the open
 * conversation and draws the roster without it. Close the box and the prop goes null,
 * the face is back in its slot, and the next heartbeat re-states whatever marks are
 * still true — which is what makes this self-correcting rather than a cache.
 *
 * IN PREVIEW A CIRCLE OPENS A PREVIEW CONVERSATION, and that is not the same thing as
 * a broken one. The first attempt at this made the mock faces plain marks — not
 * controls at all — which left the primary interaction of the whole feature untestable
 * on the machine it is most often looked at from. The panel draws an invented
 * conversation for these ids instead, marked as a preview, and nothing in it reaches
 * the server (see mockThreadFor in src/mock-chatheads.js). The rail does not know or
 * care which kind of peer it is handing over: it hands over an id, and the panel is
 * the thing that knows what to do with it.
 */
export function ChatheadRail({
  user,
  online,
  elapsedSeconds = 0,
  preview = false,
  defaultExpanded = false,
  unread = [],
  openPeerId = null,
  onOpen = NOOP,
}) {
  // EVERYBODY BUT YOU, and before the empty check so that a station with exactly one
  // officer signed in draws nothing at all rather than drawing that officer back to
  // themselves. Mock ids are far above any real id, so this filters nothing in
  // preview mode and the two paths do not need to differ.
  const others = withoutSelf(preview ? MOCK_CHATHEADS : online, user);

  // THE COLLEAGUE YOU ARE TALKING TO STEPS OUT OF THE RAIL, and this happens BEFORE the
  // cap is applied rather than after: the rail draws five circles, and hiding one of
  // the five would leave a hole where a sixth colleague could have been shown.
  //
  // A non-numeric id hides nobody rather than everybody — a bare `Number(null)` is 0,
  // which is why the null check comes first. Ids are numbers on the wire and in the
  // mock, so comparing as numbers is enough; nothing here guesses at a string id.
  const talkingTo = openPeerId === null || openPeerId === undefined || !Number.isFinite(Number(openPeerId))
    ? null
    : Number(openPeerId);
  const drawable = talkingTo === null ? others : others.filter((person) => person.id !== talkingTo);

  // HOW MANY CIRCLES THIS RAIL DRAWS, and the state that overrides it. Closed by
  // default: the corner holds one column and says so with a "+N"; pressing that chip
  // is what turns the rail into the full list. `defaultExpanded` exists so a render
  // test can see both states — the rail is otherwise the only place this choice
  // lives, and a click is not something a static render can perform.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { shown, hidden } = railSlots(drawable, expanded ? Number.POSITIVE_INFINITY : RAIL_SLOTS);

  // NOBODY ELSE ONLINE, NOTHING DRAWN. An empty rail — a floating sliver with no
  // circles in it — would be a permanent occupant of the screen edge for a station
  // that is empty, which is most of the night (and for the officer who is the only
  // one signed in, which is the common case).
  //
  // Read on `drawable`, so this is also what happens on a two-officer station while a
  // conversation with the other one is open: the rail is not an empty frame beside the
  // box, it is simply not there.
  if (drawable.length === 0) return null;

  return (
    <div
      className={`dash-chatheads${preview ? ' is-preview' : ''}`}
      role="group"
      // The count is what is DRAWN, so it agrees with the circles under it: a rail
      // showing one colleague does not claim two because the second is the one you are
      // already talking to in the box beside it.
      aria-label={
        preview
          ? `Preview: ${drawable.length} mock colleagues, not real presence`
          : `${drawable.length} ${drawable.length === 1 ? 'colleague' : 'colleagues'} online`
      }
    >
      {/* NO CAPTION ABOVE THE CIRCLES. There was one — "Preview — mock officers and
          mock conversations, not real presence" — and it was removed by request, but it
          is worth recording that it was also broken: an absolutely positioned child of
          the rail has a containing block only as wide as a circle, so `max-width` never
          applied and the sentence wrapped into a tall narrow column. It could not have
          been made to read well there.

          THE PREVIEW IS STILL MARKED, in the three places that can carry it honestly:
          a dashed ring on every invented face (styles.css), so a CROP of a screenshot
          still says what it is; the group's accessible name below; and the note above
          the composer in an invented conversation, which is the one place it has to be
          read to stop somebody typing into nothing. What is gone is the on-screen hint
          at how to reach the live rail — that lives in docs/PRESENCE.md now. */}
      <ul className="dash-chatheads__list">
        {shown.map((person) => {
          const waiting = unreadFor(unread, person.id);
          // The count is part of the accessible name, not an aria-hidden badge: a
          // screen reader hears the circle announced, and "has sent you two unread
          // messages" is half of what makes it worth pressing.
          const title = waiting > 0
            ? `${chatheadTitle(person, elapsedSeconds)} — ${waiting} unread ${waiting === 1 ? 'message' : 'messages'}`
            : chatheadTitle(person, elapsedSeconds);

          return (
            <li key={person.id} className="dash-chatheads__slot">
              <button
                type="button"
                className={`dash-chathead${waiting > 0 ? ' has-unread' : ''}`}
                // The same sentence a screen reader gets as the pointer does: a
                // circle of two letters announces nothing on its own.
                aria-label={title}
                title={title}
                onClick={() => onOpen(person)}
              >
                <Avatar user={person} className="dash-chathead__face" />
                <span className="dash-chathead__dot" aria-hidden="true" />
                {/* THE UNREAD MARK, opposite the presence dot so the two facts do
                    not share a corner. Capped at 9+: this is a hint that there is
                    something to read, not a counter — an exact 47 in a 22px circle
                    is unreadable at the size it is drawn. */}
                {waiting > 0 && (
                  <span className="dash-chathead__unread" aria-hidden="true">
                    {waiting > 9 ? '9+' : waiting}
                  </span>
                )}
              </button>
            </li>
          );
        })}

        {/* THE "+N" CHIP: the one thing on this rail that is not a person.
            A circle, so it belongs to the column, and deliberately not a face — no
            photograph, no initials, no presence dot, and the ink of a hint rather
            than of a colleague. It is a real button because "there are more" is
            useless without "show me them", and it sits at the END of the drawn
            list in both states, so the control that opened the list is the one that
            closes it and it never moves to a different place on screen. */}
        {hidden > 0 && (
          <li className="dash-chatheads__slot">
            <button
              type="button"
              className="dash-chathead dash-chathead--more"
              aria-expanded={false}
              aria-label={`Show ${hidden} more ${hidden === 1 ? 'colleague' : 'colleagues'}`}
              title={`${hidden} more online`}
              onClick={() => setExpanded(true)}
            >
              <span className="dash-chathead__more">{`+${hidden}`}</span>
            </button>
          </li>
        )}
        {expanded && drawable.length > RAIL_SLOTS && (
          <li className="dash-chatheads__slot">
            <button
              type="button"
              className="dash-chathead dash-chathead--more"
              aria-expanded
              aria-label="Show fewer colleagues"
              title="Show fewer"
              onClick={() => setExpanded(false)}
            >
              <span className="dash-chathead__more" aria-hidden="true">
                −
              </span>
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

export default function Chatheads({ user, preview = false, onOpen, onUnreadChange, openPeerId = null }) {
  // The last answer from the server: the roster, the window it was filtered by, and
  // when it arrived. `at` is what lets the rail age the list it is holding.
  const [presence, setPresence] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // THE UNREAD MARKS RIDE ON THE BEAT, deliberately. They mark the same faces, on
  // the same clock, from the same request — a second poll would be a second answer
  // to "who has sent me something", and the two would eventually disagree on screen
  // about the same colleague.
  //
  // Read into state rather than into `presence` because they are not aged: a
  // roster entry can go stale and has to be dropped, but a message that is waiting
  // is waiting until somebody reads it. The heartbeat re-states them every beat, and
  // the panel reports a new total the moment a thread is opened.
  const [unread, setUnread] = useState([]);

  // Held in a ref and read through `applyRef` inside the beat, so that a caller
  // handing a NEW `onUnreadChange` (an inline arrow is the obvious way to write one)
  // cannot restart the heartbeat: the effect below beats on mount and its own
  // interval is the only thing allowed to fire it again.
  const applyUnread = useCallback(
    (list) => {
      setUnread(Array.isArray(list) ? list : []);
      onUnreadChange?.(unreadSum(list));
    },
    [onUnreadChange]
  );
  const applyRef = useRef(applyUnread);
  useEffect(() => {
    applyRef.current = applyUnread;
  }, [applyUnread]);

  // `preview` arrives already decided — see Shell, which reads the URL against
  // `import.meta.env.DEV` once and hands the answer to the rail and to the messages
  // panel so the two cannot disagree about whether the officers on screen are real.

  // THE BEAT. Fired once on mount — an officer who signs in and does nothing else
  // is online from the first second, not from thirty seconds in.
  useEffect(() => {
    let alive = true;
    let inFlight = false;

    const beat = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await api('/presence/heartbeat', { method: 'POST' });
        if (!alive) return;
        setPresence({
          online: Array.isArray(data?.online) ? data.online : [],
          windowSeconds: Number(data?.window_seconds) || 0,
          at: Date.now(),
        });
        applyRef.current(data?.message_unread);
      } catch {
        // Quiet on purpose: see the note at the top. The roster already held is
        // aged out by the ticker below, so a server that has gone away empties the
        // rail instead of freezing it.
      } finally {
        inFlight = false;
      }
    };

    const onVisible = () => {
      if (!document.hidden) beat();
    };

    beat();
    const iv = setInterval(() => {
      if (!document.hidden) beat();
    }, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // The ticker: ages the held roster and re-reads the "active 2m ago" labels. It
  // runs whether or not a beat is arriving, because those are two different things —
  // and it is the only thing keeping a stale rail honest.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(iv);
  }, []);

  const elapsed = presence ? Math.max(0, Math.round((now - presence.at) / 1000)) : 0;
  const online = useMemo(
    () => ageRoster(presence?.online, elapsed, presence?.windowSeconds),
    [presence, elapsed]
  );

  return (
    <ChatheadRail
      user={user}
      online={online}
      elapsedSeconds={elapsed}
      preview={preview}
      unread={unread}
      // Passing the id through is the whole of the handover: the rail says who, the box
      // is where the words go, and there is no state in between that could disagree
      // with what is on screen.
      openPeerId={openPeerId}
      onOpen={(person) => onOpen?.(person)}
    />
  );
}
