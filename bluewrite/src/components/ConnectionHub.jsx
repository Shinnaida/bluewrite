import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
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

export default function ConnectionHub({ users: usersProp }) {
  // When no list is handed in (User Management), read the directory itself and
  // refresh it every 30 seconds — the same cadence as the beat that keeps the
  // stamps in it fresh. A failed refresh keeps the last list on screen rather than
  // blanking the drawing, and the next tick tries again.
  const [fetched, setFetched] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (usersProp) return undefined;
    let live = true;
    const load = async () => {
      try {
        const data = await api('/users');
        if (live) setFetched(data.users ?? []);
      } catch {
        // Keep the last list; the next 30-second tick tries again.
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(id);
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
          : `${active.length} signed in: ${shown.map((u) => u.full_name || u.username).join(', ')}${extra > 0 ? `, and ${extra} more` : ''}`}
      >
        {/* The rings are the drawing's floor: they say where the centre is before
            anybody is on it, so the empty state is a hub with room around it rather
            than a lone circle in a panel. */}
        <g className="conn-hub__rings" aria-hidden="true">
          {RINGS.map((r) => (
            <circle key={r} className="conn-hub__ring" cx={HUB.x} cy={HUB.y} r={r} />
          ))}
        </g>


        {/* NO ORBIT RING (owner request): the dashed ellipse read as another
            broken line, so the rings alone floor the drawing. */}
        {/* CONNECTED STRINGS (owner request): each workstation is strung to the
            server by a solid hairline in its role ink — solid, not dashed, so it
            reads as a live link and never as a broken wire. Trimmed at both ends
            so it slips under the server and the PC instead of poking through. */}
        <g className="conn-hub__links" aria-hidden="true">
          {shown.map((u, i) => {
            const p = positionFor(i, shown.length, u.id);
            const dx = p.x - HUB.x;
            const dy = p.y - HUB.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            return (
              <line
                key={`link-${u.id}`}
                className={`conn-hub__link${roleInk(u) ? ` ${roleInk(u)}` : ''}`}
                x1={HUB.x + ux * 26}
                y1={HUB.y + uy * 26}
                x2={p.x - ux * 24}
                y2={p.y - uy * 24}
              />
            );
          })}
        </g>
        {shown.map((u, i) => {
          const p = positionFor(i, shown.length, u.id);
          return (
            <g key={`node-${u.id}`} className={`conn-hub__node${roleInk(u) ? ` ${roleInk(u)}` : ''}`} transform={`translate(${p.x} ${p.y})`}>
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
            <li key={u.id} className="conn-hub__person">
              <span className={`conn-hub__avatar${roleInk(u) ? ` ${roleInk(u)}` : ''}`} aria-hidden="true">{initials(u)}</span>
              <span className="conn-hub__who">
                <span className="conn-hub__name">{u.full_name || u.username}</span>
                {u.role ? <span className="conn-hub__role">{u.role}</span> : null}
              </span>
              <span className="conn-hub__seen" title={u.last_seen_at ? `Server time of last activity: ${u.last_seen_at}` : undefined}>
                <span className="conn-hub__seen-dot" aria-hidden="true" />
                {seenLabel(u.seen, now)}
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
    </section>
  );
}
