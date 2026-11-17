import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { SNAPSHOT_MS, applySnapshot } from '../lib/presence.js';
import { actionLabel } from './UserProfileView.jsx';
import './ConnectionHub.css';

/**
 * ConnectionHub — who is on the station right now, drawn as PCs on rings
 * around the station server. Each signed-in account is a workstation in its
 * role ink (blue PC for an Admin, gold PC for an Officer), and the list
 * under the drawing names them.
 *
 * "Connected" means the server saw the account active within ACTIVE_WINDOW_MS
 * (`users.last_seen_at`, refreshed every thirty seconds by PresenceBeat). It is a
 * presence signal, not a shift record.
 *
 * THE PANEL IS NOT ON THE DASHBOARD ANY MORE. It was, and the Dashboard is read for
 * a different question (the register's volume and state) by an administrator who is
 * not asking who is at a desk. It lives inside User Management now, behind the
 * toggle in that screen's toolbar — the screen an administrator already opens to
 * reason about accounts — and it is mounted only while the toggle is on, so a
 * closed panel costs no polling.
 *
 * A LIST HANDED IN IS NOT POLLED. `users` (the prop) is the whole of the render
 * test's view of this component: it is not fetched, not re-fetched, and the
 * five-minute window below is applied to it exactly as it is applied to the
 * directory this component reads for itself. `renderToString` never runs an
 * effect, which is why the drawing has to be reachable without one.
 *
 * EVERY NODE OPENS THE SAME DOOR. A workstation — on the drawing or in the
 * list — selects its account and opens the live desk panel: who they are,
 * whether they are composing, and their fresh trail activity, re-read while
 * it is open. What it never shows is their screen: there is no screen-sharing
 * in this app, and the panel says so, so "live" is never misread as watching.
 */

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
/** The same window, in words, for the empty state's sentence. */
const ACTIVE_WINDOW_WORDS = 'five minutes';
const MAX_NODES = 8;
const VIEW = { w: 700, h: 240 };
const HUB = { x: VIEW.w / 2, y: VIEW.h / 2 };
/** How far the nodes sit from the hub, as a share of the view box. */
const ORBIT = { x: 0.36, y: 0.30 };
const NODE_R = 20;
/** The rings drawn around the hub, in user units. */
const RINGS = [62, 104, 146];


function parseStamp(value) {
  if (!value) return null;
  const t = new Date(String(value).replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Workstation desks, scattered — not marched around the hub. Each account rolls
 * its own angle and radius from its id, so the scatter looks random but a desk
 * never moves between re-renders: the window tick below must not reshuffle the
 * room every thirty seconds. The jitter stays inside a band that keeps every
 * node on the view box with its label under it. */
function positionFor(index, count, id) {
  let h = (Number(id) || index + 1) >>> 0 || 1;
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const base = ((Math.PI * 2 * index) / Math.max(count, 1)) - Math.PI / 2;
  const angle = base + (rand() - 0.5) * 0.9;
  const rx = VIEW.w * ORBIT.x + (rand() - 0.5) * 90;
  const ry = VIEW.h * ORBIT.y + (rand() - 0.5) * 30;
  return {
    x: HUB.x + Math.cos(angle) * rx,
    y: HUB.y + Math.sin(angle) * ry,
  };
}

/** A name to draw on a node: the first word, which is what fits under a circle. */
function firstName(user) {
  return String(user.full_name || user.username || '?').trim().split(/\s+/)[0] || '?';
}

/** Initials for the list, the same one-or-two letters the rest of the app uses. */
function initials(user) {
  const parts = String(user.full_name || user.username || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * THE NODE'S INK, read off the account's role: blue for an Admin, gold for an
 * Officer, the neutral ring for anything else. One home for it, so the drawing
 * and the roster below cannot disagree about what a role wears — and
 * the legend reads from this same pair.
 */
function roleInk(u) {
  if (u.role === 'Admin') return 'is-admin';
  if (u.role === 'Officer') return 'is-officer';
  return '';
}

/**
 * How long ago an account was seen, read from the stamp the directory sent.
 *
 * THE CLIENT'S CLOCK IS ALREADY IN CHARGE OF THE WINDOW ABOVE, so this labels the
 * same number that decided the account is connected rather than introducing a second
 * source of truth — the alternative, printing the raw stamp, is a column of SQL
 * timestamps on a panel whose whole question is "now". The exact stamp the server
 * wrote stays on the row's `title`, so the label never stands in for the record.
 */
function seenLabel(seen, now) {
  const seconds = Math.max(0, Math.round((now - seen) / 1000));
  if (seconds < 45) return 'active now';
  const minutes = Math.round(seconds / 60);
  return `active ${minutes}m ago`;
}

/**
 * DOING A REPORT RIGHT NOW. The directory carries the trail's latest
 * report-composing stamp per account (`last_report_write_at`, written by
 * UsersController::index), and the same five-minute window as presence
 * decides whether it still counts — a stamp the next poll has not refreshed
 * ages out on its own, so a finished report stops glowing without anyone
 * clearing it.
 */
function writingNow(user, now) {
  // The latch first: somebody mid-sentence shows at once, without waiting for
  // a save to reach the trail. The server already expired it — a fresh stamp
  // is the whole of what the board needs, and no clock on this side is read.
  if (user.composing_report_id !== null && user.composing_report_id !== undefined) return true;
  if (user.last_report_write_at == null) return false;
  const t = parseStamp(user.last_report_write_at);
  return t !== null && now - t <= ACTIVE_WINDOW_MS;
}

export default function ConnectionHub({ users: usersProp }) {
  // When no list is handed in (User Management), read the directory itself and
  // refresh it every 30 seconds — the same cadence as the beat that keeps the
  // stamps in it fresh. A failed refresh keeps the last list on screen rather than
  // blanking the drawing, and the next tick tries again.
  const [fetched, setFetched] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  // What the last full read left. The live tick below merges into THIS, never
  // a stale copy closed over by the interval — so a badge arriving mid-minute
  // cannot clobber a name, a role or a face a slower read is still carrying.
  const rowsRef = useRef([]);
  const take = (rows) => {
    rowsRef.current = Array.isArray(rows) ? rows : [];
    setFetched(rowsRef.current);
  };
  useEffect(() => {
    if (usersProp) return undefined;
    let live = true;
    const load = async () => {
      try {
        const data = await api('/users');
        if (live) take(data.users ?? []);
      } catch {
        // Keep the last list; the next 30-second tick tries again.
      }
    };
    // THE LIVE TICK. Every few seconds the board asks the snapshot — who is
    // connected, who is composing — and folds it into the rows on screen.
    // Names and faces still come from the thirty-second read; but an id the
    // snapshot shows that these rows have never seen means somebody new, and
    // only a full read can introduce them, so the tick triggers that instead
    // of drawing a badge on a stranger.
    const snap = async () => {
      try {
        const data = await api('/presence/snapshot');
        if (!live) return;
        const { rows, changed, hasNew } = applySnapshot(rowsRef.current, data.online);
        if (hasNew) load();
        else if (changed) take(rows);
      } catch {
        // Silent: the thirty-second read is the backstop, and a live signal
        // that failed to arrive is not a fact anybody needs told.
      }
    };
    load();
    snap();
    const id = setInterval(load, 30000);
    const snapId = setInterval(snap, SNAPSHOT_MS);
    // A desk that signs in between ticks should not wait out the clock: coming
    // back to the tab re-reads at once, the way the beat itself does.
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearInterval(id);
      clearInterval(snapId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [usersProp]);
  const users = usersProp ?? fetched;

  // Re-check the window every 30 seconds so an account drops out on its own.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const active = users
    .filter((u) => u.status === 'active')
    .map((u) => ({ ...u, seen: parseStamp(u.last_seen_at) }))
    .filter((u) => u.seen !== null && now - u.seen <= ACTIVE_WINDOW_MS)
    .sort((a, b) => b.seen - a.seen);

  const shown = active.slice(0, MAX_NODES);
  const extra = active.length - shown.length;
  const countText = active.length === 0 ? 'No one signed in' : `${active.length} signed in`;

  // THE OPEN DESK. An id, not a copy: the rows keep refreshing under the
  // panel, so the panel always reads the newest row for its account — a
  // captured copy would keep showing the minute the panel was opened. The
  // `seen` stamp lives on the active slice, so the panel reads that first
  // and falls back to the directory row (for a desk that signed out with
  // the drawer open).
  const [selectedId, setSelectedId] = useState(null);
  const selectedActive = selectedId === null
    ? null
    : active.find((u) => Number(u.id) === Number(selectedId)) ?? null;
  const selected = selectedActive
    ?? (selectedId === null ? null : users.find((u) => Number(u.id) === Number(selectedId)) ?? null);
  const selectedSeen = selectedActive?.seen ?? (selected ? parseStamp(selected.last_seen_at) : null);
  function toggleSelected(id) {
    setSelectedId((cur) => (cur !== null && Number(cur) === Number(id) ? null : id));
  }
  function onTriggerKey(e, id) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSelected(id);
    }
  }
  // Escape closes the desk from anywhere inside the panel.
  useEffect(() => {
    if (selectedId === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // Every workstation's geometry, computed once: the string, the node and the
  // packet below all read the same endpoints, so the three can never drift
  // apart the way three copies of the same trigonometry would.
  const placed = shown.map((u, i) => {
    const p = positionFor(i, shown.length, u.id);
    const dx = p.x - HUB.x;
    const dy = p.y - HUB.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    return {
      u,
      p,
      x1: HUB.x + ux * 26,
      y1: HUB.y + uy * 26,
      x2: p.x - ux * 24,
      y2: p.y - uy * 24,
    };
  });

  return (
    <section className="conn-hub" aria-labelledby="conn-hub-title">
      <div className="conn-hub__head">
        <div className="conn-hub__heading">
          <span className="conn-hub__eyebrow">Live presence</span>
          <h2 id="conn-hub-title">Connected <span className="conn-hub__now">now</span></h2>
          <p className="conn-hub__sub">Real-time view of all active users in the system.</p>
        </div>
        <span className={`conn-hub__count${active.length === 0 ? ' is-empty' : ''}`}>
          <svg className="conn-hub__count-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          {countText}
          <span className="conn-hub__count-dot" aria-hidden="true" />
        </span>
      </div>

      {/* THE LEGEND. The drawing's ink is a code — blue for an Admin, gold for an
          Officer — and a code without its key is decoration. Two swatches, no
          counts: the pill above already says how many are on. */}
      <ul className="conn-hub__legend" aria-label="Role colours">
        <li><span className="conn-hub__swatch is-admin" aria-hidden="true" />Admin</li>
        <li><span className="conn-hub__swatch is-officer" aria-hidden="true" />Officer</li>
      </ul>

      {/* THE STAGE IS WHAT FRAMES THE DRAWING. The panel is as wide as the directory
          table and the drawing is not: left to fill that width the rings and labels
          would either float in a band of empty panel or be scaled past their own
          weight, so the stage paints the ground it sits on and caps it (see the CSS). */}
      <div className="conn-hub__stage">
      <svg
        className="conn-hub__svg"
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        role="img"
        aria-label={active.length === 0
          ? 'No one is signed in'
          : `${active.length} signed in: ${shown.map((u) => `${u.full_name || u.username}${writingNow(u, now) ? ' (writing a report)' : ''}`).join(', ')}${extra > 0 ? `, and ${extra} more` : ''}`}
      >
        {/* The rings are the drawing's floor: they say where the centre is before
            anybody is on it, so the empty state is a hub with room around it rather
            than a lone circle in a panel. */}
        <g className="conn-hub__rings" aria-hidden="true">
          {RINGS.map((r) => (
            <circle key={r} className="conn-hub__ring" cx={HUB.x} cy={HUB.y} r={r} />
          ))}
          {/* THE SERVER'S HEARTBEAT: one ping leaves the hub, swells to the
              first ring and dissolves there — the room reads as listened-to
              even before anybody signs in. Purely decorative (see the CSS for
              the motion, and the reduced-motion rule that stills it). */}
          <circle className="conn-hub__ping" cx={HUB.x} cy={HUB.y} r={30} />
        </g>


        {/* NO ORBIT RING (owner request): the dashed ellipse read as another
            broken line, so the rings alone floor the drawing. */}
        {/* CONNECTED STRINGS (owner request): each workstation is strung to the
            server by a solid hairline in its role ink — solid, not dashed, so it
            reads as a live link and never as a broken wire. Trimmed at both ends
            so it slips under the server and the PC instead of poking through. */}
        <g className="conn-hub__links" aria-hidden="true">
          {placed.map(({ u, x1, y1, x2, y2 }) => (
            <line
              key={`link-${u.id}`}
              className={`conn-hub__link${roleInk(u) ? ` ${roleInk(u)}` : ''}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
            />
          ))}
        </g>
        {/* PACKETS ON THE STRINGS: a bead of role ink travels each link from
            the workstation into the server and dissolves there — the line
            itself stays solid (never dashed, never a broken wire) while the
            motion says which way the data flows. Staggered around one shared
            2.4-second clock, the same clock as the blinking dots elsewhere. */}
        <g className="conn-hub__packets" aria-hidden="true">
          {placed.map(({ u, x1, y1, x2, y2 }, i) => (
            <g key={`packet-${u.id}`} transform={`translate(${x2} ${y2})`}>
              <circle
                className={`conn-hub__packet${roleInk(u) ? ` ${roleInk(u)}` : ''}`}
                r={3}
                style={{
                  offsetPath: `path("M 0 0 L ${(x1 - x2).toFixed(1)} ${(y1 - y2).toFixed(1)}")`,
                  animationDelay: `${(-(i * 0.6)).toFixed(2)}s`,
                }}
              />
            </g>
          ))}
        </g>
        {placed.map(({ u, p }) => {
          const writing = writingNow(u, now);
          const isOpen = selectedId !== null && Number(selectedId) === Number(u.id);
          return (
            <g key={`node-${u.id}`} className={`conn-hub__node${roleInk(u) ? ` ${roleInk(u)}` : ''}${writing ? ' is-writing' : ''}${isOpen ? ' is-selected' : ''}`} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0} aria-label={`Show live activity for ${u.full_name || u.username}`} onClick={() => toggleSelected(u.id)} onKeyDown={(e) => onTriggerKey(e, u.id)}>
              {/* A workstation, not a face: the initials ride the monitor glass and
                  the role ink paints the shell — blue PC for an Admin, gold PC for
                  an Officer. The directory and the account page draw real faces. */}
              <circle className="conn-hub__node-halo" r={NODE_R + 5} />
              <g className="conn-hub__pc-float">
                <rect className="conn-hub__pc-screen" x="-17" y="-16" width="34" height="24" rx="4" />
                <rect className="conn-hub__pc-glass" x="-13.5" y="-12.5" width="27" height="12" rx="2" />
                <text className="conn-hub__pc-user" y="-3" textAnchor="middle">{initials(u)}</text>
                <rect className="conn-hub__pc-neck" x="-2.5" y="8" width="5" height="5" />
                <rect className="conn-hub__pc-base" x="-10" y="13" width="20" height="3.5" rx="1.75" />
                <text className="conn-hub__label" y="40" textAnchor="middle">{firstName(u)}</text>
              </g>
                {/* THE WRITING BADGE: a navy pen bubble pinned to the monitor's
                    corner, ringed by an amber ping while the trail says this desk
                    is composing. The group is hidden from the reader because the
                    svg's own label already says who is writing. */}
                {writing && (
                  <g className="conn-hub__node-write" aria-hidden="true" transform="translate(15 -17)">
                    <circle className="conn-hub__write-ping" r={8} />
                    <circle className="conn-hub__write-bubble" r={8} />
                    <g className="conn-hub__write-pen" transform="translate(-4.4 -4.4) scale(0.37)">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
                    </g>
                  </g>
                )}
            </g>
          );
        })}

        {/* THE CENTRE IS THE STATION SERVER: a rack chassis with three drive bays
            and live LEDs, wearing the office's name on its glass tag. Every
            workstation on the rings reports to this box. */}
        <g className="conn-hub__core" transform={`translate(${HUB.x} ${HUB.y})`}>
          <ellipse className="conn-hub__server-shadow" cx="0" cy="23" rx="20" ry="3.5" />
          <rect className="conn-hub__server" x="-15" y="-21" width="30" height="42" rx="6" />
          <rect className="conn-hub__server-bay" x="-10" y="-15" width="20" height="5" rx="2.5" />
          <rect className="conn-hub__server-bay" x="-10" y="-7" width="20" height="5" rx="2.5" />
          <rect className="conn-hub__server-bay" x="-10" y="1" width="20" height="5" rx="2.5" />
          <circle className="conn-hub__server-led is-on" cx="6.5" cy="-12.5" r="1.7" />
          <circle className="conn-hub__server-led is-on is-alt" cx="6.5" cy="-4.5" r="1.7" />
          <circle className="conn-hub__server-led is-warn" cx="6.5" cy="3.5" r="1.7" />
        </g>
      </svg>
      </div>

      {active.length > 0 ? (
        <ul className="conn-hub__roster">
          {shown.map((u) => (
            <li key={u.id} className="conn-hub__person" role="button" tabIndex={0} aria-pressed={selectedId !== null && Number(selectedId) === Number(u.id)} aria-label={`Show live activity for ${u.full_name || u.username}`} title="Show live activity" onClick={() => toggleSelected(u.id)} onKeyDown={(e) => onTriggerKey(e, u.id)}>
              <span className={`conn-hub__avatar${roleInk(u) ? ` ${roleInk(u)}` : ''}`} aria-hidden="true">{initials(u)}</span>
              <span className="conn-hub__who">
                <span className="conn-hub__name">{u.full_name || u.username}</span>
                {u.role ? <span className="conn-hub__role">{u.role}</span> : null}
              </span>
              {/* A composing desk says what it is doing, not just that it was
                  seen: the pill turns amber and names the work while the window
                  holds, then falls back to the idle label on its own. */}
              <span className={`conn-hub__seen${writingNow(u, now) ? ' is-writing' : ''}`} title={u.last_seen_at ? `Server time of last activity: ${u.last_seen_at}` : undefined}>
                <span className="conn-hub__seen-dot" aria-hidden="true" />
                {writingNow(u, now) ? 'writing a report\u2026' : seenLabel(u.seen, now)}
              </span>
            </li>
          ))}
          {extra > 0 && (
            <li className="conn-hub__person conn-hub__person--more">
              <span className="conn-hub__avatar" aria-hidden="true">+{extra}</span>
              <span className="conn-hub__who">
                <span className="conn-hub__name">and {extra} more</span>
                <span className="conn-hub__role">on the station</span>
              </span>
            </li>
          )}
        </ul>
      ) : (
        <p className="conn-hub__empty">
          Nobody has been active in the last {ACTIVE_WINDOW_WORDS}. A workspace reports in from the
          moment it is signed in, whenever its tab is on screen.
        </p>
      )}
      {selected && (
        <LiveDeskPanel
          user={selected}
          writing={writingNow(selected, now)}
          seenText={selectedSeen != null ? seenLabel(selectedSeen, now) : 'not seen recently'}
          now={now}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}

/**
 * The timeline dot's ink, read off the action's family: violet for the
 * assistant's working, blue for report acts, green for sessions, amber for
 * account changes. Unknown codes take no ink rather than a wrong one.
 */
function trailKind(action) {
  const code = String(action ?? '');
  if (code.startsWith('ai.') || code.startsWith('ocr.')) return 'is-ai';
  if (code.startsWith('report.')) return 'is-report';
  if (code === 'logout' || code.startsWith('login') || code.startsWith('mfa.')) return 'is-session';
  if (code.startsWith('user.') || code.startsWith('account.') || code.startsWith('device.')) return 'is-account';
  return '';
}

/**
 * THE TRAIL'S GLYPHS, one per family — trailKind's four inks, drawn instead of
 * dotted so a row is readable before it is read: a door for a session, a page
 * for a report, a person for an account, a spark for the assistant, a pulse for
 * anything else. Inline paths on the app's 24-unit grid, like every other
 * drawing in the product: the station's LAN has no internet, so a glyph is a
 * path or it is nothing.
 */
const TRAIL_GLYPHS = {
  'is-session': [
    'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4',
    'M10 17l5-5-5-5',
    'M15 12H3',
  ],
  'is-report': [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    'M14 2v6h6',
    'M9 13h6',
    'M9 17h4',
  ],
  'is-account': [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
  ],
  'is-ai': ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z'],
  '': ['M22 12h-4l-3 9L9 3l-3 9H2'],
};

function TrailGlyph({ action }) {
  const paths = TRAIL_GLYPHS[trailKind(action)] ?? TRAIL_GLYPHS[''];
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * THE TRAIL'S STAMP, READ WITHOUT A CLOCK. Audit rows arrive as the server's own
 * `YYYY-MM-DD HH:MM:SS` string. The drawer shows the DATE as a group heading and
 * the CLOCK on the row — both sliced out of that string rather than parsed and
 * reformatted, because parsing turns a recorded station time into whatever
 * timezone the browser happens to be in. What was written is what is read.
 */
function stampParts(value) {
  const s = String(value ?? '');
  return { day: s.slice(0, 10), time: s.slice(11, 16) };
}

/**
 * Today / Yesterday / the date itself.
 *
 * THE COMPARISON IS THE STATION'S DAY, not the browser's: the stamps this
 * compares against were written by the station server, and an administrator
 * reading the panel over a remote session from another timezone must not be told
 * that this morning's sign-in happened "Yesterday". Naga City keeps one timezone
 * all year, so a day here is a plain 24 hours back.
 */
const STATION_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function dayLabel(day, now = new Date()) {
  if (!day) return 'Earlier';
  if (day === STATION_DAY.format(now)) return 'Today';
  if (day === STATION_DAY.format(new Date(now.getTime() - 86400000))) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(y, m - 1, d));
}

/**
 * The trail in day runs. Ten entries are usually one day, but a drawer opened on
 * a Monday morning hands back Sunday too — and a column of repeated dates is not
 * how a ledger says "yesterday". Order is the server's (newest first), and a run
 * is broken only when the DAY changes, so nothing is re-sorted here.
 */
function groupByDay(events) {
  const groups = [];
  for (const a of Array.isArray(events) ? events : []) {
    const day = stampParts(a.created_at).day;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(a);
    else groups.push({ day, label: dayLabel(day), items: [a] });
  }
  return groups;
}

/* How often the open desk re-reads its account's trail: brisk enough that a
   save lands in the panel while the pen badge is still warm, calm enough that
   an open drawer is not a second snapshot tick. Best-effort and silent, like
   every other live read here. */
const LIVE_ACTIVITY_MS = 8000;
const LIVE_ACTIVITY_COUNT = 10;

/**
 * The open desk: one account's live working, in a side panel.
 *
 * WHAT "LIVE" MEANS HERE, stated on the panel itself: fresh system activity —
 * composing state plus the newest audit-trail entries, re-read while the drawer
 * is open — and never the colleague's screen. `user` is the live row from the
 * board above (never a copy), so presence and composing stay true without a
 * second snapshot read; only the trail is fetched, on open and on the tick.
 */
function LiveDeskPanel({ user, writing, seenText, now, onClose }) {
  const [events, setEvents] = useState(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  // The report on their desk: the full view once (logged, like any opening),
  // then silent excerpt ticks (liveness, not access).
  const [preview, setPreview] = useState(null);
  const [liveReport, setLiveReport] = useState(null);
  const titleRef = useRef(null);
  const name = user.full_name || user.username || 'Signed-in account';
  const composingId = user.composing_report_id ?? null;
  useEffect(() => {
    titleRef.current?.focus?.();
  }, []);

  // A newly opened report is a view like any other: it goes through printData
  // once, which logs it on the trail, and the ticks below only refresh it.
  useEffect(() => {
    if (composingId == null) {
      setPreview(null);
      return undefined;
    }
    let live = true;
    setPreview(null);
    api(`/reports/${composingId}/print`)
      .then((data) => {
        if (live) setPreview(data.report ?? false);
      })
      .catch(() => {
        if (live) setPreview(false);
      });
    return () => {
      live = false;
    };
  }, [composingId]);

  useEffect(() => {
    let live = true;
    setEvents(null);
    setFailed(false);
    setLiveReport(null);
    const read = async () => {
      try {
        const jobs = [api(`/audits?user_id=${user.id}&per_page=${LIVE_ACTIVITY_COUNT}`)];
        if (composingId != null) jobs.push(api(`/reports/${composingId}/live`).catch(() => null));
        const [trail, peek] = await Promise.all(jobs);
        if (!live) return;
        setEvents(Array.isArray(trail.audits) ? trail.audits : []);
        setFailed(false);
        if (peek && peek.report) setLiveReport(peek.report);
      } catch {
        if (live) setFailed(true);
      }
    };
    read();
    const id = setInterval(read, LIVE_ACTIVITY_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [user.id, composingId, nonce]);

  // The trail's latest save, in words — the latch covers "right now", this
  // covers "how long ago did they last put something in".
  let lastSave = null;
  if (user.last_report_write_at != null) {
    const t = parseStamp(user.last_report_write_at);
    if (t !== null) {
      const minutes = Math.max(0, Math.round((now - t) / 60000));
      lastSave = minutes < 1 ? 'saved just now' : `saved ${minutes}m ago`;
    }
  }

  // The trail grouped for the ledger below (Today / Yesterday / the date).
  const dayGroups = groupByDay(events);

  return (
    <aside className="conn-hub__live" role="dialog" aria-modal="false" aria-labelledby="conn-hub-live-title">
      <div className="conn-hub__live-head">
        <span className={`conn-hub__avatar${roleInk(user) ? ` ${roleInk(user)}` : ''}`} aria-hidden="true">{initials(user)}</span>
        <div className="conn-hub__live-who">
          {/* A label above the name, the way the rail labels its groups: it says
              what the panel IS before the name says whose it is. */}
          <span className="conn-hub__live-eyebrow">Live desk</span>
          <h3 id="conn-hub-live-title" ref={titleRef} tabIndex={-1}>{name}</h3>
          <p>
            {user.role ? <span className={`conn-hub__live-role${roleInk(user) ? ` ${roleInk(user)}` : ''}`}>{user.role}</span> : null}
            <span className={`conn-hub__seen${writing ? ' is-writing' : ''}`}>
              <span className="conn-hub__seen-dot" aria-hidden="true" />
              {writing ? 'writing a report\u2026' : seenText}
            </span>
          </p>
        </div>
        <button type="button" className="conn-hub__live-close" onClick={onClose} aria-label={`Close live activity for ${name}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12" />
            <path d="m18 6-12 12" />
          </svg>
        </button>
      </div>
      <p className="conn-hub__live-live">
        <span className="conn-hub__live-dot" aria-hidden="true" />
        LIVE — refreshing every few seconds
      </p>
      <div className="conn-hub__live-now">
        {composingId != null ? (
          <>
            <p className="conn-hub__live-composing">
              <span className="conn-hub__live-typing" aria-hidden="true" />
              Composing <strong>report #{composingId}</strong> right now.
            </p>
            {preview === false ? (
              <p className="conn-hub__live-idle">That report could not be opened.</p>
            ) : preview === null && liveReport === null ? (
              <p className="conn-hub__live-idle">Opening their draft…</p>
            ) : (
              <div className="conn-hub__live-report">
                <p className="conn-hub__live-report-meta">
                  {(liveReport?.status ?? preview?.status) ? <strong>{liveReport?.status ?? preview?.status}</strong> : null}
                  {(liveReport?.incident_type ?? preview?.incident_type) ? ` · ${liveReport?.incident_type ?? preview?.incident_type}` : ''}
                  {(liveReport?.location ?? preview?.location) ? ` · ${liveReport?.location ?? preview?.location}` : ''}
                </p>
                {(liveReport?.narrative_excerpt ?? preview?.narrative?.slice(0, 600)) ? (
                  <blockquote className="conn-hub__live-excerpt">
                    {liveReport?.narrative_excerpt ?? preview?.narrative?.slice(0, 600)}
                    {(liveReport?.narrative_truncated || (preview?.narrative?.length ?? 0) > 600) && <span> …</span>}
                  </blockquote>
                ) : (
                  <p className="conn-hub__live-idle">No narrative written yet.</p>
                )}
                <p className="conn-hub__live-updated">
                  Updated {(liveReport?.updated_at ?? preview?.updated_at ?? '').replace('T', ' ') || '—'}
                </p>
              </div>
            )}
          </>
        ) : lastSave !== null ? (
          <p className="conn-hub__live-idle">{lastSave} — no open composer.</p>
        ) : (
          <p className="conn-hub__live-idle">No composing signal right now.</p>
        )}
        {user.last_seen_at ? (
          <p className="conn-hub__live-beat">Last beat: {String(user.last_seen_at).replace('T', ' ')}</p>
        ) : null}
      </div>
      <h4 className="conn-hub__live-sub">Recent activity{events && events.length > 0 ? <span className="conn-hub__live-total">{events.length}</span> : null}</h4>
      {failed && events === null ? (
        <p className="conn-hub__live-empty">
          Live activity could not be read.{' '}
          <button type="button" className="button-link" onClick={() => setNonce((n) => n + 1)}>Retry</button>
        </p>
      ) : events === null ? (
        <p className="conn-hub__live-empty">Reading their trail…</p>
      ) : events.length === 0 ? (
        <p className="conn-hub__live-empty">No trail entries for this account yet.</p>
      ) : (
        <div className="conn-hub__live-groups">
          {dayGroups.map((g) => (
            <section key={g.day || g.label} className="conn-hub__live-group">
              {/* The day as a heading rather than a column of repeated dates:
                  one line says what ten timestamps were spelling out. */}
              <h5 className="conn-hub__live-day">{g.label}</h5>
              <ul className="conn-hub__live-events">
                {g.items.map((a, i) => {
                  const kind = trailKind(a.action);
                  const stamp = stampParts(a.created_at);
                  // The newest entry in the newest run is the one being read first.
                  const latest = g === dayGroups[0] && i === 0;
                  return (
                    <li key={a.id} className={`conn-hub__live-event${kind ? ` ${kind}` : ''}${latest ? ' is-latest' : ''}`}>
                      <span className="conn-hub__live-rail" aria-hidden="true">
                        <span className={`conn-hub__live-tag${kind ? ` ${kind}` : ''}`}>
                          <TrailGlyph action={a.action} />
                        </span>
                      </span>
                      <div className="conn-hub__live-body">
                        <div className="conn-hub__live-line">
                          <span className="conn-hub__live-what">{actionLabel(a.action)}</span>
                          {a.entity_type && a.entity_id != null && (
                            <span className="conn-hub__live-where">{a.entity_type} #{a.entity_id}</span>
                          )}
                          <time
                            className="conn-hub__live-when"
                            dateTime={String(a.created_at ?? '').replace(' ', 'T')}
                            title={String(a.created_at ?? '').replace('T', ' ')}
                          >
                            {stamp.time}
                          </time>
                        </div>
                        {a.detail ? <span className="conn-hub__live-detail">{a.detail}</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="conn-hub__live-note">
        Live system activity from the audit trail — never their screen. Nothing
        here captures or shows a colleague's display.
      </p>
    </aside>
  );
}
