// BlueWrite — the presence beat: the one thing that tells the server somebody is
// still at a desk, and the one thing that was missing.
//
// WHY THIS FILE EXISTS AT ALL, and it is worth stating plainly because its absence
// was invisible: every "who is online" surface in this app — the directory's
// Connected now panel, the unread marks, the activity sheet's hours — reads
// `users.last_seen_at`, and the ONLY thing that ever writes that column is
// `POST /presence/heartbeat` (see PresenceController). The rail (`Chatheads.jsx`)
// used to own the beat, and when the rail came off the workspace (Shell) the beat
// went with it: nothing called the route any more, so `last_seen_at` stayed NULL
// for every account and Connected now was empty by construction — not because
// nobody was signed in, but because nobody had ever said they were.
//
// SO THE BEAT HAS A HOME OF ITS OWN NOW, and it is deliberately headless. The
// chassis it used to ride on drew a roster down the right edge; presence is not a
// drawing, and tying it to one means the next layout change takes it away again.
// This component draws nothing at all (`return null`), is mounted once by Shell
// for the life of the signed-in workspace, and does exactly one thing.
//
// WHAT IT MEANS: "at a keyboard", the same meaning the rail gave it. The beat
// stops while the tab is HIDDEN and fires immediately when the tab is looked at
// again — a workspace left in a background tab is not a colleague at a desk, and
// that is a decision, not an optimisation. The cadence is HEARTBEAT_MS, which
// lib/presence.js owns together with the server's window, because the two numbers
// are one promise (four missed beats before a face goes dark).
//
// FAILURE IS SILENT, here for the same reason it is silent in the rail: this is
// chrome, and a station whose LAN hiccups should not be told twice that it cannot
// reach a screen it is not looking at. A failed beat simply means the account ages
// out of everybody's Connected now on the server's own clock, which is the honest
// outcome and needs no message.
//
// ONE CONSEQUENCE WORTH KNOWING: the beat is an authenticated request, and
// `Session::start` refreshes the session's `last_activity` on every request — so an
// open, visible workspace does not idle out. That is the state the rail left the
// app in, and it is recorded as a gap (docs/fixes/officer-role-gaps.md, S-03)
// rather than quietly reintroduced by this file. Fixing it belongs in the session
// layer, not here: the heartbeat must stay a heartbeat.

import { useEffect } from 'react';
import { api } from '../../lib/api.js';
import { HEARTBEAT_MS } from '../../lib/presence.js';

export default function PresenceBeat() {
  useEffect(() => {
    let inFlight = false;

    // ONE BEAT AT A TIME. A slow server plus a 30-second tick would otherwise stack
    // requests whose answers nobody reads, and the last one to land would be the
    // one that stamped the row.
    const beat = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        await api('/presence/heartbeat', { method: 'POST' });
      } catch {
        // Silent on purpose; see the note above.
      } finally {
        inFlight = false;
      }
    };

    // ON MOUNT, not thirty seconds in: an officer who signs in and reads a screen
    // is at a desk from the first second, and a roster that took half a minute to
    // notice would show them to nobody.
    beat();
    const iv = setInterval(beat, HEARTBEAT_MS);
    // Coming back to the tab beats at once rather than waiting out the interval,
    // so the roster is correct on the first frame after it is looked at again.
    const onVisible = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
