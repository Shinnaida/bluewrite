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
// IT SLIDES OUT FOR THE POINTER, AND STAYS OUT FOR A MINUTE. The rail is hidden until
// the pointer touches the right edge of the window, and it is put away a minute after
// the pointer last touched it (`RAIL_DWELL_MS`) rather than the moment it leaves — a
// rail that vanished with the pointer would have to be summoned again to read a name
// out of it. A permanent column of faces over every screen is furniture the station did
// not ask for; the question ("who is on?") is one an officer asks once in a while, and
// a report being read is not the moment to be told about it. What the rail was for is
// unchanged, and so is everything it draws once it is out; what changed is that the
// workspace keeps its right-hand column until somebody reaches for one.
//
// NOTHING IS LOST WITH IT HIDDEN, and that is what makes hiding it acceptable rather
// than just tidier. The unread count an officer actually acts on is on the top bar's
// Messages button (AppTopBar), which is always drawn, always counted and announced as
// "Messages, 2 unread" — the rail's marks are the per-colleague detail of the same
// fact, not the only place it appears. And the rail stays in the TAB ORDER while it is
// invisible: Tab reaches a circle, `:focus-within` opens the rail, and the roster is
// readable without a pointer (see styles.css on why this is opacity and not
// `visibility`).
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
import { api } from '../../lib/api.js';
import {
  HEARTBEAT_MS,
  RAIL_SLOTS,
  ageRoster,
  chatheadTitle,
  railSlots,
  withoutSelf,
} from '../../lib/presence.js';
// How many unread messages one colleague has sent, from the heartbeat's
// `message_unread` — a rule of the same kind as the presence ones, so it lives
// beside them rather than in this file.
import { unreadFor, unreadSum } from '../../lib/messages.js';
import Avatar from '../identity/Avatar.jsx';

/**
 * How often the labels are re-read and the held roster re-aged.
 *
 * Fifteen seconds is finer than anything the labels can show (relativeAge speaks in
 * minutes) and coarse enough that a rail of circles is not re-rendering every
 * second on a screen where nothing is happening. It only matters between beats —
 * the heartbeat itself replaces the whole list.
 */
const TICK_MS = 15000;

/**
 * How close to the right edge of the window the pointer has to come before the rail
 * slides out, in CSS pixels.
 *
 * Measured against the VIEWPORT rather than against the rail, and that is the whole
 * reason the number exists: when the pointer starts moving the rail is not on screen,
 * so there is no box of its own to aim at. Twenty-six pixels is wide enough to hit
 * while aiming at the edge of a 1920px screen, and narrow enough that it is not a
 * strip anybody crosses on the way to something else. (It is deliberately wider than
 * the rail's own 18px inset: the pointer must be able to reach the first circle
 * without ever leaving the band that keeps the rail open.)
 */
const RAIL_EDGE_PX = 26;

/**
 * How long the rail stays out after the pointer last touched the edge or the rail.
 *
 * A MINUTE, because the rail is read rather than used: the question it answers ("who is
 * on?") is answered by looking at it, and the faces, their ages and their unread marks
 * all want more than the second or two a pointer spends on its way past. Closing it the
 * moment the pointer left would mean re-seeking the edge to check a name — and the edge
 * is a gesture somebody has to remember. Standing open for a minute after the last
 * interaction is what makes the rail feel like something that came out, rather than
 * something that has to be held open.
 *
 * The countdown starts again on every interaction, so what expires is a minute of
 * SILENCE, not a minute from the first touch of the edge.
 */
const RAIL_DWELL_MS = 60000;

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
 * `unread` is the heartbeat's own list of {sender_id, count} pairs, and `onOpen` is
 * how a circle hands a colleague over to the messages panel. Both are props for the
 * same reason the roster is: the rail draws, the wrapper fetches.
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
 */
export function ChatheadRail({
  user,
  online,
  elapsedSeconds = 0,
  defaultExpanded = false,
  defaultRevealed = false,
  unread = [],
  openPeerId = null,
  onOpen = NOOP,
}) {
  // EVERYBODY BUT YOU, and before the empty check so that a station with exactly one
  // officer signed in draws nothing at all rather than drawing that officer back to
  // themselves.
  const others = withoutSelf(online, user);

  // THE COLLEAGUE YOU ARE TALKING TO STEPS OUT OF THE RAIL, and this happens BEFORE the
  // cap is applied rather than after: the rail draws five circles, and hiding one of
  // the five would leave a hole where a sixth colleague could have been shown.
  //
  // A non-numeric id hides nobody rather than everybody — a bare `Number(null)` is 0,
  // which is why the null check comes first. Ids are numbers on the wire, so comparing
  // as numbers is enough; nothing here guesses at a string id.
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

  // HIDDEN UNTIL THE POINTER REACHES THE EDGE, and that is a change of idea rather than
  // of style. The rail was drawn over every screen for the whole of a shift so a station
  // with four people in it could be told apart from an empty one — and it answered that,
  // at the price of a column of faces permanently on top of every report, every
  // directory and every audit list, for a question an officer asks occasionally. It is
  // furniture that slides out now, and nothing else about it changed.
  //
  // WHY A LISTENER AND NOT `:hover`. It cannot be `:hover`: while it is hidden the rail
  // takes no pointer events (that is what keeps an invisible column of buttons out of
  // the way of the clicks aimed at the table underneath), and an element that cannot be
  // hit cannot be hovered — so whatever brings it back has to be something that does not
  // depend on the rail's own box. `atEdge` is that. Once the rail IS out it takes pointer
  // events again, and `overRail` is what holds it open through the gap between the edge
  // and the first circle — without it, the move onto a face would drop the rail on the
  // frame that reached it, and the click would land on the table.
  //
  // AND FROM THERE THE MINUTE TAKES OVER. `atEdge` and `overRail` describe where the
  // POINTER is, which is the wrong question to close the rail on: it has been read, not
  // used, and a name read off it should not have to be re-summoned a second later. So
  // both of them only ever ARM the dwell — see `held` and `RAIL_DWELL_MS`.
  //
  // THE SAME SHAPE OF STATE THE RAIL ALREADY USES: `defaultRevealed` mirrors
  // `defaultExpanded` — a render test can put both states on screen, which is the only
  // way to see the revealed markup without a pointer, and nothing about the reveal lives
  // anywhere but here.
  const [atEdge, setAtEdge] = useState(defaultRevealed);
  const [overRail, setOverRail] = useState(false);
  // THE MINUTE IT STAYS OUT (`RAIL_DWELL_MS`), held separately from the two live states
  // because it outlives both: the pointer leaves the edge long before the rail should
  // leave the screen. It is armed by any interaction and disarmed by the one timer, so
  // the only thing that closes the rail is a minute in which nothing touched it.
  const [held, setHeld] = useState(false);
  const revealed = defaultRevealed || atEdge || overRail || held;

  useEffect(() => {
    // A test's rail listens to nothing: the window it would be listening to is the one
    // the runner is in.
    if (defaultRevealed) return undefined;

    // THE BAND STOPS SHORT OF THE SCROLLBAR. `innerWidth` counts the scrollbar and
    // `clientWidth` does not, so this is the last 26px of the CONTENT edge: dragging the
    // page's scrollbar never opens the rail, which matters because reaching for it is
    // an ordinary thing to do. On a platform with overlay scrollbars the two numbers are
    // equal and the band is simply the last 26px of the window — the same gesture, read
    // the only way it can be read there.
    const onMove = (e) => setAtEdge(
      e.clientX >= window.innerWidth - RAIL_EDGE_PX &&
        e.clientX < document.documentElement.clientWidth
    );
    // The pointer can leave the window at the edge, and then no further move event
    // arrives to correct the last one — so leaving the document puts it away too.
    const onLeave = () => setAtEdge(false);
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [defaultRevealed]);

  // THE DWELL, and the whole of it is this effect: anything that touches the rail arms a
  // minute, anything that touches it again re-arms it, and the only way out is the timer
  // firing with nothing holding it open. Written so the timer is re-created rather than
  // kept — the effect re-runs on `held` as well, which is what makes "a minute since the
  // last interaction" the rule instead of "a minute since the first one".
  useEffect(() => {
    // A test's rail has no clock to run down, and `defaultRevealed` is the state it was
    // rendered in.
    if (defaultRevealed) return undefined;
    if (!atEdge && !overRail && !held) return undefined;
    setHeld(true);
    const timer = setTimeout(() => setHeld(false), RAIL_DWELL_MS);
    return () => clearTimeout(timer);
  }, [atEdge, overRail, held, defaultRevealed]);

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
      // `is-revealed` is the whole of the visual state (styles.css): without it the rail
      // is an opacity-zero, unclickable column that still holds its place in the corner.
      className={`dash-chatheads${revealed ? ' is-revealed' : ''}`}
      role="group"
      // Enter and leave rather than over/out, so crossing between two circles does not
      // read as leaving the rail and closing it.
      onPointerEnter={() => setOverRail(true)}
      onPointerLeave={() => setOverRail(false)}
      // The count is what is DRAWN, so it agrees with the circles under it: a rail
      // showing one colleague does not claim two because the second is the one you are
      // already talking to in the box beside it.
      aria-label={`${drawable.length} ${drawable.length === 1 ? 'colleague' : 'colleagues'} online`}
    >
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

export default function Chatheads({ user, onOpen, onUnreadChange, openPeerId = null }) {
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
      unread={unread}
      // Passing the id through is the whole of the handover: the rail says who, the box
      // is where the words go, and there is no state in between that could disagree
      // with what is on screen.
      openPeerId={openPeerId}
      onOpen={(person) => onOpen?.(person)}
    />
  );
}
