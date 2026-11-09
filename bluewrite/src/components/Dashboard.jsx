import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
// Leaflet's CSS is safe to bundle statically, but the library itself touches
// `window` at import time — so it loads lazily inside LocationMap (see the
// dynamic import there) and a static import here would break server-side
// rendering (the rule-test harness renders this file in Node).
import 'leaflet/dist/leaflet.css';
import { api, apiBlobUrl, isUnreachable } from '../lib/api.js';
import { ServerPhoto } from './Avatar.jsx';
// The incident-category rank chart's rules — bucketing, per-bucket ranks, which types
// earn a line, the sentence under it. Pure, and tested on its own because a rank chart
// drawn wrong still looks like a rank chart (see tests/rules/categoryRank.test.mjs).
import {
  axisTicks,
  bucketNoun,
  bucketize,
  chooseDrawn,
  rankByBucket,
  rankGeometry,
  rankHeadline,
  typeReading,
} from '../lib/categoryRank.js';
import {
  CHART_MENU,
  alignmentWarning,
  bandAtPointer,
  chartMenuItems,
  dayAtPointer,
  dayBreakdownText,
  orderForDisplay,
  rampColor,
  rampStep,
  stackBands,
} from '../lib/dashboardChart.js';
// The status pie's geometry — the wedge paths, the wall's visible half, and the box
// the lifted wedge has to fit inside. Pure functions in a module of their own
// because a pie drawn wrong still looks like a pie (see statusPie.js).
import {
  PIE_BOX,
  PIE_CENTER,
  PIE_DEPTH,
  PIE_LIFT_SCALE,
  PIE_MENU,
  PIE_RX,
  PIE_RY,
  REGISTER_STATUS,
  pieMenuItems,
  pieWedges,
  statusBreakdownText,
} from '../lib/statusPie.js';
// The station's own photograph for the command header, masked into the
// header's right edge. Imported rather than referenced, so the bundle carries
// it and the LAN needs no internet to draw it.
import stationPhoto from '../assets/bluewrite_police_station_header_cropped_1154x122.png';
import Lanyard from './Lanyard.jsx';
// The same right-click menu the register's rows use, so a day of the chart offers
// its actions the way the rest of the app does rather than by a second idiom.
import RowMenu from './RowMenu.jsx';
// AN ACTIVITY ROW NAMES A RECORD, so the record's own type mark is drawn the way
// the register draws it — the same twenty-four-unit glyph and the same hue
// family, read from the same two rules (lib/reportFolder.js). A mark invented
// here would be a second answer to "what does a Theft look like" on the one
// screen that also links to the register.
import ReportTypeIcon from './ReportTypeIcon.jsx';
import { typeHue, typeIcon } from '../lib/reportFolder.js';
// The "Search the news" panel: a search of the open web through the server's news
// proxy, so the API token never reaches the browser (see NewsController.php).

/**
 * Active Accounts ID art: FRONT is the person's photograph (fetched as bytes so
 * it passes the same tab gate as every other `api` call, then handed to the
 * lanyard as a blob URL). BACK — and the front fallback when there is no photo
 * — is drawn here from the database row, so flipping the card reads the same
 * identity User Management shows. Data URLs, so the LAN build needs no files.
 */
function personInitials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
/**
 * Status pill baked into the card artwork (bottom-right, on the card), so it
 * swings, flips and drags WITH the badge instead of floating over it.
 */
function drawStatusPill(ctx, W, H, presence) {
  const dot = presence.state === 'active' ? '#22c55e' : presence.state === 'away' ? '#f59e0b' : '#94a3b8';
  ctx.save();
  ctx.font = '800 46px system-ui, sans-serif';
  const tw = ctx.measureText(presence.label).width;
  const dotR = 20;
  const padX = 34;
  const gap = 18;
  const pillW = padX * 2 + dotR * 2 + gap + tw;
  const pillH = 104;
  const x = W - 44 - pillW;
  const y = H - 44 - pillH;
  ctx.shadowColor = 'rgba(11, 37, 69, 0.35)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, pillW, pillH, pillH / 2);
  else ctx.rect(x, y, pillW, pillH);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(x + padX + dotR, y + pillH / 2, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0b2545';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(presence.label, x + padX + dotR * 2 + gap, y + pillH / 2 + 2);
  ctx.restore();
}
/** Photo front with the status pill printed on it: cover-fit portrait, pill
 * bottom-right, so the whole badge reads as one ID. */
function paintIdPhotoFront(img, presence) {
  try {
    const W = 1024;
    const H = 1440;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx || !img) return undefined;
    const s = Math.max(W / img.width, H / img.height);
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    drawStatusPill(ctx, W, H, presence);
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}
const loadPhotoImage = (url) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});
function personIdFallbackFront(user, presence) {
  try {
    const W = 1024;
    const H = 1440;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const navy = '#0b2545';
    const gold = '#f0b429';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = navy;
    ctx.fillRect(0, 0, W, 300);
    ctx.fillStyle = gold;
    ctx.fillRect(0, 300, W, 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 60px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STATION ID', W / 2, 150);
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillStyle = gold;
    ctx.fillText(String(user?.role ?? 'OFFICER').toUpperCase(), W / 2, 220);
    ctx.beginPath();
    ctx.arc(W / 2, 620, 220, 0, Math.PI * 2);
    ctx.fillStyle = '#1d4ed8';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 170px system-ui, sans-serif';
    ctx.fillText(personInitials(user?.full_name), W / 2, 685);
    ctx.fillStyle = navy;
    ctx.font = '800 68px system-ui, sans-serif';
    const name = String(user?.full_name ?? 'Unknown');
    ctx.fillText(name.length > 22 ? `${name.slice(0, 21)}…` : name, W / 2, 980);
    ctx.fillStyle = '#5b6b84';
    ctx.font = '700 48px system-ui, sans-serif';
    ctx.fillText(`ID ${String(user?.badge_number ?? '—')}`, W / 2, 1050);
    drawStatusPill(ctx, W, H, presence ?? { state: 'offline', label: 'Offline' });
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}
function personIdBackImage(user, presence) {
  try {
    const W = 1024;
    const H = 1440;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const navy = '#0b2545';
    const gold = '#f0b429';
    ctx.fillStyle = '#101f3c';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = navy;
    ctx.fillRect(0, 0, W, 300);
    ctx.fillStyle = gold;
    ctx.fillRect(0, 300, W, 14);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 66px system-ui, sans-serif';
    ctx.fillText('STATION ID', W / 2, 152);
    ctx.font = '700 48px system-ui, sans-serif';
    ctx.fillStyle = gold;
    ctx.fillText(String(user?.role ?? 'OFFICER').toUpperCase(), W / 2, 224);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 94px system-ui, sans-serif';
    const name = String(user?.full_name ?? 'Unknown');
    ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, W / 2, 484);
    ctx.textAlign = 'left';
    const rows = [
      ['BADGE', String(user?.badge_number ?? '—')],
      ['USERNAME', `@${String(user?.username ?? '—')}`],
      ['ROLE', String(user?.role ?? '—')],
      ['STATUS', String(user?.status ?? 'active')],
      ['EMAIL', String(user?.email ?? '—')],
    ];
    // Set large but bounded: labels 46px, values 56px, five rows of 150px
    // ending at 1266 — clear of the status pill baked at 1292.
    let y = 600;
    rows.forEach(([k, v]) => {
      ctx.fillStyle = gold;
      ctx.font = '800 46px system-ui, sans-serif';
      ctx.fillText(k, 112, y);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 56px system-ui, sans-serif';
      const val = v.length > 24 ? `${v.slice(0, 23)}…` : v;
      ctx.fillText(val, 112, y + 66);
      y += 150;
    });
    drawStatusPill(ctx, W, H, presence ?? { state: 'offline', label: 'Offline' });
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

/**
 * Presence for a badge: green while the heartbeat is fresh, "Active Nm ago"
 * while the desk has only just gone quiet, Offline past the hour. Read off
 * `last_seen_at`, which PresenceBeat refreshes every thirty seconds.
 */
function presenceOf(lastSeen) {
  if (!lastSeen) return { state: 'offline', label: 'Offline' };
  const t = new Date(String(lastSeen).replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return { state: 'offline', label: 'Offline' };
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return { state: 'active', label: 'Active' };
  if (mins < 60) return { state: 'away', label: `Active ${mins}m ago` };
  return { state: 'offline', label: 'Offline' };
}

/**
 * Phase 4 — Dashboard monitoring (UC-017). ADMIN-ONLY view: the shell only
 * renders this for Admin users, and the API enforces the same rule
 * server-side (Auth::requireRole('Admin')) — the UI gate is convenience,
 * not enforcement.
 *
 * Charts are hand-drawn SVG/DOM on purpose: the station's client PCs have no
 * internet, so a CDN-hosted chart library would silently fail. Keep this
 * file dependency-free (mirrors the roadmap's LAN-only deployment model).
 *
 * Data contract (GET /api/v1/dashboard/stats):
 *   kpis{total,pending,submitted,finalized,periodDeltaPct}
 *   seriesOverTime[{date,count}] · seriesByType[{type,total,counts}] (volume order)
 *   categoryBreakdown[{type,count}]
 *   categoryDeltas{type:{current,previous}} · statusBreakdown{draft,submitted,final}
 *   hourHistogram[{hour,count}]
 *   officerBreakdown[{officer,count}] · recentActivity[{action,entityId,createdAt,actor}]
 *     — the audit feed and the workload tally are still served, but no panel on
 *       this page reads them any more: the workload panel was removed on purpose,
 *       and the activity panel draws RECORDS instead (see recentReports below).
 *       The endpoint was deliberately left alone.
 *   periodDeltas{attentionPct,finalizedPct,medianPct}
 *     — the summary strip's three trend figures, each measured against the window
 *       of the same length before this one (2026-10-12). `medianPct` is null when
 *       there is no previous median to compare against.
 *   recentReports[{id,type,location,incident_datetime,status}]
 *     — the five newest records IN THIS RANGE, for the activity panel.
 *   finalizeTime{medianMinutes,finalizedCount} · meta{from,to,type,scope,availableTypes}
 */

const fmt = new Intl.NumberFormat();

/**
 * EXECUTIVE SUMMARY helpers (owner request): the admin's station-at-a-glance.
 * Everything here reads the SAME /dashboard/stats response the charts read,
 * so the summary can never disagree with the panels below it.
 */
function dayGreeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function firstName(user) {
  const full = String(user?.full_name ?? '').trim();
  return full ? full.split(/\s+/)[0] : 'Admin';
}
/** The station wall clock: Philippine time, read where the badge reads it. */
const MANILA = 'Asia/Manila';
const MANILA_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA,
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const MANILA_DAY = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA,
  weekday: 'long',
});
const MANILA_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

const isoDate = (d) => d.toISOString().slice(0, 10);

function datesForPreset(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

// ---- Skeleton bits (shown while the first load is in flight) --------------

function PanelSkeleton({ tall }) {
  return (
    <div className={`dash-panel is-skeleton ${tall ? 'dash-panel--tall' : ''}`} aria-hidden="true">
      <span className="dash-panel__title sk sk--text" style={{ width: 140 }} />
      <span className={`sk sk--block ${tall ? 'sk--chart-tall' : 'sk--chart'}`} />
    </div>
  );
}

// ---- Shared panel chrome ----------------------------------------------------

/**
 * WHAT EACH CHART'S INFO CONTROL SAYS.
 *
 * Every chart here answers a different question with the same furniture — a wedge, a
 * strip of 24 bars, two lists of bars — and none of them can say so in the panel head.
 * The copy lives in one place rather than inline at five call sites because these five
 * paragraphs are the dashboard's own documentation: read together, a stale claim ("this
 * counts X") is obvious, and the wording can stay consistent about the things all five
 * share — the range they read, and what a length means as opposed to a count.
 *
 * Rules for the wording, such as they are: lead with what ONE MARK is, then what its
 * size means, then the thing a reader would otherwise get wrong (which timestamp, which
 * denominator, what is left out). `hint` is for behaviour — the pointer, the keyboard,
 * the right button — and is left out where there is none to describe.
 */
const PANEL_INFO = {
  status: {
    label: 'How to read the status breakdown',
    title: 'How to read this pie',
    note: 'Each wedge is one report status, drawn at its share of the reports in this range; a status with none in range is not drawn at all, so a two-wedge pie is not a broken one. The wedges run clockwise from twelve o’clock in workflow order — Final, Finalized, Draft — never by size, so a status stays where the reader learned to find it.',
    hint: 'Point at a wedge to lift it and read its count and share under the pie; right-click one to open those reports in the register, copy the breakdown, or pin the readout open.',
  },
  hour: {
    label: 'How to read the reports by hour',
    title: 'How to read this chart',
    note: 'Each bar is one hour of the day, and every day in the range is added into the same 24 bars — the date is discarded — so this is when incidents land across the range rather than the shape of any one day. Bars count the hour the incident HAPPENED, not when the report was filed, and their heights are relative to the busiest hour rather than being shares.',
    hint: 'Hover a bar, or focus the strip and walk it with ←/→, to read that hour’s count and its share of the range. The line under the strip is the range’s busiest hour, and stays that way while you read.',
  },
}; // The incident-categories entry was removed with its panel: a paragraph
   // about a chart that is no longer on the page would be a stale claim.

function Panel({ title, mark = null, sub = null, aside, info, children, className = '' }) {
  return (
    <section className={`dash-panel${className ? ` ${className}` : ''}`}>
      <div className="dash-panel__head">
        {/* THE TITLE IS A MARK AND A LINE OF TYPE now (owner request,
            2026-10-12): the reference heads every card with the reading's own
            drawing, the name in sentence case, and — where there is one — a line
            under it saying what the chart counts. A `mark` is optional because
            the three chart panels below still head themselves with a title and
            their info control only; `sub` is optional for the same reason. */}
        <h2 className="dash-panel__title">
          {mark}
          <span className="dash-panel__title-text">
            {title}
            {sub && <span className="dash-panel__sub">{sub}</span>}
          </span>
        </h2>
        {(aside || info) && (
          <div className="dash-panel__aside">
            {aside}
            {info}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }) {
  return <p className="dash-empty">{children}</p>;
}

// ===========================================================================
// The reference's own furniture (owner request, 2026-10-12)
//
// THE FOUR PIECES BELOW ARE EXPORTED, and for the reason ReportShelf is (see
// Reports.jsx): a card, a strip of cards and a list of records are drawings, and
// a drawing is what a source-reading test cannot check — a card that renders as
// an empty plate, a mark whose path map came back undefined, an arrow pointed
// the wrong way on a reading where down is the good direction. The page above
// uses them; tests/fixtures/adminDashboard.jsx renders them with the payload the
// endpoint really sends, and the test reads the markup.
//
// The dashboard was a row of numbers with a coloured edge and a set of panels
// with uppercase titles. The design the owner sent draws the same facts as
// CARDS: a tinted circular mark that says which reading it is, the reading
// itself, and one line of what it means — and, under the two wide panels, a
// compact strip that repeats the four readings with their change against the
// period before.
//
// EVERY DRAWING IS INLINE, on the app's own 24-unit grid, for the reason the top
// bar's marks are (see AppTopBar.jsx): the station's LAN has no internet, so a
// mark is a path in this bundle or it is nothing. Nothing here is fetched and no
// icon package is used.
// ===========================================================================

/** The four readings' marks, named for what they measure rather than for the
 *  picture — the label beside each one is what the card is CALLED. */
const KPI_MARKS = {
  // A page with ruled lines: the register itself.
  reports: [
    'M14 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8z',
    'M14 3.2V8h5',
    'M9.2 12.8h5.6M9.2 16.4h5.6',
  ],
  // A clock: the reading that means "waiting".
  attention: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5V12l3.2 2'],
  // A tick in a ring: signed off.
  finalized: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm8.4 12.2 2.5 2.5 4.7-5'],
  // A stopwatch: how long the work took.
  timer: ['M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z', 'M12 8.6V13l3 1.8', 'M9.4 3.2h5.2'],
  // Colleagues: the accounts that can open the register.
  accounts: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
};

function KpiMark({ name }) {
  return (
    <svg
      className="dash-kpi__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {KPI_MARKS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * ONE READING: the caption in bold and the hero number. Only the headcount
 * keeps a line under it (the admin/officer split); the other cards are just
 * the reading (owner request, 2026-10-30).
 *
 * `tone` is the card's colour FAMILY (blue, gold, green, violet): the number's
 * echo wears it, and the stylesheet owns what each family looks like.
 *
 * The loading state keeps the old `dash-kpi is-skeleton` shell on purpose: the
 * mount test counts those plates, and a skeleton is a skeleton whatever the
 * card it stands in for looks like.
 */
export function MetricCard({ tone, label, value, foot, loading = false, size }) {
  if (loading) {
    return (
      <div className="dash-kpi is-skeleton" aria-hidden="true">
        <span className="sk sk--text" />
        <span className="sk sk--big" />
        {foot ? <span className="sk sk--text" /> : null}
      </div>
    );
  }
  return (
    <div className={`cmd-card cmd-card--${tone}${size ? ` cmd-card--${size}` : ''}`}>
      <span className="cmd-card__main">
        <span className="cmd-card__label">{label}</span>
        <span className="cmd-card__value-row">
          <span className="cmd-card__value">{value}</span>
          {foot ? <span className="cmd-card__foot">{foot}</span> : null}
        </span>
      </span>
    </div>
  );
}

/**
 * A card that OPENS somewhere: the register, pre-filtered to what the card
 * counts, or User Management for the headcount. An anchor rather than a
 * button, because leaving the page is navigation — and keyboard-reachable for
 * the same reason. MetricCard itself stays a READING: the render fixture draws
 * it unwrapped, and a reading is never a control.
 */
function CardLink({ label, onGo, children }) {
  if (!onGo) return <>{children}</>;
  return (
    <a
      href="#reports"
      className="cmd-cardlink"
      aria-label={`${label} — open in the register`}
      onClick={(e) => {
        e.preventDefault();
        onGo();
      }}
    >
      {children}
    </a>
  );
}

/** "↑ 12% vs. previous period" — the one wording for a change against the period
 *  before, used by the cards above and the strip below so the two cannot say it
 *  two ways. `pct` null/undefined means there was nothing to compare: no line. */
export function DeltaLine({ pct, good = 'up' }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
  const n = Number(pct);
  const up = n >= 0;
  // WHICH WAY IS GOOD IS THE READING'S OWN FACT, not the arrow's: more reports
  // and more finalized work are the station doing more, and a SHORTER median is
  // the work moving faster. So the sign is what is drawn and `good` is what is
  // painted — the reference's own median card is a green arrow pointing down.
  const better = (up && good === 'up') || (!up && good === 'down');
  return (
    <span className={`dash-kpi__delta ${better ? 'is-up' : 'is-down'}`}>
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>{' '}
      {Math.abs(n)}% vs. previous period
    </span>
  );
}

/**
 * ONE READING OF THE STRIP, in the reference's compact form: the same mark at a
 * smaller size, the number, what it counts, and the change against the period
 * before.
 *
 * WHY THE READINGS REPEAT. The reference draws its four figures twice — as cards
 * at the top and as a strip at the foot — and the owner asked for that design.
 * The top cards carry the QUALITY (a sparkline, the split inside the number, the
 * share it represents); the strip carries the DIRECTION, one arrow per figure,
 * which is the thing an Admin scanning the foot of the page wants and the cards
 * cannot fit. Every arrow is a real measured change (see DashboardController's
 * period deltas) — a strip that invented one would be worse than no strip.
 */
export function SummaryCard({ tone, mark, value, label, pct, good = 'up', valueClass = '' }) {
  return (
    <div className="dash-sum__card">
      <span className={`dash-kpi__mark dash-kpi__mark--${tone} dash-sum__mark`} aria-hidden="true">
        <KpiMark name={mark} />
      </span>
      <span className="dash-sum__body">
        <span className={`dash-sum__value ${valueClass}`}>{value}</span>
        <span className="dash-sum__label">{label}</span>
        <DeltaLine pct={pct} good={good} />
      </span>
    </div>
  );
}

/* Panel-head marks REMOVED (owner request, 2026-10-30): every dashboard panel
   is headed by its name only — Reports Overview, Recent Activity, Report
   Status, AI Insights, Incident Types, Top Locations and System Status all
   read as plain titles. BarsMark, TrioMark, PieMark, PinMark and ShieldMark
   were those marks, and they are gone with them. */

/** How a report's status reads on an activity row. One word for each state of
 *  the workflow, in the same words the register's shelves use. */
const ACTIVITY_STATUS = {
  draft: 'Draft',
  submitted: 'Finalized',
  finalized: 'Finalized',
};

/** "12 Oct 2026, 18:42" — the day AND the minute, because a list of what just
 *  happened is read by the minute. Built from the same `YYYY-MM-DD HH:MM:SS`
 *  string every endpoint sends. */
function activityWhen(dbStamp) {
  if (!dbStamp) return '';
  const then = new Date(String(dbStamp).replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return '';
  const day = then.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

/**
 * One system happening, read off the audit feed: which title it earns, which
 * line under it, and which of the two system marks it wears. Unmapped actions
 * return null and are left out — the panel is five rows, not the audit trail.
 */
function systemRow(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = entry.entityId === null || entry.entityId === undefined ? '' : String(entry.entityId);
  const bw = id !== '' && Number.isFinite(Number(id)) ? `BW-${String(Number(id)).padStart(4, '0')}` : id;
  switch (entry.action) {
    case 'user.create':
      return { title: 'New User Added', detail: `Opened by ${entry.actor ?? 'an admin'}`, icon: 'user' };
    case 'user.password_reset':
      return { title: 'Password Reset', detail: `By ${entry.actor ?? 'an admin'}`, icon: 'user' };
    case 'user.deactivate':
      return { title: 'Account Deactivated', detail: `By ${entry.actor ?? 'an admin'}`, icon: 'user' };
    case 'user.update':
      return { title: 'Account Updated', detail: `By ${entry.actor ?? 'an admin'}`, icon: 'user' };
    case 'report.update':
      return { title: 'Report Updated', detail: `Incident Report #${bw || '—'}`, icon: 'doc', reportId: Number(id) || null };
    case 'report.archive':
      return { title: 'Report Archived', detail: `Incident Report #${bw || '—'}`, icon: 'doc', reportId: Number(id) || null };
    case 'report.restore':
      return { title: 'Report Restored', detail: `Incident Report #${bw || '—'}`, icon: 'doc', reportId: Number(id) || null };
    case 'station.update':
      return { title: 'Station Settings Updated', detail: `By ${entry.actor ?? 'an admin'}`, icon: 'doc' };
    default:
      return null;
  }
}

/** The system rows' own marks: a colleague added, or a page of the register. */
function SystemMark({ name }) {
  return (
    <svg
      className="dash-activity__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'user' ? (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" />
        </>
      ) : (
        <>
          <path d="M14 3.2H7.4a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h9.2a2 2 0 0 0 2-2V8z" />
          <path d="M14 3.2V8h5" />
          <path d="M9.2 16.4h5.6" />
        </>
      )}
    </svg>
  );
}

/** The register's own file logo (see FileLogo in ReportList.jsx): the
 * yellow-to-orange page with its corner folded down and three ruled bars —
 * the same drawing a row of All Reports wears, so a record reads as the same
 * file here as there. Purely drawn, aria-hidden: the row names the report. */
function ActivityFileLogo({ className }) {
  const gradientId = useId();
  return (
    <svg className={className} viewBox="0 0 24 28" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="12" y1="1" x2="12" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFC93C" />
          <stop offset="1" stopColor="#F29B00" />
        </linearGradient>
      </defs>
      <path d="M5 1h9.6L22 8.4V24a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3z" fill={`url(#${gradientId})`} />
      <path d="M14.6 1 22 8.4h-5.4a2 2 0 0 1-2-2V1z" fill="#E1860A" />
      <rect x="5.5" y="12" width="13" height="2" rx="1" fill="#DD7A01" />
      <rect x="5.5" y="15.6" width="10.4" height="2" rx="1" fill="#DD7A01" />
      <rect x="5.5" y="19.2" width="7.2" height="2" rx="1" fill="#DD7A01" />
    </svg>
  );
}

/** A `YYYY-MM-DD HH:MM:SS` stamp as milliseconds, or null when it is not one. */
function stampMs(stamp) {
  if (!stamp) return null;
  const t = new Date(String(stamp).replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * RECENT ACTIVITY — the newest records in the range being read, with the
 * station's own happenings between them.
 *
 * Records say what kind, where, when, and where each one stands in the
 * workflow; system rows (a colleague added, a report touched, the station
 * itself changed) say who did it and when, and wear the blue System chip
 * instead of a workflow one. Both halves come from the same stats response,
 * merged newest-first and cut at five — the panel is the page's glance, not
 * the audit trail.
 *
 * Every RECORD row opens through the same route the bell uses (Shell owns the
 * screen change), and a system row that names a report does too; a row that
 * names nobody is a dead line drawn as one (a div, not a button).
 */
export function RecentActivity({ reports, events = [], loading, onOpen, onViewAll, filtered = false, onStart }) {
  const recordRows = (Array.isArray(reports) ? reports : []).map((r) => ({
    key: `report-${r.id}`,
    when: stampMs(r.incident_datetime) ?? 0,
    // The case number the register files it under — the handle an Admin
    // quotes, distinct from the status chip beside it.
    caseNo: Number.isFinite(Number(r.id)) ? `BW-${String(Number(r.id)).padStart(4, '0')}` : '',
    title: r.type,
    // The reference's own row (owner request, 2026-10-30): the orange file, the
    // type's pill in its own hue, and the bold case number — the register's
    // chips, read the same way here as on All Reports.
    pill: true,
    hue: typeHue(r.type),
    typeGlyph: typeIcon(r.type),
    meta: `${r.location ? `${r.location} · ` : ''}${activityWhen(r.incident_datetime)}`,
    chip: ACTIVITY_STATUS[r.status] ?? r.status,
    chipClass: `dash-status dash-status--${r.status}`,
    markClass: 'dash-activity__file',
    mark: <ActivityFileLogo className="dash-activity__filemark" />,
    openId: r.id,
    openTitle: `Open report BW-${String(r.id).padStart(4, '0')}`,
  }));
  const systemRows = (Array.isArray(events) ? events : [])
    .map((e, i) => {
      const read = systemRow(e);
      if (!read) return null;
      return {
        key: `event-${e.action}-${e.entityId ?? i}-${e.createdAt ?? i}`,
        when: stampMs(e.createdAt) ?? 0,
        title: read.title,
        meta: `${read.detail} · ${activityWhen(e.createdAt)}`,
        chip: 'System',
        chipClass: 'dash-status dash-status--system',
        markClass: 'dash-activity__file',
        mark: <ActivityFileLogo className="dash-activity__filemark" />,
        openId: read.reportId ?? null,
        openTitle: read.reportId ? `Open report BW-${String(read.reportId).padStart(4, '0')}` : null,
      };
    })
    .filter(Boolean);
  const rows = [...recordRows, ...systemRows]
    .sort((a, b) => b.when - a.when)
    .slice(0, 5);
  return (
    <section className="dash-panel dash-activity">
      <div className="dash-panel__head">
        <h2 className="dash-panel__title">
          <span className="dash-panel__title-text">Recent Activity</span>
        </h2>
        <div className="dash-panel__aside">
          <button type="button" className="dash-viewall" onClick={onViewAll}>
            View All <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      {loading ? (
        <ul className="dash-activity__list is-skeleton" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="dash-activity__row">
              <span className="dash-activity__mark sk" />
              <span className="dash-activity__text">
                <span className="sk sk--text" style={{ width: 120 }} />
                <span className="sk sk--text" style={{ width: 170 }} />
              </span>
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        // The hint names the narrowing only when there IS one: a station that
        // recorded nothing reads "no reports yet" with a way to file the
        // first, not advice about filters it never set.
        filtered ? (
          <EmptyNote>No reports were recorded in this range. Widen the dates, or clear the incident type.</EmptyNote>
        ) : (
          <div className="dash-empty dash-empty--action">
            <p>No reports were recorded in this range yet.</p>
            {onStart && (
              <button type="button" className="dash-empty__btn" onClick={onStart}>
                Start a report
              </button>
            )}
          </div>
        )
      ) : (
        <ul className="dash-activity__list">
          {rows.map((row) => (
            <li key={row.key}>
              {row.openId ? (
                <button
                  type="button"
                  className="dash-activity__row"
                  onClick={() => onOpen?.(row.openId)}
                  title={row.openTitle}
                >
                  <span className={row.markClass} aria-hidden="true">
                    {row.mark}
                  </span>
                  <span className="dash-activity__text">
                    <span className="dash-activity__title">
                      {row.pill ? (
                        <span className={`dash-activity__type dash-activity__type--${row.hue}`}>
                          <ReportTypeIcon name={row.typeGlyph} className="dash-activity__type-mark" aria-hidden="true" />
                          <span className="dash-activity__type-text">{row.title}</span>
                        </span>
                      ) : row.title}
                      {row.caseNo && <span className="dash-activity__id">{row.caseNo}</span>}
                    </span>
                    <span className="dash-activity__meta">{row.meta}</span>
                  </span>
                  <span className={row.chipClass}>
                    {row.chip}
                  </span>
                </button>
              ) : (
                <div className="dash-activity__row">
                  <span className={row.markClass} aria-hidden="true">
                    {row.mark}
                  </span>
                  <span className="dash-activity__text">
                    <span className="dash-activity__title">
                      {row.pill ? (
                        <span className={`dash-activity__type dash-activity__type--${row.hue}`}>
                          <ReportTypeIcon name={row.typeGlyph} className="dash-activity__type-mark" aria-hidden="true" />
                          <span className="dash-activity__type-text">{row.title}</span>
                        </span>
                      ) : row.title}
                      {row.caseNo && <span className="dash-activity__id">{row.caseNo}</span>}
                    </span>
                    <span className="dash-activity__meta">{row.meta}</span>
                  </span>
                  <span className={row.chipClass}>
                    {row.chip}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The wall clock, ticking every second: the badge beside the greeting is
 *  read as "now", and a clock that only moves on reload is a stale one. */
function useNow(stepMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

/** One range control for every panel header that offers one: three selects,
 *  one state. The dashboard reads a single window, so a panel choosing its own
 *  would be a control describing something that is not true. */
export function RangeSelect({ preset, onPick }) {
  return (
    <label className="dash-range">
      <span className="sr-only">Date range</span>
      <select value={preset ?? 'custom'} onChange={(e) => onPick(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
        <option value="all">All time</option>
        <option value={5}>Last 5 days</option>
        <option value={7}>Last 7 days</option>
        <option value={14}>Last 14 days</option>
        <option value={30}>Last 30 days</option>
        {preset === null && <option value="custom">Custom range</option>}
      </select>
    </label>
  );
}

/**
 * THE RANGE'S COMPOSITION, as a donut: the three busiest types get their own
 * slice in the trend chart's own ramp order, and everything else is one grey
 * Others slice — a fourth colour for a fifth type would be precision the
 * legend cannot spend. Counts AND shares beside every name, because a slice
 * says nothing about how many reports it is. `legend={false}` draws the ring
 * alone, for the Total Reports plate where the clickable type rows beside it
 * already carry the names and counts.
 */
export function TypeDonut({ slices, legend = true }) {
  const rows = (Array.isArray(slices) ? slices : []).filter((s) => s.count > 0);
  const total = rows.reduce((n, s) => n + s.count, 0);
  if (rows.length === 0 || total <= 0) return <EmptyNote>Nothing in range to break down.</EmptyNote>;
  const R = 54;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="cmd-donut">
      <svg className="cmd-donut__svg" viewBox="0 0 140 140" role="img" aria-label={`Incident types: ${rows.map((s) => `${s.label} ${s.count}`).join(', ')}`}>
        <circle className="cmd-donut__track" cx="70" cy="70" r={R} />
        {rows.map((s) => {
          const frac = s.count / total;
          const dash = `${Math.max(0, frac * C - 2)} ${C}`;
          const rot = (acc / total) * 360;
          acc += s.count;
          return (
            <circle
              key={s.label}
              className="cmd-donut__slice"
              cx="70"
              cy="70"
              r={R}
              // A STYLED stroke, not a `stroke` attribute: the colours arrive as
              // `var(--cat-N)` and a presentation attribute cannot carry var().
              style={{ stroke: s.color }}
              strokeDasharray={dash}
              transform={`rotate(${rot - 90} 70 70)`}
            />
          );
        })}
        <text className="cmd-donut__total" x="70" y="66" textAnchor="middle">{total}</text>
        <text className="cmd-donut__caption" x="70" y="84" textAnchor="middle">reports</text>
      </svg>
      {legend && (
        <ul className="cmd-donut__legend">
          {rows.map((s) => (
            <li key={s.label}>
              <span className="cmd-donut__dot" style={{ background: s.color }} aria-hidden="true" />
              <span className="cmd-donut__name">{s.label}</span>
              <span className="cmd-donut__count">{fmt.format(s.count)}</span>
              <span className="cmd-donut__pct">{Math.round((s.count / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * WHERE THE RANGE'S REPORTS HAPPENED, longest bar first: one row per place,
 * each bar a share of the busiest street. The register spells places by hand,
 * so two spellings of one street are two rows until it spells them one way.
 */
export function LocationBars({ places }) {
  const rows = (Array.isArray(places) ? places : []).filter((p) => p.count > 0);
  if (rows.length === 0) return <EmptyNote>No places recorded in this range.</EmptyNote>;
  const max = Math.max(...rows.map((p) => p.count), 1);
  return (
    <ul className="cmd-places">
      {rows.map((p) => (
        <li key={p.location}>
          <span className="cmd-places__name">{p.location}</span>
          <span className="cmd-places__track" aria-hidden="true">
            <span className="cmd-places__bar" style={{ width: `${Math.max(4, Math.round((p.count / max) * 100))}%` }} />
          </span>
          <span className="cmd-places__count">{fmt.format(p.count)}</span>
        </li>
      ))}      </ul>
  );
}

// ---- Top Locations as a real map ---------------------------------------------
// Naga City, Cebu: the whole register is the station's own backyard, so the
// map opens on it instead of the world. Every list row gets a pin: addresses
// carrying a barangay resolve INSTANTLY against the baked-in centroids below
// (no network, nothing to fail), and anything else goes to Nominatim —
// OpenStreetMap's free geocoder, no key or account — with the city biasing
// the ranking. A place nothing can place stays unpinned and listed; the map
// never invents a pin.
const NAGA_CENTER = [10.2083, 123.7585];
// Nominatim viewbox: left,top,right,bottom around Naga City, Cebu — a ranking
// bias only, never a hard bound. (A hard bound plus a full street address
// silently resolves to nothing, which is how the map once lost every pin.)
const NAGA_VIEWBOX = '123.66,10.28,123.85,10.12';
const GEO_CACHE_KEY = 'naga-geo-v1';
// Safety cap only: the register sends at most its top 5, and every one of
// them gets pinned — nothing in the list is left off the map.
const GEO_MAX = 12;
// Naga City's 28 barangays with their true centroids (resolved once against
// OpenStreetMap, baked in): the barangay is the reliable anchor in a
// hand-typed address ("Public market, Purok 3, Brgy. West Poblacion" pins on
// West Poblacion). Longest names match first so "East Poblacion" wins over a
// bare "Poblacion".
const NAGA_BARANGAY_PINS = {
  Alpaco: [10.24206, 123.69424],
  Bairan: [10.19771, 123.71968],
  Balirong: [10.2567, 123.71077],
  Cabungahan: [10.21364, 123.72028],
  'Cantao-an': [10.24507, 123.75246],
  'Central Poblacion': [10.20747, 123.75725],
  Cogon: [10.26864, 123.73999],
  Colon: [10.21989, 123.76149],
  'East Poblacion': [10.20987, 123.75943],
  Inayagan: [10.23645, 123.77452],
  Inoburan: [10.18891, 123.73974],
  Jaguimit: [10.22919, 123.70907],
  Lanas: [10.27244, 123.71701],
  Langtad: [10.18364, 123.73279],
  Lutac: [10.24892, 123.72587],
  Mainit: [10.21694, 123.73136],
  Mayana: [10.2888, 123.69489],
  Naalad: [10.20954, 123.74429],
  'North Poblacion': [10.21241, 123.75879],
  Pangdan: [10.23263, 123.72731],
  Patag: [10.23024, 123.69931],
  'South Poblacion': [10.20348, 123.75524],
  Tagjaguimit: [10.26576, 123.68113],
  Tangke: [10.21611, 123.75353],
  Tinaan: [10.19356, 123.74513],
  Tuyan: [10.22824, 123.76728],
  Uling: [10.28019, 123.71152],
  'West Poblacion': [10.21109, 123.75356],
};

// Named landmarks for the generic words registers love ("church in City of
// Naga", "near the market"): each verified once against OpenStreetMap and
// baked in. A barangay still wins over a landmark — "chapel, Brgy. Langtad"
// pins on Langtad, not on the parish church across town.
const NAGA_LANDMARKS = [
  { keys: ['church', 'chapel', 'parish', 'simbahan', 'shrine'], name: 'Archdiocesan Shrine of St. Francis de Assisi', lat: 10.20883, lon: 123.75822 },
  { keys: ['city hall', 'municipal hall', 'munisipyo', 'bulwagang'], name: 'Naga City Hall', lat: 10.20712, lon: 123.75993 },
  { keys: ['public market', 'market', 'merkado', 'mercado'], name: 'City of Naga Public Market', lat: 10.20542, lon: 123.76003 },
  { keys: ['park', 'plaza', 'ocean park', 'playground'], name: 'St. Francis Ocean Park', lat: 10.20832, lon: 123.76011 },
];

const normPlace = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function findLandmark(label) {
  const hay = ` ${normPlace(label)} `;
  return NAGA_LANDMARKS.find((m) => m.keys.some((k) => hay.includes(` ${k} `))) ?? null;
}

function findBarangayPin(label) {
  const hay = ` ${normPlace(label)} `;
  const ranked = Object.keys(NAGA_BARANGAY_PINS).sort((a, b) => b.length - a.length);
  const name = ranked.find((n) => hay.includes(` ${normPlace(n)} `)) ?? null;
  if (!name) return null;
  const [lat, lon] = NAGA_BARANGAY_PINS[name];
  return { name, lat, lon };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;');

function readGeoCache() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function geocodeNaga(label) {
  const bare = String(label ?? '').trim();
  if (!bare) return null;
  // Only reached when no barangay was recognized: try the full address, then
  // its head, against Cebu with the city biasing the ranking. Hits naming
  // Naga win over same-named places elsewhere in the province.
  const first = bare.split(',')[0].trim();
  const tries = [bare, ...(first && first !== bare ? [first] : [])];
  for (const q of tries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&countrycodes=ph&viewbox=${NAGA_VIEWBOX}&q=${encodeURIComponent(`${q}, Cebu, Philippines`)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const hits = await res.json();
      const list = Array.isArray(hits) ? hits : [];
      const hit = list.find((h) => /naga/i.test(h.display_name || '')) ?? list[0] ?? null;
      if (hit && Number.isFinite(Number(hit.lat)) && Number.isFinite(Number(hit.lon))) {
        return { lat: Number(hit.lat), lon: Number(hit.lon) };
      }
    } catch {
      // Offline or blocked: the place stays unpinned, the list still counts it.
      return null;
    }
  }
  return null;
}

// Pins for the map, in the list's own order (first = busiest). Re-resolves
// whenever the range's places change; cached answers apply instantly.
function usePlacePins(places) {
  const [pins, setPins] = useState([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const rows = (Array.isArray(places) ? places : []).filter((p) => p.count > 0).slice(0, GEO_MAX);
    if (rows.length === 0) {
      setPins([]);
      setPending(false);
      return undefined;
    }
    let live = true;
    const cache = readGeoCache();
    const save = () => {
      try {
        localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // A full or blocked store only costs re-lookups, never the pins.
      }
    };
    setPending(true);
    (async () => {
      const out = [];
      let idx = 0;
      for (const row of rows) {
        const key = String(row.location ?? '').trim().toLowerCase();
        if (!key) continue;
        // Barangay addresses never touch the network: the pin is known.
        const instant = findBarangayPin(row.location);
        if (instant) {
          out.push({ location: row.location, count: row.count, lat: instant.lat, lon: instant.lon, top: idx === 0, placed: null });
          idx += 1;
          continue;
        }
        // Then the named landmarks: "church in City of Naga" pins on the
        // parish church itself, not on a city-wide shrug.
        const mark = findLandmark(row.location);
        if (mark) {
          out.push({ location: row.location, count: row.count, lat: mark.lat, lon: mark.lon, top: idx === 0, placed: mark.name });
          idx += 1;
          continue;
        }
        let hit = cache[key];
        if (!hit) {
          hit = await geocodeNaga(row.location);
          if (!live) return;
          if (hit) {
            cache[key] = hit;
            save();
          }
          await sleep(900);
          if (!live) return;
        }
        if (hit) {
          out.push({ location: row.location, count: row.count, lat: hit.lat, lon: hit.lon, top: idx === 0 });
          idx += 1;
        }
      }
      if (live) {
        setPins(out);
        setPending(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [places]);
  return { pins, pending };
}

export function LocationMap({ places, onShowList, onSeeDetails }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const leafletRef = useRef(null);
  const [mapsReady, setMapsReady] = useState(false);
  // The popup is Leaflet's DOM, not React's: the "See details" button it
  // carries reaches back through this ref, wired once on popupopen.
  const seeRef = useRef(null);
  seeRef.current = onSeeDetails;
  const rows = (Array.isArray(places) ? places : []).filter((p) => p.count > 0).slice(0, GEO_MAX);
  const { pins, pending } = usePlacePins(places);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    // Leaflet touches `window` at import time: lazy in the browser only, so
    // server-side rendering (rule tests) never executes it.
    import('leaflet').then(({ default: L }) => {
      if (cancelled || !elRef.current || mapRef.current) return;
      // minZoom 12 is the widest the map goes: the whole of Naga City and its
      // coast, never the island, the country, or the world beyond it.
      const map = L.map(elRef.current, { scrollWheelZoom: false, minZoom: 12 }).setView(NAGA_CENTER, 13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      // The page scrolls; the wheel only zooms once the map itself has focus.
      map.on('focus', () => map.scrollWheelZoom.enable());
      map.on('blur', () => map.scrollWheelZoom.disable());
      map.on('popupopen', (ev) => {
        const btn = ev.popup?.getElement()?.querySelector('[data-cmd-see-details]');
        if (btn && !btn.dataset.wired) {
          btn.dataset.wired = '1';
          btn.addEventListener('click', () => seeRef.current?.(btn.getAttribute('data-loc') || ''));
        }
      });
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      leafletRef.current = L;
      timer = setTimeout(() => map.invalidateSize(), 80);
      setMapsReady(true);
    }).catch(() => {
      // No map library, no map: the list view still counts every place.
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (pins.length === 0) {
      map.setView(NAGA_CENTER, 13);
      return;
    }
    const max = Math.max(...pins.map((p) => p.count), 1);
    pins.forEach((p) => {
      const size = 30 + Math.round((p.count / max) * 14);
      L.marker([p.lat, p.lon], {
        title: p.location,
        icon: L.divIcon({
          className: `cmd-map-pin${p.top ? ' cmd-map-pin--top' : ''}`,
          html: `<span>${p.count}</span>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
      })
        .bindPopup(`<strong>${escHtml(p.location)}</strong><br>${p.count} report${p.count === 1 ? '' : 's'} in range${p.placed ? `<br><em>pinned at ${escHtml(p.placed)}</em>` : ''}<br><button type="button" class="cmd-map-details" data-cmd-see-details="1" data-loc="${escAttr(p.location)}">See details &rarr;</button>`)
        .addTo(layer);
    });
    map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lon])).pad(0.25), { maxZoom: 15 });
  }, [pins, mapsReady]);

  if (rows.length === 0) return <EmptyNote>No places recorded in this range.</EmptyNote>;
  const unplotted = rows.length - pins.length;
  return (
    <div className="cmd-locmap">
      <div ref={elRef} className="cmd-locmap__map" role="application" aria-label="Map of report locations in Naga City, Cebu" />
      {pending && pins.length === 0 ? (
        <p className="cmd-locmap__note">Pinning places on the map…</p>
      ) : unplotted > 0 && (
        <p className="cmd-locmap__note">
          {unplotted} place{unplotted === 1 ? '' : 's'} couldn&apos;t be pinned{onShowList ? (<> — <button type="button" className="cmd-locmap__link" onClick={onShowList}>see the list</button></>) : '.'}
        </p>
      )}
    </div>
  );
}

// Top Locations with a Map/List switch: the map pins the range on Naga City,
// the list keeps the exact counts. The toggle lives in the panel's own aside
// slot, beside the title rather than inside the reading.
function LocationsPanel({ places, loading, onOpenReports }) {
  const [mode, setMode] = useState('map');
  return (
    <Panel
      title="Top Locations"
      aside={(
        <div className="cmd-loc-toggle" role="group" aria-label="Top locations view">
          <button type="button" className={mode === 'map' ? 'is-on' : ''} aria-pressed={mode === 'map'} onClick={() => setMode('map')}>Map</button>
          <button type="button" className={mode === 'list' ? 'is-on' : ''} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>List</button>
        </div>
      )}
    >
      {loading ? <PanelSkeleton /> : mode === 'map'
        ? <LocationMap places={places} onShowList={() => setMode('list')} onSeeDetails={(loc) => onOpenReports?.({ q: loc })} />
        : <LocationBars places={places} />}
    </Panel>
  );
}

/** Micro-caption over each box's number, so the figure reads instantly. */
const SYSTEM_METRIC_CAP = { database: 'Ping', storage: 'Disk free', ai: 'Model', notifications: 'Inbox' };

/** The four services the status grid names, in the grid's own order. */
const SYSTEM_SERVICES = [
  { id: 'database', label: 'Database', mark: 'db' },
  { id: 'ai', label: 'AI Service', mark: 'ai' },
  { id: 'storage', label: 'File Storage', mark: 'files' },
  { id: 'notifications', label: 'Notification', mark: 'bell' },
];

/** One service's mark, on the app's own 24-unit grid — no icon package. */
function ServiceMark({ name }) {
  const paths = {
    db: ['M12 3.5c4.4 0 8 1.1 8 2.5s-3.6 2.5-8 2.5-8-1.1-8-2.5 3.6-2.5 8-2.5z', 'M4 6v12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V6', 'M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5'],
    ai: ['M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z', 'M19 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z'],
    files: ['M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
    bell: ['M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z', 'M10 20a2.2 2.2 0 0 0 4 0'],
  }[name] ?? [];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * THE STATION'S OWN PULSE, as four boxes: the database that answers, the
 * captures disk, the AI provider, and the bell's feed — each measured
 * server-side, never guessed in the browser. The grid opens on the dashboard
 * response's own readings, then re-asks `GET /system/health` on its own beat
 * (mount + every minute) with a manual Recheck, so a stale grid is a minute
 * old at most. A failed check keeps the last readings and says so — the grid
 * never paints Online on a guess. Every box names its state (owner request,
 * 2026-10-30: Online in green when healthy); anything else paints amber, and
 * the bell's box carries its live unread count. A service the response does
 * not name is UNKNOWN — a missing key means the read did not happen, not
 * that the service is fine.
 */
export function SystemGrid({ system }) {
  const initial = system && typeof system === 'object' ? system : {};
  const [live, setLive] = useState(initial);
  // The numbers under each state (ping ms, free disk, model name) — measured
  // server-side beside the states, arriving on the same beat.
  const [detail, setDetail] = useState({});
  const [unread, setUnread] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const [h, n] = await Promise.all([
        api('/system/health').catch(() => null),
        api('/notifications').catch(() => null),
      ]);
      if (h && h.system && typeof h.system === 'object') {
        setLive(h.system);
        setCheckedAt(h.checked_at ?? new Date().toISOString());
        setFailed(false);
      } else {
        setFailed(true);
      }
      if (h && h.system_detail && typeof h.system_detail === 'object') setDetail(h.system_detail);
      if (n && typeof n.unread === 'number') setUnread(n.unread);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    recheck();
    const t = setInterval(recheck, 60000);
    return () => clearInterval(t);
  }, [recheck]);

  const stamp = (() => {
    if (!checkedAt) return null;
    const d = new Date(checkedAt);
    if (Number.isNaN(+d)) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  })();
  const caption = checking ? 'Checking…' : failed ? 'Check failed — last reading kept' : stamp ? `Checked ${stamp}` : null;

  return (
    <div className="cmd-sys">
      <ul className="cmd-sys__grid">
        {SYSTEM_SERVICES.map((s) => {
          const value = live[s.id];
          const ok = value === 'online';
          const un = value === undefined || value === null;
          const stateText = ok ? 'Online' : value === 'readonly' ? 'Read-only' : value === 'offline' ? 'Offline' : 'Unknown';
          const sub = s.id === 'notifications'
            ? (unread !== null ? (unread > 0 ? `${unread} unread` : 'All caught up') : null)
            : (typeof detail[s.id] === 'string' && detail[s.id] !== '' ? detail[s.id] : null);
          return (
            <li key={s.id} className={`cmd-sys__box cmd-sys__box--${s.id}${ok ? ' is-online' : ''}${!ok && !un ? ' is-warn' : ''}`} aria-label={`${s.label}: ${(stateText ?? 'unknown').toLowerCase()}${sub ? `, ${sub}` : ''}`}>
              <span className="cmd-sys__glow" aria-hidden="true" />
              <span className="cmd-sys__icon" aria-hidden="true">
                <ServiceMark name={s.mark} />
              </span>
              <span className="cmd-sys__label">{s.label}</span>
              <span className="cmd-sys__state">
                <span className="cmd-sys__dot" aria-hidden="true" />
                {stateText}
              </span>
              {sub && (
                <span className="cmd-sys__metric">
                  <span className="cmd-sys__metric-cap">{SYSTEM_METRIC_CAP[s.id] ?? 'Detail'}</span>
                  <span className="cmd-sys__metric-val">{sub}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {/* No button: the grid re-asks on its own beat (mount + every minute),
          so the caption below is the whole control an officer needs. */}
      <div className="cmd-sys__foot">
        {caption && <span className="cmd-sys__checked">{caption}</span>}
      </div>
    </div>
  );
}

/**
 * REPORT STATUS — draft against filed, from the same status split the register
 * reads, drawn as TWO PILLS under the trend (owner request, 2026-10-30): dot,
 * label, count and share each. Two states, not three: a report that has gone
 * forward is Finalized (see ReportsTable's filter), so submitted and final are
 * read as the one filed bucket the shelf tab holds. Nothing in range means no
 * strip at all — the chart above already says so.
 */
function StatusBars({ status }) {
  const draft = Math.max(0, Number(status?.draft ?? 0));
  const filed = Math.max(0, Number(status?.submitted ?? 0)) + Math.max(0, Number(status?.final ?? status?.finalized ?? 0));
  const total = draft + filed;
  if (total <= 0) return null;
  const rows = [
    { label: 'Draft', count: draft, tone: 'draft' },
    { label: 'Finalized', count: filed, tone: 'finalized' },
  ];
  return (
    <ul className="cmd-statuspills" aria-label="Reports by status">
      {rows.map((r) => (
        <li key={r.label} className={`cmd-statuspill cmd-statuspill--${r.tone}`}>
          <span className="cmd-statuspill__dot" aria-hidden="true" />
          <span className="cmd-statuspill__label">{r.label}</span>
          <span className="cmd-statuspill__count">{fmt.format(r.count)} · {Math.round((r.count / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * AI INSIGHTS — advisory highlights computed from the whole register.
 *
 * Every bullet is a reading of the SAME stats response the panels draw (the
 * busiest day, the leading type, the leading place), so a highlight can never
 * name a fact the charts do not show. Nothing here names a person, a suspect
 * or a conclusion — counts and shares only — and the panel says so.
 *
 * Whether the AI service itself is reachable comes from GET /ai/health: when
 * it is off, the panel says it is off and the bullets are labelled rule-based
 * counts rather than generated prose. A placeholder that pretends to reason
 * would be worse than no panel.
 */
function AiInsights({ data, onFilterType }) {
  const [aiOn, setAiOn] = useState(null);
  useEffect(() => {
    let live = true;
    api('/ai/health')
      .then((h) => { if (live) setAiOn(h?.enabled === true); })
      .catch(() => { if (live) setAiOn(false); });
    return () => { live = false; };
  }, []);
  const cats = Array.isArray(data?.categoryBreakdown) ? data.categoryBreakdown : [];
  const total = cats.reduce((n, c) => n + Number(c.count || 0), 0);
  const days = Array.isArray(data?.seriesOverTime) ? data.seriesOverTime : [];
  const busiest = days.reduce((best, p) => (Number(p.count) > Number(best?.count ?? -1) ? p : best), null);
  const places = Array.isArray(data?.locationBreakdown) ? data.locationBreakdown : [];
  const bullets = [];
  if (busiest && total > 0) {
    bullets.push({
      title: `${fmt.format(busiest.count)} reports on ${busiest.date}`,
      detail: 'The busiest day in this range.',
    });
  }
  if (cats.length > 0 && total > 0) {
    bullets.push({
      title: `${cats[0].type} leads types (${fmt.format(cats[0].count)} of ${fmt.format(total)})`,
      detail: `${Math.round((Number(cats[0].count) / total) * 100)}% of the range — consider narrowing the register to it.`,
      type: cats[0].type,
    });
  }
  if (places.length > 0) {
    bullets.push({
      title: `${places[0].location} leads places (${fmt.format(places[0].count)})`,
      detail: 'The street or barangay with the most reports in this range.',
    });
  }
  // The source line (the AI-connected badge and the from–to range) is removed
  // (owner request, 2026-10-30): the panel is the highlights. `aiOn` still
  // decides whether the rule-based note shows.
  return (
    <div className="cmd-ai">
      {aiOn === false && (
        <p className="cmd-ai__note">
          AI summaries are unavailable — the AI service is not configured. The highlights below are
          rule-based counts from this range, not generated prose.
        </p>
      )}
      {bullets.length === 0 ? (
        <EmptyNote>Nothing in this range to highlight yet.</EmptyNote>
      ) : (
        <ul className="cmd-ai__list">
          {bullets.map((b) => (
            <li key={b.title}>
              <strong>{b.title}</strong>
              <span>{b.detail}</span>
              {b.type && onFilterType && (
                <button type="button" className="cmd-ai__filter" onClick={() => onFilterType(b.type)}>
                  Show only {b.type}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="cmd-ai__advisory">Advisory only — verify against the register. It never determines guilt or replaces police judgment.</p>
    </div>
  );
}

export default function Dashboard({
  user,
  notify,
  onConnError,
  onOpenReports,
  // The station's own name, for the sub-line under the title. Undefined until
  // Shell's letterhead read lands, and the line simply omits it until then.
  stationName = null,
  // Open ONE record, by id — the route Shell owns (the bell uses the same one).
  // The activity rows are the only thing on this page that names a single report.
  onOpenReport,
  // Start a NEW report, and open User Management — both routes Shell owns, so
  // the quick actions and the activity empty-state ask rather than reaching.
  onNewReport,
  onOpenUsers,
}) {
  // The page reads the WHOLE register (owner request, 2026-10-30): every
  // panel except the trend answers for All time, whatever the range control
  // says. The trend reads its own window below (`chartData`) — moving the
  // Last-5-days control re-reads the chart and nothing else.
  const [data, setData] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState(null);
  // The trend opens on the last five days, so it reads five columns on load.
  // Widening to All time, 7/14/30 days, or a custom range re-windows the
  // CHART only — the page around it stays on the register.
  const [preset, setPreset] = useState(5);
  const [scope, setScope] = useState('all');
  // Empty dates mean All time: the server derives the window from the data
  // itself (earliest incident to today) and echoes it back in meta. On load
  // the window is the last five days, so the trend reads five columns.
  const [{ from, to }, setDates] = useState(() => datesForPreset(5));
  const [type, setType] = useState('');
  const now = useNow();
  // The watch the greeting is read on: Day 06:00–18:00 Manila, Night otherwise.
  // Display-only and computed from the clock — never a record, never a roster.
  const shiftHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: MANILA, hour: 'numeric', hour12: false }).format(now),
  );
  const shift = shiftHour >= 6 && shiftHour < 18 ? 'Day' : 'Night';
  // The open self-service recovery requests (Phase 1, S-04), read from their own
  // endpoint so a failure there cannot take the charts down with it.
  const [requests, setRequests] = useState(null);
  // The ID roster for Active Accounts: the live directory (Admin-only), so the
  // one container holds every person's hanging badge — photo front, database
  // identity back. Bare lanyards only, no text or picker inside the plate.
  const [roster, setRoster] = useState(null);
  const [idFaces, setIdFaces] = useState({});
  const [idView, setIdView] = useState('card');
  // Drag-to-open: a badge flicked to the plate's bottom edge and released
  // quickly opens that account inside User Management (see Shell's userId).
  const cardRef = useRef(null);
  const badgeGesture = useRef(null);
  const suppressBadgeClick = useRef(false);
  const [dropTarget, setDropTarget] = useState(null);
  // The badge under the pointer paints above the whole row while it is dragged,
  // so a flicked card never slides underneath its neighbours.
  const [dragId, setDragId] = useState(null);
  const faceBlobs = useRef({});
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Full-bleed page (owner request, 2026-10-30): the shell's own padding and
  // dark backdrop would frame the dashboard with blank sides, so while this
  // screen is mounted the page column carries the dashboard's own background
  // edge to edge — same pattern as `audits-white` / `station-white`.
  useEffect(() => {
    document.body.classList.add('dash-full');
    return () => document.body.classList.remove('dash-full');
  }, []);

  // The page: always the whole register (`range=all`), re-read when the type
  // or scope narrows it — never when the range control moves, which is the
  // chart's own business below.
  const loadPage = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    // range=all asks for the whole register, not the last-30-days fallback
    // the server applies when the window is simply absent.
    params.set('range', 'all');
    if (type) params.set('type', type);
    params.set('scope', scope);

    try {
      const out = await api(`/dashboard/stats?${params.toString()}`);
      if (live.current) setData(out);
    } catch (err) {
      if (isUnreachable(err)) {
        onConnError?.();
        return;
      }
      if (live.current) setError(err?.message || 'The dashboard could not load its data.');
    }
  }, [type, scope, onConnError]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  // The trend: the selected window only. Moving the range control re-reads
  // this and nothing else — the page around the chart stays on the register.
  const loadChart = useCallback(async () => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (!from && !to) params.set('range', 'all');
    if (type) params.set('type', type);
    params.set('scope', scope);

    try {
      const out = await api(`/dashboard/stats?${params.toString()}`);
      if (live.current) setChartData(out);
    } catch (err) {
      if (isUnreachable(err)) {
        onConnError?.();
        return;
      }
      if (live.current) setError(err?.message || 'The dashboard could not load its data.');
    }
  }, [from, to, type, scope, onConnError]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  // The open requests. A read of local state like the rest of the dashboard, and
  // deliberately NOT part of the stats call: a failure here leaves the charts up
  // and simply does not draw the card.
  const loadRequests = useCallback(async () => {
    try {
      const out = await api('/account-requests');
      if (live.current) setRequests(Array.isArray(out?.requests) ? out.requests : []);
    } catch {
      // Left as whatever it was; the card is a convenience, never the page.
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // The ID roster: active accounts only, alphabetical, so the picker walks the
  // same directory User Management shows. A failure here leaves the headcount up
  // and the lanyard on its fallback art — the card is a reading first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await api('/users');
        const rows = Array.isArray(out?.users) ? out.users : [];
        const actives = rows
          .filter((r) => (r?.status ?? 'active') === 'active')
          .sort((a, b) => String(a?.full_name ?? '').localeCompare(String(b?.full_name ?? '')));
        if (!cancelled && live.current) setRoster(actives);
      } catch {
        if (!cancelled && live.current) setRoster([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Every badge in the one container: backs drawn from each row, fronts are the
  // saved photographs (fetched as bytes behind the tab gate) with the status
  // pill printed on, falling back to drawn initials where there is no photo or
  // it cannot be read. Re-prints when the minute turns, so "6m ago" cannot go
  // stale while the dashboard sits open.
  const minuteBucket = Math.floor(Date.now() / 60000);
  useEffect(() => {
    let cancelled = false;
    if (!roster || roster.length === 0) {
      setIdFaces({});
      return undefined;
    }
    const initial = {};
    roster.forEach((person) => {
      const p = presenceOf(person.last_seen_at);
      initial[person.id] = {
        front: personIdFallbackFront(person, p),
        back: personIdBackImage(person, p),
      };
    });
    setIdFaces(initial);
    (async () => {
      for (const person of roster) {
        const p = presenceOf(person.last_seen_at);
        const url = person?.photo_url ?? null;
        if (!url) continue;
        try {
          const blobUrl = await apiBlobUrl(url);
          if (cancelled || !live.current) {
            URL.revokeObjectURL(blobUrl);
            continue;
          }
          if (faceBlobs.current[person.id]) URL.revokeObjectURL(faceBlobs.current[person.id]);
          faceBlobs.current[person.id] = blobUrl;
          const img = await loadPhotoImage(blobUrl);
          if (cancelled || !live.current) continue;
          const front = (img && paintIdPhotoFront(img, p)) || personIdFallbackFront(person, p);
          setIdFaces((prev) => ({
            ...prev,
            [person.id]: { front, back: prev[person.id]?.back ?? personIdBackImage(person, p) },
          }));
        } catch {
          // Keep the initials fallback — a missing face is not a broken card.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roster, minuteBucket]);

  useEffect(() => () => {
    Object.values(faceBlobs.current).forEach((url) => {
      try { URL.revokeObjectURL(url); } catch { /* already gone */ }
    });
    faceBlobs.current = {};
  }, []);

  /** Clear a request's flag once an Admin has acted on it. The ACT itself is done
   *  in User Management and is audited there; this only closes the flag. */
  async function handleRequest(id) {
    try {
      await api(`/account-requests/${id}/handle`, { method: 'POST' });
      setRequests((list) => (list ?? []).filter((r) => r.id !== id));
      notify?.('Request marked handled.');
    } catch (err) {
      notify?.(err.message || 'The request could not be marked handled.');
    }
  }

  // Silent auto-refresh every 60s: supervisors leave this open on a wall
  // screen. Only when there is no error showing, so a real failure stays
  // visible until the viewer acknowledges it with a retry.
  useEffect(() => {
    const iv = setInterval(() => {
      if (!error) {
        loadPage();
        loadChart();
        loadRequests();
      }
    }, 60000);
    return () => clearInterval(iv);
  }, [loadPage, loadChart, loadRequests, error]);

  const applyPreset = (days) => {
    setPreset(days);
    setDates(days === 'all' ? { from: '', to: '' } : datesForPreset(days));
  };

  const clearPreset = () => {
    if (preset !== null) setPreset(null);
  };

  /**
   * Narrow the CHART to one day, from its own right-click menu. The page
   * around it stays on the register — only the trend re-reads.
   *
   * The presets are cleared rather than left lit: a 7d button beside a range of a
   * single day is a control describing something that is not true, which is worse
   * than no button looking active. `preset` is only a highlight — the range itself
   * is `dates`, which is what the chart fetch and its day axis read.
   */
  const focusDay = (date) => {
    clearPreset();
    setDates({ from: date, to: date });
  };

  /**
   * Leave for the register, pre-filtered to the day — and to the incident type of
   * the box that was right-clicked, when the right-click landed on one.
   *
   * The list view's query already carries `date_from`, `date_to` and `type` (see
   * ReportsTable), so this names an existing filter rather than inventing one; what
   * is new is only that the dashboard can now set them.
   */
  const openDay = ({ date, type: dayType }) =>
    onOpenReports?.({ date_from: date, date_to: date, type: dayType || '' });

  const k = data?.kpis;
  // The three hero cards read the REGISTER, not the window (owner request,
  // 2026-10-30): Total, Drafts and Finalized match All Reports — 17, 16, 1 —
  // whatever range the trend is reading. Falls back to the windowed figures on
  // an older cached response that carries no registerTotals.
  const hero = data?.registerTotals ?? k;
  // The range on screen: the picked dates, or — on All time — the window the
  // server derived from the data and echoed back in meta.
  const viewFrom = from || chartData?.meta?.from || '';
  const viewTo = to || chartData?.meta?.to || '';
  const loading = data === null && !error;
  // The trend reads its own fetch: a skeleton until its window answers, even
  // when the page around it has already loaded.
  const chartLoading = chartData === null && !error;

  // ONE order for the chart, applied here and handed to both consumers, so the
  // stack and the key cannot disagree about it. The endpoint returns volume
  // order (most frequent first) and the catch-all bucket is moved to the end on
  // top of that — see orderForDisplay, which also explains why the bucket is the
  // one entry allowed to sit out of volume order. Read off the CHART's window,
  // never the page's, so the stack always answers the range on screen.
  const chartTypes = useMemo(() => orderForDisplay(chartData?.seriesByType), [chartData?.seriesByType]);

  // The donut and the places: all read from the same register response the
  // panels around them read, so no card can disagree with the charts under
  // it — including when the trend above is narrowed to five days.
  const donutRows = useMemo(() => {
    // Blue and yellow only (owner request, 2026-10-30): the trio's composition
    // reads in the station's two colours rather than the chart ramp.
    const DONUT_HUES = ['#2563eb', '#eab308', '#60a5fa'];
    const cats = Array.isArray(data?.categoryBreakdown) ? data.categoryBreakdown : [];
    const top = cats.slice(0, 3).map((c, i) => ({ label: c.type, count: c.count, color: DONUT_HUES[i % DONUT_HUES.length] }));
    const rest = cats.slice(3).reduce((n, c) => n + c.count, 0);
    if (rest > 0) top.push({ label: 'Others', count: rest, color: '#c9a227' });
    return top;
  }, [data?.categoryBreakdown]);

  // The incident-type strip under Total Reports: the range's own
  // categoryBreakdown, already ordered by volume as the server sends it.
  // Reads the same register response as the donut, so the strip can never
  // disagree with the charts under it.
  const typeStrip = useMemo(() => {
    const cats = Array.isArray(data?.categoryBreakdown) ? data.categoryBreakdown : [];
    const total = cats.reduce((n, c) => n + Number(c?.count || 0), 0);
    return {
      total,
      top: cats.slice(0, 4).map((c) => ({ type: c.type, count: Number(c?.count || 0) })),
      rest: Math.max(0, cats.length - 4),
    };
  }, [data?.categoryBreakdown]);

  // Bottom-edge drop: the plate's own box is the target, so a badge flicked
  // down and released fast opens that account. Slow drags and clicks just
  // swing or flip the badge — only a quick drop to the edge navigates.
  const inDropZone = (clientY) => {
    const box = cardRef.current?.getBoundingClientRect();
    if (!box) return false;
    return clientY >= box.bottom - 100;
  };
  // Hover swing: the badge swings from its strap toward the pointer — hover
  // the left half and it swings left, the right half and it swings right.
  // Direct DOM style (no re-render), and fully off while a badge is dragged
  // or any button is held, so it never fights the drag physics. Release
  // gets a springy settle, like a real badge wobbling back onto its hook.
  const tiltBadge = (e) => {
    if (e.pointerType === 'touch' || e.buttons !== 0 || dragId != null) return;
    const stage = e.currentTarget.querySelector('.lanyard');
    if (!stage) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const t = (e.clientX - r.left) / r.width - 0.5;
    stage.style.transition = 'transform 0.15s ease-out';
    stage.style.transform = `rotate(${(t * 18).toFixed(2)}deg) translateX(${(t * 16).toFixed(1)}px)`;
  };
  const untiltBadge = (e) => {
    const stage = e.currentTarget.querySelector('.lanyard');
    if (!stage || !stage.style.transform) return;
    stage.style.transition = 'transform 0.6s cubic-bezier(0.34, 1.45, 0.64, 1)';
    stage.style.transform = '';
  };
  const badgeDragHandlers = (person) => ({
    onPointerDown: (e) => {
      badgeGesture.current = { id: person.id, sx: e.clientX, sy: e.clientY, t: performance.now() };
    },
    onPointerMove: (e) => {
      tiltBadge(e);
      const g = badgeGesture.current;
      if (!g || g.id !== person.id) return;
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 6) setDragId(person.id);
      setDropTarget(inDropZone(e.clientY) ? person.id : null);
    },
    onPointerLeave: (e) => {
      untiltBadge(e);
    },
    onPointerUp: (e) => {
      const g = badgeGesture.current;
      badgeGesture.current = null;
      setDropTarget(null);
      setDragId(null);
      if (!g || g.id !== person.id) return;
      const quick = performance.now() - g.t < 600;
      const dropped = e.clientY - g.sy > 40 && inDropZone(e.clientY);
      if (quick && dropped) {
        suppressBadgeClick.current = true;
        e.preventDefault();
        e.stopPropagation();
        onOpenUsers?.(person.id);
      }
    },
    onPointerCancel: () => {
      badgeGesture.current = null;
      setDropTarget(null);
      setDragId(null);
    },
    onClickCapture: (e) => {
      if (suppressBadgeClick.current) {
        suppressBadgeClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
  });

  return (
    <div className="dash dash--cmd">
      {/* ---- Sign-in health (migration 018 / S-01) -------------------------
          The second factor's preflight, so the station can see its factor is
          healthy BEFORE a shift starts rather than when an officer is already
          locked out. The endpoint is Admin-only because the whole dashboard is,
          and it reports no credentials — only whether mail can send, over which
          transport, and how many accounts hold an offline route. */}
      {data?.signIn && (data.signIn.mailTransport === 'log' || !data.signIn.mailConfigured || data.signIn.accountsWithoutFactor > 0) && (
        <div className="dash-signin-alert" role="status">
          <strong>Sign-in health</strong>
          <ul>
            {!data.signIn.mailConfigured && (
              <li>The sign-in email is not configured — Officer and Admin accounts cannot receive a code.</li>
            )}
            {data.signIn.mailTransport === 'log' && (
              <li>Sign-in codes are being written to the server log, not emailed. Set the mail transport to SMTP for the station.</li>
            )}
            {data.signIn.accountsWithoutFactor > 0 && (
              <li>
                {data.signIn.accountsWithoutFactor} active Admin/Officer account(s) have neither an email
                address nor recovery codes, and cannot sign in at all.
              </li>
            )}
          </ul>
          <p className="dash-signin-note">
            {data.signIn.accountsWithRecovery} account(s) hold offline recovery codes.
          </p>
        </div>
      )}

      {/* ---- Account requests (migration 019 / S-04) -----------------------
          An officer asking for what they cannot change alone: a password reset
          or a fix to the sign-in address their code goes to. This is the FLAG,
          not the act — the Admin resets or edits in User Management, where it is
          audited; "Mark handled" only clears the flag. Admin-only, because the
          whole dashboard is. */}
      {requests && requests.length > 0 && (
        <div className="dash-requests" role="region" aria-label="Account requests">
          <strong>Account requests ({requests.length})</strong>
          <ul className="dash-requests-list">
            {requests.map((r) => (
              <li key={r.id} className="dash-request">
                <div className="dash-request-head">
                  <span className="dash-request-who">
                    {r.full_name}
                    <span className="dash-request-meta"> {r.username} · {r.role} · {r.badge_number}</span>
                  </span>
                  <span className="dash-request-label">{r.kind_label}</span>
                </div>
                {r.reason ? <p className="dash-request-reason">“{r.reason}”</p> : null}
                <div className="dash-request-foot">
                  <span className="dash-request-age">{r.created_label}</span>
                  <button type="button" className="dash-request-handle" onClick={() => handleRequest(r.id)}>
                    Mark handled
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <p className="dash-requests-note">
            Reset the password or fix the address in User Management — that is the recorded act this flag points at.
          </p>
        </div>
      )}

      {/* ---- Command header -------------------------------------------------
          The greeting, the station the page answers for, and the moment it was
          read: the reference's own head. The photograph is the station's own
          file (the same picture the gate stands in front of), masked into the
          panel's right edge rather than pasted beside the words. */}
      <header className="cmd-hero">
        <div className="cmd-hero__photo" aria-hidden="true">
          <img src={stationPhoto} alt="" />
          <span className="cmd-hero__wash" />
          <span className="cmd-hero__station">{(stationName ?? 'City of Naga Police Station').toUpperCase()}</span>
        </div>
        <div className="cmd-hero__text">
          <h2 className="cmd-hello">{dayGreeting()}, <span>{firstName(user)}</span></h2>
          <p className="cmd-sub" role="status" aria-label={`Today is ${MANILA_DATE.format(now)}, ${MANILA_DAY.format(now)}, ${MANILA_TIME.format(now)}`}>
            <span className="cmd-sub__date">{MANILA_DATE.format(now)}</span>
            <span className="cmd-sub__day">{MANILA_DAY.format(now)}</span>
            <span className="cmd-sub__time" aria-live="off">{MANILA_TIME.format(now)}</span>
          </p>
          {/* WHO IS BEING GREETED, and on which watch: the role the session
              holds and the shift the wall clock reads. Neither is a record —
              the role names the account, the shift names the hour. */}
          <p className="cmd-pills">
            <span className="cmd-pill">{user?.role ?? 'Admin'} · {user?.badge_number ?? ''}</span>
            <span className="cmd-pill">Shift: {shift}</span>
          </p>
        </div>
      </header>

      {/* ---- Dashboard toolbar: the quick action -------------------------------
          The rail stays the Admin's only chrome (bell and profile live there),
          so this row is page furniture, not a second nav: the single jump an
          Admin reaches for — new report. It stays top-left, with the metric
          cards stacked below it. */}
      <div className="dash-toprow">
      <div className="dash-toolbar">
        <div className="dash-quick" role="group" aria-label="Quick actions">
          <button type="button" className="dash-quick__btn is-primary" onClick={() => onNewReport?.()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New Report
          </button>
        </div>
      </div>

      {error && (
        <div className="dash-alert" role="alert">
          {error}
          <button type="button" className="dash-alert__retry" onClick={() => { loadPage(); loadChart(); }}>
            retry
          </button>
        </div>
      )}

      {/* ---- Metric cards ---------------------------------------------------
          HIERARCHY: Total Reports is the parent reading (big hero number),
          with Drafts in Progress and Finalized Reports as its children nested
          beneath it — they sum to the total. The three report cards read the
          whole register (registerTotals), so they match All Reports whatever
          window the trend is reading; the panels below keep reading the window.
          Only the headcount keeps its admin/officer line
          (owner request, 2026-10-30). */}
      <section className="dash-kpis cmd-kpis cmd-kpis--hierarchy" aria-busy={loading}>
        {/* Total opens the whole register; each child opens the register
            pre-filtered to what it counts (see ReportsTable's status filter).
            Sibling anchors, never nested — an anchor inside an anchor is
            invalid HTML and breaks keyboard navigation. */}
        <div className="cmd-total-group">
         <div className="cmd-total-row">
          <CardLink label="Total reports in the register" onGo={() => onOpenReports?.({})}>
            <div className="cmd-total-parent">
              <div className="cmd-total-parent__top">
                <span className="cmd-total-eyebrow">
                  <span className="cmd-total-dot" aria-hidden="true" />
                  <span>Total Reports</span>
                  <span className="cmd-total-badge">Register</span>
                </span>
                <span className="cmd-total-view" aria-hidden="true">
                  View all
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
                </span>
              </div>
              <div className="cmd-total-hero">
                <span className="cmd-total-num" title={hero ? fmt.format(hero.total) : undefined}>{hero ? (hero.total > 99 ? '99+' : fmt.format(hero.total)) : '—'}</span>
              </div>
              {(() => {
                const t = hero?.total ?? 0;
                const d = hero?.pending ?? 0;
                const f = hero?.finalized ?? 0;
                const dp = t > 0 ? Math.round((d / t) * 100) : 0;
                const fp = t > 0 ? Math.max(0, 100 - dp) : 0;
                const _f = f;
                void _f;
                return (
                  <>
                    <div className="cmd-total-track" role="img" aria-label={t > 0 ? `${dp}% drafts, ${fp}% filed` : 'Register composition'}>
                      <span className="cmd-total-seg cmd-total-seg--draft" style={{ width: `${loading ? 0 : dp}%` }} />
                      <span className="cmd-total-seg cmd-total-seg--filed" style={{ width: `${loading ? 0 : fp}%` }} />
                    </div>
                    <div className="cmd-total-scale">
                      <span className="cmd-total-scale__item">
                        <i className="cmd-total-key cmd-total-key--draft" aria-hidden="true" />
                        Drafts {loading ? '—' : `${dp}%`}
                      </span>
                      <span className="cmd-total-scale__item">
                        <i className="cmd-total-key cmd-total-key--filed" aria-hidden="true" />
                        Filed {loading ? '—' : `${fp}%`}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </CardLink>
          <div className="cmd-total-children">
            <CardLink label="Drafts in progress" onGo={() => onOpenReports?.({ status: 'draft' })}>
              <div className="cmd-child cmd-child--draft">
                <span className="cmd-child__main">
                  <span className="cmd-child__label">Draft</span>
                  <span className="cmd-child__num" title={hero ? fmt.format(hero.pending) : undefined}>{hero ? (hero.pending > 99 ? '99+' : fmt.format(hero.pending)) : '—'}</span>
                </span>
                <span className="cmd-child__side">
                  <span className="cmd-child__share">{hero && hero.total ? `${Math.round((hero.pending / hero.total) * 100)}%` : '—'}</span>
                  <span className="cmd-child__go" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
                  </span>
                </span>
              </div>
            </CardLink>
            <CardLink label="Finalized reports in the register" onGo={() => onOpenReports?.({ status: 'filed' })}>
              <div className="cmd-child cmd-child--filed">
                <span className="cmd-child__main">
                  <span className="cmd-child__label">Finalize</span>
                  <span className="cmd-child__num" title={hero ? fmt.format(hero.finalized) : undefined}>{hero ? (hero.finalized > 99 ? '99+' : fmt.format(hero.finalized)) : '—'}</span>
                </span>
                <span className="cmd-child__side">
                  <span className="cmd-child__share">{hero && hero.total ? `${100 - Math.round((hero.pending / hero.total) * 100)}%` : '—'}</span>
                  <span className="cmd-child__go" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>
                  </span>
                </span>
              </div>
            </CardLink>
          </div>
          </div>
          {/* Incident types live here, under the total they belong to: the
              strip fills the plate out to the lanyard wall and each row opens
              the register pre-filtered to that type (see initialType). */}
          <div className="cmd-total-types">
            <div className="cmd-total-types__head">
              <span className="cmd-total-eyebrow">
                <span className="cmd-total-dot cmd-total-dot--gold" aria-hidden="true" />
                <span>Incident Type</span>
              </span>
              {typeStrip.total > 0 && (
                <span className="cmd-total-types__count">{fmt.format(typeStrip.total)} in range</span>
              )}
            </div>
            {typeStrip.top.length === 0 ? (
              <p className="cmd-total-types__empty">{loading ? 'Reading the register…' : 'No incidents in this range yet.'}</p>
            ) : (
              <div className="cmd-total-types__body">
                <div className="cmd-total-types__pie">
                  {loading && donutRows.length === 0 ? (
                    <div className="cmd-donut__blank" aria-hidden="true" />
                  ) : (
                    <TypeDonut slices={donutRows} legend={false} />
                  )}
                </div>
                <div className="cmd-total-types__rows">
                  <ul className="cmd-total-types__list">
                    {typeStrip.top.map((t) => {
                      const share = typeStrip.total > 0 ? Math.round((t.count / typeStrip.total) * 100) : 0;
                      return (
                        <li key={t.type}>
                          <button
                            type="button"
                            className="cmd-type-row"
                            title={`Open ${t.type} reports in the register`}
                            onClick={() => onOpenReports?.({ type: t.type })}
                          >
                            <span className="cmd-type-row__name">{t.type}</span>
                            <span className="cmd-type-row__track" aria-hidden="true">
                              <span className="cmd-type-row__fill" style={{ width: `${loading ? 0 : share}%` }} />
                            </span>
                            <span className="cmd-type-row__num">{fmt.format(t.count)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {typeStrip.rest > 0 && (
                    <button type="button" className="cmd-total-types__more" onClick={() => onOpenReports?.({})}>
                      +{typeStrip.rest} more in the register
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <CardLink label="Active accounts" onGo={() => onOpenUsers?.()}>
          {loading ? (
            <MetricCard loading tone="gold" label="Active Accounts" value="—" />
          ) : (
            <div ref={cardRef} className="cmd-card cmd-card--gold cmd-active-lanyard-card is-bare">
              <span className="cmd-id-head" onClick={(e) => e.preventDefault()}>
                <span className="cmd-id-head__title">Users</span>
                <span className="cmd-id-view">
                  <button
                    type="button"
                    className="cmd-id-view__btn is-active"
                    aria-pressed={idView === 'list'}
                    title={idView === 'card' ? 'Switch to list view' : 'Switch to card view'}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdView((v) => (v === 'card' ? 'list' : 'card')); }}
                  >{idView === 'card' ? 'List' : 'Card'}</button>
                </span>
              </span>
              {idView === 'list' ? (
                <span className="cmd-id-list" onClick={(e) => e.preventDefault()}>
                  {(roster ?? []).map((person) => (
                    <span
                      key={person.id}
                      className="cmd-id-row"
                      role="button"
                      tabIndex={0}
                      title={`Open ${person.full_name ?? 'account'} in User Management`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenUsers?.(person.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenUsers?.(person.id); } }}
                    >
                      <span className="cmd-id-row__face" aria-hidden="true">
                        {person.photo_url ? (
                          <ServerPhoto src={person.photo_url} alt="" loading="lazy" />
                        ) : null}
                        <span className="cmd-id-row__initials">{personInitials(person.full_name)}</span>
                      </span>
                      <span className="cmd-id-row__main">
                        <span className="cmd-id-row__name" title={person.full_name}>{person.full_name ?? '—'}</span>
                        <span className="cmd-id-row__sub">ID {person.badge_number ?? '—'} · {person.role ?? '—'} · @{person.username ?? '—'}</span>
                      </span>
                      {(() => {
                        const p = presenceOf(person.last_seen_at);
                        return (
                          <span className={`cmd-pres cmd-pres--static cmd-pres--${p.state}`} title={p.label}>
                            <i aria-hidden="true" />
                            {p.label}
                          </span>
                        );
                      })()}
                    </span>
                  ))}
                </span>
              ) : (
                <>
                <span className="cmd-id-lanyards" onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                  {(roster ?? []).map((person) => (
                    <span
                      key={person.id}
                      className="cmd-active-lanyard cmd-active-lanyard--mini"
                      style={{ width: '200px', height: '300px', zIndex: dragId === person.id ? 999 : undefined }}
                      title={`Drag down to open ${person.full_name ?? 'account'}`}
                      {...badgeDragHandlers(person)}
                    >
                      <Lanyard
                        frontImage={idFaces[person.id]?.front}
                        backImage={idFaces[person.id]?.back}
                        imageFit="cover"
                        cardColor="#ffffff"
                        strapColor={person.role === 'Admin' ? '#1d4ed8' : '#eab308'}
                        metal="gold"
                        finish="glossy"
                        size={0.75}
                        strapLength={0.35}
                        breeze={0}
                        intro={false}
                      />
                    </span>
                  ))}
                </span>
              {dropTarget != null ? (
                <span className="cmd-id-drop" aria-live="polite">
                  Release to open {(roster ?? []).find((p) => p.id === dropTarget)?.full_name ?? 'account'}
                </span>
              ) : null}
              </>
              )}
            </div>
          )}
        </CardLink>
      </section>
      </div>

      {/* ---- Trend --------------------------------------------------------
          Full width, and not beside anything. The trend is the panel an Admin
          actually reads day by day, and at 1.6fr of a shared row each of its 30
          days had about 19px — too little for a column to show a composition.
          Full width gives every day real room, and it keeps the wide-case layout
          the same shape as the narrow case. */}
      <div className="dash-grid-main dash-grid-main--split">
        {chartLoading ? <PanelSkeleton tall /> : (
          <Panel
            title="Reports Overview"
            // The range this head reads, in the head that reads it: one control
            // for the whole page (All time, Last 5 / 7 / 14 / 30 days), beside the
            // colour key — the reference's own arrangement. `preset` is only a highlight;
            // the range itself is `dates`, which is what every fetch reads.
            aside={
              <>
                <ChartKey byType={chartTypes} />
                <RangeSelect preset={preset} onPick={applyPreset} />
              </>
            }
          >
            {/* The status split, as pills under the plot (owner request,
                2026-10-30): Draft and Finalized with their counts and shares,
                read off the register like the hero cards — not a panel of
                their own any more. */}
            <StatusBars status={data?.statusBreakdown} />
            <StackedColumns
              series={chartData?.seriesOverTime ?? []}
              byType={chartTypes}
              scope={scope}
              type={type}
              // The range is already one day when the two ends match, which is how
              // the menu knows that "Filter the chart to this day" has nothing left
              // to do.
              activeDay={viewFrom && viewFrom === viewTo ? viewFrom : ''}
              notify={notify}
              onFocusDay={focusDay}
              onOnlyType={setType}
              onOpenDay={openDay}
            />
          </Panel>
        )}

        {/* THE NEWEST RECORDS, beside the trend rather than under it: the two
            answer the same question at two resolutions — the shape of the range,
            then the last few things that actually happened in it. */}
        <RecentActivity
          reports={data?.recentReports}
          events={data?.recentActivity}
          loading={loading}
          onOpen={onOpenReport}
          onViewAll={() => onOpenReports?.({})}
          // The "widen the dates" hint belongs to a narrowed type only: the
          // activity reads the whole register now, so the chart's range never
          // narrows it — only the incident-type filter can.
          filtered={type !== ''}
          onStart={() => onNewReport?.()}
        />
      </div>

      {/* ---- Duo: place, pulse — above the brief --------------------------------
          Moved above AI Insights (owner request, 2026-10-30): the register's
          own facts read first, the analyst's advice after them. The composition
          moved into the Total Reports plate, so two panels share this row:
          where it happened, and the station's own pulse. */}
      <div className="dash-grid-trio">
        <LocationsPanel places={data?.locationBreakdown} loading={loading} onOpenReports={onOpenReports} />
        {loading ? <PanelSkeleton /> : (
          <Panel title="System Status">
            <SystemGrid system={data?.system} />
          </Panel>
        )}
      </div>

      {/* ---- AI: the analyst's brief ---------------------------------------
          Below the trio (owner request, 2026-10-30), and the one panel on the
          page that is not the register speaking — so it dresses like the
          analyst's brief, not a fourth white card (see styles.css,
          `.dash-panel--ai`). */}
      {loading ? <PanelSkeleton /> : (
        <Panel title="AI Insights" className="dash-panel--ai">
          <AiInsights data={data} onFilterType={setType} />
        </Panel>
      )}

      {/* ---- Incident categories: REMOVED (owner request) -----------------
          The rank chart and its summary strip are gone: the trend, status and
          hour panels plus recent activity are the dashboard. The backend still
          serves seriesByType, categoryDeltas, periodDeltas and finalizeTime, so
          whatever replaces them can be built on the same response. */}

      {/* ---- Workload + activity: REMOVED ---------------------------------
          Both panels were taken off deliberately, so the row is not here. The
          BACKEND was left alone: the payload still carries officerBreakdown and
          recentActivity, so whatever replaces them can be built on the same
          response without touching the API. */}
    </div>
  );
}

// ---- Stacked columns: hand-drawn SVG, zero dependencies ---------------------
//
// One column per day; the bands inside it are that day's incident types, stacked
// from the baseline up in the server's volume order. The column height is still
// the day's total, so this panel keeps the one thing it always showed — the trend
// — and adds the dimension an Admin actually asks about: which KINDS of incident
// make up the day's work, and which recur.
//
// WHY STACKED AND NOT ONE LINE PER TYPE. The data is sparse event counts: the
// station's busiest day in a 30-day window is 9 reports, and six of the eleven
// types never exceed 1 in a day. Eleven near-flat lines would spend the plot on
// the axis and answer nothing. Stacked, the total stays readable as the column
// height and the composition is visible in the same mark.

// The ramp (--cat-1 .. --cat-N) and the stacking arithmetic both live in
// ../lib/dashboardChart.js, where they can be tested. This file only turns band
// counts into geometry.

// How far a hovered column widens, as a multiple of its resting width, and the
// pixel ceiling on that.
//
// WIDTH IS THE ONE DIMENSION IN THIS CHART THAT CARRIES NO DATA. A column's width
// is a layout constant and its height is the count, so growing it under the
// pointer magnifies the boxes — which on a busy day are slivers a few pixels tall
// and hard to aim at — without changing one thing the chart says. The ceiling
// keeps a seven-day window, whose columns are already 40px, from ballooning.
const HOVER_GROWTH = 1.5;
const HOVER_COL_MAX = 64;

// The card that opens beside the hovered column, in pixels. Its band area targets
// MAG_TARGET_H tall and gives each report a share of that, capped so a one-report
// day draws a band rather than a slab, and floored so a sliver stays tall enough to
// sit beside its own label. MAG_CARD_W is stated here because the side the card
// opens toward is decided in pixels; keep it equal to `.dash-mag` in styles.css.
//
// 250 IS THE FLOOR, and the floor is the longest type name, not taste. The card's
// label column is `MAG_CARD_W - 74` (18px padding, 2px border, a 14px chip and two
// 5px gaps, plus the 30px count column), and the longest name the station actually
// uses — "Property Damage / Malicious Mischief" — measures 170.3px in League
// Spartan at 11px. So 245px is where it starts wrapping, and a wrapped row grows
// taller than the band it stands for, which costs the card the proportional stack
// it exists for. 250 leaves 5.7px of slack. Measured in headless Chrome against
// this stylesheet, not estimated: the earlier estimate of ~201px over-padded the
// card, and measuring at parse time instead of after `document.fonts.ready`
// under-sizes it, because the fallback face is 13px wider on that one name.
const MAG_CARD_W = 250;
const MAG_TARGET_H = 160;
const MAG_PX_PER_REPORT_MAX = 28;
const MAG_BAND_MIN_H = 16;

/**
 * The info control: a chart's own "how to read this", behind a disclosure.
 *
 * It began as the trend chart's colour key (see ChartKey, its first user, which is why
 * the class names here are still `dash-key`) — a wrapped row of chips that sat under
 * the plot and spent three lines of the panel's height on every load, whether or not
 * anyone read it. Asking for it gave the plot that height back, and the same affordance
 * is now on every chart panel: what one mark is, what its size means, and what the
 * pointer, the keyboard and the right button do here.
 *
 * NOTHING IS WITHHELD by putting it behind a control. Every chart is described in its
 * own aria-label, the counts and shares are printed in the panels themselves, and the
 * explanation only says what those numbers MEAN — which is exactly the part a reader
 * can ask for.
 *
 * A disclosure, not a menu or a dialog: the panel holds no controls, so there is
 * nothing to move focus into and no focus trap to escape. `aria-expanded` plus
 * `aria-controls` is the whole contract; Escape and a press outside close it,
 * which is the same pair the profile menu and the bell already offer.
 *
 * `label` and `title` are separate on purpose: a screen reader wants the sentence
 * ("How to read the reports by hour"), a pointer wants the three-word version.
 */
function PanelInfo({ label, title, note, hint, children }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  // Unique per instance: five panels now carry a control, and an id written twice
  // would point every `aria-controls` at whichever card was rendered first.
  const panelId = `${useId()}-info`;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="dash-key" ref={wrapRef}>
      <button
        type="button"
        className="dash-key__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-5" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open && (
        <div className="dash-key__panel" id={panelId}>
          {note && <p className="dash-key__note">{note}</p>}
          {hint && <p className="dash-key__note dash-key__note--hint">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The trend chart's own control: the ramp's colour key, plus how the chart reads.
 *
 * The key is here rather than under the plot because the reader can ask for it — and
 * it is the one explanation that needs the map from colour to incident type, which no
 * other chart has.
 */
function ChartKey({ byType }) {
  // Nothing in range means no colours to explain, and a control that opens an empty
  // panel is worse than no control.
  if (!byType.length) return null;
  return (
    <PanelInfo
      label="What the incident type colours mean"
      title="What the column colours mean"
      note="Each column is one day. Bands stack from the bottom up, most frequent at the axis, so the band sitting on the baseline is the station's commonest incident. The number is how many reports of that type were filed in this range. Bands tall enough to hold it carry the incident type, written inside the column."
      // Where a reader looks for how to read the chart, so it is where the chart
      // says it can be right-clicked. Hovering a column finds the breakdown;
      // nothing about hovering it suggests the actions behind the right button.
      hint="Right-click a day for its actions — filter the range to it, open its reports in the register, copy the breakdown, or pin it open."
    >
      <ul className="dash-legend">
        {byType.map((cat, rank) => (
          <li key={cat.type}>
            <span className="dot" style={{ background: rampColor(rank) }} aria-hidden="true" />
            <span className="dash-legend__name">{cat.type}</span>
            <em className="dash-legend__pct">
              {fmt.format(cat.total)}
              <span className="sr-only"> reports</span>
            </em>
          </li>
        ))}
      </ul>
    </PanelInfo>
  );
}

/**
 * The incident type, written INSIDE its own band (owner request, 2026-10-30).
 *
 * The chips above the chart are gone, so the column itself says which type
 * each band is: flat when the band is tall enough for a line of type and wide
 * enough for its name, turned sideways when the band is narrow but tall, and
 * absent on slivers too small for either — the magnifier card still names
 * every type present on those days. The width is an ESTIMATE (name length at a
 * 0.58 advance for 10px type runs a hair wide of the truth), so a name that
 * fits the estimate fits the band.
 */
const SEG_TAG_FS = 9;
const SEG_TAG_ADV = 0.58;
function segTag(type, x, midY, w, h, muted) {
  const name = String(type ?? '');
  if (!name) return null;
  const tagClass = `dash-seg__tag${muted ? ' is-muted' : ''}`;
  const wide = name.length * SEG_TAG_FS * SEG_TAG_ADV;
  // Flat: a 9px line needs 13px of band, with 2px of air on each side.
  if (h >= SEG_TAG_FS + 4 && wide <= w - 4) {
    return (
      <text x={x} y={midY} className={tagClass} fontSize={SEG_TAG_FS} textAnchor="middle" dominantBaseline="central" aria-hidden="true">
        {name}
      </text>
    );
  }
  // Sideways: the band's height is the line's width, and 11px of column is the
  // narrowest a turned name stays legible in.
  if (w >= 11 && wide <= h - 6) {
    return (
      <text
        x={x}
        y={midY}
        transform={`rotate(-90 ${x} ${midY})`}
        className={tagClass}
        fontSize={SEG_TAG_FS}
        textAnchor="middle"
        dominantBaseline="central"
        aria-hidden="true"
      >
        {name}
      </text>
    );
  }
  return null;
}

function StackedColumns({
  series,
  byType,
  // The chart's own filters, needed because a menu entry has to describe the state
  // it is in: "Show only Theft" is the wrong label once Theft is the only thing
  // charted, and the copied text has to say which slice of the register it covers.
  scope = 'all',
  type = '',
  activeDay = '',
  notify,
  // The three things this chart cannot do for itself: it can filter nothing in the
  // Dashboard's state, and it cannot leave the screen.
  onFocusDay,
  onOnlyType,
  onOpenDay,
}) {
  // Must match the plot's CSS height (styles.css, `.dash-plot`), because the
  // viewBox height below IS the pixel height and the two are read as one by every
  // vertical calculation in here. Tall enough to fill the panel beside Recent
  // Activity (owner request, 2026-10-30): at 220px the panel stretched past
  // the plot and left a dead band under the axis.
  const H = 300;
  // The foot is trimmed (owner request, 2026-10-30): 16px under the axis is
  // all the axis labels need, so no empty band sits at the plot's foot.
  const PAD = { l: 34, r: 12, t: 14, b: 16 };
  const [hover, setHover] = useState(null); // index into series
  const [picked, setPicked] = useState(null); // ramp step of the box under the pointer
  // The day whose card is held open, kept as a DATE rather than as an index. The
  // payload is refetched every 60s and the range can change outright, and an index
  // would then pin whichever day had slid into that slot.
  const [pinned, setPinned] = useState(null);
  // The right-click menu, or null: { idx, day, type, at:{x,y} }. `type` is the box
  // the pointer was on, and is '' when it was on the plot but not on a box.
  const [menu, setMenu] = useState(null);

  // The plot's width in CSS pixels, measured from the element it fills.
  //
  // It used to be a hardcoded 720-unit viewBox stretched across the panel by
  // preserveAspectRatio="none". That stretch is horizontal ONLY, and it applies to
  // every mark drawn inside the SVG — including the axis labels. At the ~640px
  // the chart had as a half-row the scale was 0.89, near enough to 1 that nobody
  // could tell. Full width is ~1084px, a scale of 1.51, and there the axis text
  // would be drawn half again as wide as it is tall.
  //
  // Measuring removes the guess instead of re-guessing it: with the viewBox equal
  // to the rendered width one user unit IS one pixel, so every scale is 1:1, the
  // labels keep the size they were written as, and the column cap below is in real
  // pixels rather than an invisible multiplier that changes with the window.
  //
  // Measured in a LAYOUT effect, which runs before the browser paints, so the
  // first frame is already the right size; a passive effect plus a resize observer
  // would paint a stretched fallback once and then visibly snap.
  const wrapRef = useRef(null);
  const [W, setW] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const read = () => {
      const next = Math.round(el.clientWidth);
      // Guarded so an unchanged width is not a redundant render on every resize
      // frame — the observer fires for height changes too.
      if (next > 0) setW((prev) => (prev === next ? prev : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Geometry, once per payload and per width. Kept separate from the band list on
  // purpose: hovering changes which column is widened and painted last, but it must
  // not change the axis, so the scale is computed from the payload and the measured
  // width alone rather than being rebuilt per hover.
  const geo = useMemo(() => {
    const days = Math.max(1, series.length);
    const max = series.length ? Math.max(1, ...series.map((p) => p.count)) : 1;
    // Round the axis up to a tidy number so the top gridline isn't "max+17%".
    const axisMax = Math.max(4, Math.ceil(max / 4) * 4);
    // Guarded for the frame before the first measurement, when W is still 0: a
    // negative inner width would make the band and the column width negative and
    // draw the columns mirrored back across the plot.
    const innerW = Math.max(1, W - PAD.l - PAD.r);
    const innerH = H - PAD.t - PAD.b;
    const band = innerW / days;
    // One gutter between days, capped so a 7-day window does not draw slabs and
    // floored so a 366-day window still draws something visible. The cap is 40
    // PIXELS, which it could not be before: the old 22 was 22 viewBox units worth
    // about 20px in the half-row and about 33px at full width, so "how wide is a
    // column" depended on the window. 40 is wide enough to read as a column and
    // short of the width where a short range stops looking like a distribution.
    const colW = Math.max(1, Math.min(band - 1, 40));
    return { axisMax, innerH, band, colW };
  }, [series, W]);

  const { axisMax, innerH, band, colW } = geo;
  const py = useCallback((v) => PAD.t + innerH - (v / axisMax) * innerH, [innerH, axisMax]);
  const cx = useCallback((i) => PAD.l + band * i + band / 2, [band]);

  // The stack, as data rather than as built <rect>s. Order is the server's: the
  // most frequent type sits at the baseline, so the band that answers "what happens
  // most?" is the one on the axis and it wears the ramp's heaviest step. The four
  // most frequent types cover roughly two thirds of the register, so the baseline
  // is where the reader's eye should land.
  //
  // It is kept as values because the render below needs each band's day and rank to
  // widen the hovered column and to mirror the day in the card, and digging those
  // back out of a built element would mean threading them through props. About
  // eighty small objects per payload costs nothing next to that.
  const bands = useMemo(() => stackBands(series, byType), [series, byType]);

  // WHICH DAY THE PLOT IS TALKING ABOUT: the one under the pointer, or — while the
  // pointer is off the plot — the pinned one. Derived once, so the card, the
  // widened column, the dim and the paint order cannot disagree about which day is
  // being read.
  const pinnedIdx = pinned == null ? -1 : series.findIndex((p) => p.date === pinned);
  const shown = hover != null ? hover : pinnedIdx >= 0 ? pinnedIdx : null;
  const shownDay = shown != null ? series[shown] : null;
  // A pinned day the payload no longer carries — the range moved, and it fell out
  // of it — is released rather than left to reappear on some later payload.
  useEffect(() => {
    if (pinned != null && pinnedIdx < 0) setPinned(null);
  }, [pinned, pinnedIdx]);
  // Escape releases the pin, the way it dismisses everything else in the app. Not
  // while the menu is up, though: one Escape belongs to the menu that is open, and
  // closing both would take the officer two presses past where they aimed.
  useEffect(() => {
    if (pinned == null || menu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPinned(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pinned, menu]);

  const liftedW = Math.min(colW * HOVER_GROWTH, HOVER_COL_MAX);
  // The shown column is drawn LAST so it lands on top of the stack. Widening it
  // makes it overlap its two neighbours, and a column that grew but stayed painted
  // under the day beside it would read as the chart having torn.
  const paintOrder =
    shown == null
      ? bands
      : [...bands.filter((b) => b.day !== shown), ...bands.filter((b) => b.day === shown)];
  // The card MIRRORS the column: the chart stacks rank 0 on the baseline, so the
  // rarest type is the highest band and belongs at the top of the card. Reversed,
  // a box in the chart and its row in the card sit at the same relative height,
  // which is what makes the two read as one thing.
  const dayBands = shown == null ? [] : bands.filter((b) => b.day === shown).slice().reverse();
  const dayTotal = shownDay?.count ?? 0;
  const pxPerReport = dayTotal > 0 ? Math.min(MAG_PX_PER_REPORT_MAX, MAG_TARGET_H / dayTotal) : MAG_PX_PER_REPORT_MAX;
  // True while the card on screen is the pinned one rather than the hovered one.
  const showingPinned = pinnedIdx >= 0 && shown === pinnedIdx;

  // Where the card sits: just outside the shown column's EDGE, on whichever side
  // has room. Anchored to the edge rather than the centre so the card never covers
  // the column it is describing, and decided in pixels, which is exact here because
  // the viewBox IS the pixel width.
  const cardRight = shownDay ? cx(shown) + band / 2 : 0;
  const cardFlips = cardRight + 12 + MAG_CARD_W > Math.max(1, W);
  const cardAnchorX = shownDay ? (cardFlips ? cx(shown) - band / 2 : cardRight) : 0;

  if (!series.length) {
    // Wrapped like the populated state, so this branch carries the element the
    // width is measured from — otherwise the ref would be attached only once there
    // is data to draw, and the effect that reads it has already run by then.
    return (
      <div className="dash-plot-wrap" ref={wrapRef}>
        <svg
          className="dash-plot"
          viewBox={`0 0 ${Math.max(1, W)} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Reports filed over time"
        >
          <text x={Math.max(1, W) / 2} y={H / 2} textAnchor="middle" fontSize="13" className="chart-axis">
            No reports in this range yet.
          </text>
        </svg>
      </div>
    );
  }

  // Pointer -> day, in plot units.
  //
  // ONE function for the hover AND the right-click, because the two have to agree:
  // the columns are drawn from a division of the inner width, and a second copy of
  // that sum is exactly how a context menu comes to act on the day beside the one
  // under the cursor.
  const dayAtPoint = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    return dayAtPointer(x, { width: W, padLeft: PAD.l, padRight: PAD.r, days: series.length });
  };

  // Hover target columns: each day gets an equal slice of the plot.
  const onMove = (e) => {
    const idx = dayAtPoint(e);
    // Only on a real change: mousemove fires continuously, and a state write per
    // event would re-render the card at pointer speed.
    if (idx == null || idx === hover) return;
    setHover(idx);
    // The box highlight belongs to the day being left, so it goes with it.
    // Otherwise arriving at a new column from the background above it — where
    // there is no box under the pointer — would leave a row highlighted for a
    // type the pointer is nowhere near.
    setPicked(null);
  };

  /** The day's actions, at the pointer. */
  const onContextMenu = (e) => {
    const idx = dayAtPoint(e);
    if (idx == null) return;
    const day = series[idx];
    if (!day) return;
    // The box under the pointer, hit-tested from the event rather than read from
    // `picked`: `picked` survives the pointer leaving the band for the day's own
    // background (the card's row highlight wants it to), and a type filter offered
    // for a band the cursor is not on is a wrong action, not a stale highlight.
    const rect = e.currentTarget.getBoundingClientRect();
    const yPlot = ((e.clientY - rect.top) / rect.height) * H;
    const box = bandAtPointer(
      yPlot,
      bands.filter((b) => b.day === idx),
      { axisMax, innerH, padTop: PAD.t },
    );
    // The browser's own menu is swallowed only once there is something to put in
    // its place.
    e.preventDefault();
    setMenu({ idx, day: day.date, type: box?.type ?? '', at: { x: e.clientX, y: e.clientY } });
  };

  /**
   * The clipboard write behind "Copy the day's breakdown".
   *
   * The TYPE the text claims is the chart's own filter, not the box that was
   * right-clicked: this copies the day's whole breakdown, and a line that said
   * "Theft only" because the pointer happened to be on a Theft band would be a
   * false statement about the three other types listed under it.
   */
  async function copyDay(ctx) {
    const rows = bands.filter((b) => b.day === ctx.idx);
    const text = dayBreakdownText(ctx.day, rows, { scope, type });
    if (!text) return;
    try {
      // A blocked clipboard (permissions, insecure origin) is reported rather than
      // swallowed: unlike the terminology panel, where the term is on screen
      // anyway, this menu item exists for nothing else.
      await navigator.clipboard.writeText(text);
      notify?.('Copied that day\u2019s breakdown.');
    } catch {
      notify?.('This browser would not let the page write to the clipboard.');
    }
  }

  /** Dispatch one menu entry. Kept by KEY, so the entries stay data. */
  function runMenuAction(key, ctx) {
    if (key === CHART_MENU.focusDay) onFocusDay?.(ctx.day);
    else if (key === CHART_MENU.onlyType) onOnlyType?.(ctx.type === type ? '' : ctx.type);
    else if (key === CHART_MENU.openReports) onOpenDay?.({ date: ctx.day, type: ctx.type });
    else if (key === CHART_MENU.copyDay) copyDay(ctx);
    else if (key === CHART_MENU.pinDay) setPinned((cur) => (cur === ctx.day ? null : ctx.day));
  }

  /**
   * The same menu, opened without a pointer.
   *
   * Shift+F10 / the Menu key is the only way to reach a context menu from a
   * keyboard, and the plot has no focusable row to hang it on the way the register
   * does — so it opens for the day on screen (the pinned day, else the first) and
   * RowMenu takes focus from there, arrow keys and all.
   */
  const onPlotKeyDown = (e) => {
    if (e.key === 'Escape' && pinned != null) {
      setPinned(null);
      return;
    }
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    const idx = shown != null ? shown : 0;
    const day = series[idx];
    if (!day) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setMenu({ idx, day: day.date, type: '', at: { x: box.left + 12, y: box.top + 12 } });
  };

  // De-duplicated, because a one-day range makes all three of these the same day —
  // and three copies of one date drawn at one x, start-, centre- and end-anchored
  // over each other, is a smear rather than an axis. A single-day range is a state
  // the chart's own menu now leads to ("Filter the chart to this day"), so the axis
  // has to be able to draw it.
  const labelIdx = [...new Set([0, Math.floor(series.length / 2), series.length - 1])];
  const top = byType.slice(0, 3);
  const warning = alignmentWarning(series, byType);
  // The right-click affordance is named here as well as in the key panel: a chart
  // that answers a context menu and never says so answers it for whoever happened
  // to try the right button.
  const plotLabel = `${
    top.length
      ? `Reports per day by incident type. Most frequent: ${top.map((c) => `${c.type}, ${c.total}`).join('; ')}`
      : 'Reports per day'
  }. Right-click a day for its actions.`;

  return (
    // Leaving the plot closes everything, and the boundary is this wrapper rather
    // than the <svg>: it is the box a reader sees as the chart (it holds the note
    // under the plot too), so "the pointer left the chart" is measured once for the
    // whole thing.
    //
    // The card takes no pointer events, so it punches no dead zone through the
    // middle of that box — the day keeps updating as the pointer crosses it, which
    // is what makes the card follow the pointer instead of having to be reached.
    <div
      className="dash-plot-wrap"
      ref={wrapRef}
      onMouseLeave={() => {
        setHover(null);
        setPicked(null);
      }}
      onMouseDown={(e) => {
        // A left click anywhere in the chart releases a pinned card. The RIGHT
        // button is excluded on purpose: it fires mousedown before contextmenu, so
        // releasing the pin here would close the very card the menu is acting on.
        if (e.button === 0 && pinned != null) setPinned(null);
      }}
    >
      <svg
        className="dash-plot"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={plotLabel}
        onMouseMove={onMove}
        onContextMenu={onContextMenu}
        // Focusable so the menu has a keyboard route as well: Shift+F10 / the Menu
        // key open it for the day on screen, and RowMenu takes focus from there.
        tabIndex={0}
        onKeyDown={onPlotKeyDown}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={py(axisMax * f)}
            y2={py(axisMax * f)}
            className="chart-grid"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Drawn BEFORE the bands so it reads as the day's track and never covers
            the data it is pointing at. */}
        {shown != null && (
          <rect x={cx(shown) - band / 2} y={PAD.t} width={band} height={innerH} className="dash-hover-band" />
        )}
        {paintOrder.map((b) => {
          const w = b.day === shown ? liftedW : colW;
          const yTop = py(b.to);
          const yBase = py(b.from);
          // Every day BUT the shown one steps back. The shown column already widens
          // and already sits on its own track, but on a 30-day window that still
          // left it as one of thirty columns of equal weight and made the eye do
          // the separating. A pinned day counts as shown: the card is still open on
          // it, so the emphasise/step-back pair has to still be reading the same
          // day.
          //
          // Only the DATA recedes, never the axis: the day labels are what the shown
          // column is being read against, and they are already the faintest thing
          // on the plot.
          const muted = shown != null && b.day !== shown;
          // Never thinner than a pixel of band to write in: one report on one
          // day is a real fact, and the tag decision below reads this height.
          const bandH = Math.max(1, yBase - yTop);
          return (
            <g key={`${b.day}-${b.type}`}>
            <rect
              className={`dash-seg dash-seg--${rampStep(b.rank)}${muted ? ' is-muted' : ''}`}
              x={cx(b.day) - w / 2}
              y={yTop}
              width={w}
              // ...while the rect below still never vanishes into the baseline.
              height={bandH}
              // The plot is drawn with preserveAspectRatio="none" so the columns can
              // fill whatever width the panel has, which means this 1px separator
              // would otherwise scale with the panel — about 0.8px in the old
              // half-row, about 1.5px now that the chart is full width, and thicker
              // again on a wider monitor. It is the reading device that separates
              // two neighbouring bands, so it is pinned to one device pixel instead
              // of following the stretch.
              vectorEffect="non-scaling-stroke"
              // Which BOX the pointer is on, which is what names it: the card
              // highlights the row with the same rank. Rank is the type's standing
              // across the whole window, so the highlight follows the type, not its
              // position in this particular day.
              onMouseEnter={() => setPicked(b.rank)}
              />
              {segTag(b.type, cx(b.day), (yTop + yBase) / 2, w, bandH, muted)}
            </g>
          );
        })}
        {[0, Math.round(axisMax / 2), axisMax].map((v) => (
          <text key={v} x={PAD.l - 6} y={py(v) + 3} fontSize="9.5" className="chart-axis" textAnchor="end">
            {v}
          </text>
        ))}
        {labelIdx.map((idx, n) =>
          idx >= 0 && idx < series.length ? (
            <text
              key={idx}
              x={cx(idx)}
              y={H - 5}
              fontSize="10"
              className="chart-axis"
              // The first and last are anchored inward so neither runs off the edge
              // of the plot; a lone label is centred on its own column instead, or
              // it would hang to the right of the column it names.
              textAnchor={
                labelIdx.length === 1 ? 'middle' : n === 0 ? 'start' : n === labelIdx.length - 1 ? 'end' : 'middle'
              }
            >
              {series[idx].date.slice(5)}
            </text>
          ) : null
        )}
      </svg>
      {/* The day, magnified, beside the column it came from.

          This replaced a small tooltip that listed the day's types and stopped at
          five of them, with "and 4 more types" under it — so on exactly the busy
          days where a reader needs the make-up, the tooltip withheld part of it.
          The card lists EVERY type present that day, with its count, and its band
          heights are proportional, so it is the column enlarged rather than a
          caption about it.

          IT DOES NOT TAKE THE POINTER, on purpose — with ONE exception. The
          chart's own boxes are the input and this is the display, so every label
          is legible without hovering anything, and the card cannot get in the way
          while the reader sweeps across the columns. A card that accepted the
          pointer would sit in the path from one day to the next and swallow the
          sweep, and any card that opened under the cursor would end it entirely.
          The exception is the rows' DOUBLE-CLICK: it opens the register on that
          day and type, and a double-click is not a sweep, so the one gesture the
          card accepts is one the sweep never makes. */}
      {shownDay && (
        <div
          className="dash-mag"
          style={{
            left: `${(cardAnchorX / Math.max(1, W)) * 100}%`,
            top: `${PAD.t}px`,
            transform: `translate(${cardFlips ? 'calc(-100% - 12px)' : '12px'}, 0)`,
          }}
          role="status"
        >
          <div className="dash-mag__head">
            <strong>{fmt.format(dayTotal)}</strong>
            {dayTotal === 1 ? ' report' : ' reports'}
            {/* MM-DD — the same form the plot's own axis labels use (`date.slice(5)`),
                so the card names the day by the label the reader is already looking
                at rather than by a second convention. A range is capped at 366 days
                (DashboardController::MAX_RANGE_DAYS) and the full range is printed
                above the chart, so dropping the year stays unambiguous — and the
                shorter string is what lets the count column be narrow enough to sit
                under it. */}
            <span className="dash-mag__date">{shownDay.date.slice(5)}</span>
          </div>
          <ul className="dash-mag__stack">
            {dayBands.map((b) => (
              <li
                key={b.type}
                className={picked === b.rank ? 'is-picked' : undefined}
                style={{ minHeight: `${Math.max(MAG_BAND_MIN_H, Math.round(b.value * pxPerReport))}px` }}
                title={`Double-click to open ${b.type} reports for ${shownDay.date} in All Reports`}
                onDoubleClick={() => onOpenDay?.({ date: shownDay.date, type: b.type })}
              >
                <span className="dash-mag__chip" style={{ background: rampColor(b.rank) }} aria-hidden="true" />
                <span className="dash-mag__name">{b.type}</span>
                <em className="dash-mag__n">{b.value}</em>
              </li>
            ))}
          </ul>
          {/* Only while the card is the PINNED one: a hovered card needs no
              explanation of why it is on screen, and a permanent line would cost
              the card height it does not have.

              The dash below is a real character rather than a \u escape, because
              JSX text is literal: an escape written here would be printed to the
              admin verbatim, backslash and all. */}
          {showingPinned && (
            <p className="dash-mag__pinned">Pinned — Esc, or a click on the chart, releases it</p>
          )}
        </div>
      )}
      {/* The day's actions, at the pointer — the register's own menu, given this
          chart's items. Rendered here rather than inside the plot so it survives
          the plot's own re-render, and portaled to <body> by RowMenu itself. */}
      {menu && (
        <RowMenu
          at={menu.at}
          label={`Actions for ${menu.day}`}
          items={chartMenuItems({
            date: menu.day,
            type: menu.type,
            total: series[menu.idx]?.count ?? 0,
            activeType: type,
            activeDay,
            pinned: pinned === menu.day,
            scope,
          }).map((item) => ({ ...item, onSelect: () => runMenuAction(item.key, menu) }))}
          onClose={() => setMenu(null)}
        />
      )}
      {/* The key to the ramp is NOT here any more — it lives in the panel head,
          behind the info control (see ChartKey). It is the same list handed the
          same ordered array, so the Nth band and the Nth key row still identify
          each other; the key was moved, not the ordering. */}
      {warning && <p className="dash-chart-note">{warning}</p>}
    </div>
  );
}

// ---- The peek: the card that answers a hover --------------------------------
//
// Shared by the hour strip and the category rows, so the two panels answer a hover
// the same way. This dashboard already has three readout idioms (the pie's caption,
// the trend chart's magnified day, the bars' own numbers), and a fourth invented per
// panel is how a dashboard stops looking like one thing.
//
// THE CARD DOES NOT TAKE THE POINTER, which is why it can be drawn over the chart it
// describes: the mark under it is still the input, so it cannot get between the
// pointer and the next mark. Same contract as `.dash-mag`; it is also a sibling of the
// chart element rather than a child, because both charts are `role="img"` and
// everything inside one of those is presentational to assistive tech.

/** The peek's width, which src/styles.css states for `.dash-peek`.
 *  The two MUST agree: this number is what decides whether a card fits beside a mark,
 *  and a card measured as fitting that then overflows its panel reads as a rendering
 *  fault. See the note on `.dash-mag` for the same arrangement. */
const PEEK_W = 186;

/**
 * Where a mark's card goes, in its wrapper's own coordinates.
 *
 * Measured from the mark rather than derived from the data: these two charts lay their
 * marks out differently (a 24-column grid, a flex row of tracks), and a second copy of
 * either layout's arithmetic is exactly what would put a card beside the wrong bar.
 * `flip` says the mark's right edge had no room for the card, so it grows LEFTWARD
 * from that edge instead.
 */
function peekAt(mark, wrap) {
  const m = mark?.getBoundingClientRect();
  const w = wrap?.getBoundingClientRect();
  if (!m || !w || !w.width) return null;
  const x = m.right - w.left;
  return { x, y: m.top - w.top + m.height / 2, flip: x + PEEK_W + 14 > w.width };
}

function Peek({ at, children }) {
  if (!at) return null;
  return (
    <div
      className="dash-peek"
      style={{
        left: `${at.x}px`,
        top: `${at.y}px`,
        transform: `translate(${at.flip ? 'calc(-100% - 10px)' : '10px'}, -50%)`,
      }}
      // A live region, like the trend chart's card: the keyboard walk moves it from
      // hour to hour, and the readout has to arrive on its own. A pointer hover simply
      // rewrites it.
      role="status"
    >
      {children}
    </div>
  );
}

// ---- Incident categories over time: rank lanes -------------------------------
//
// WHAT THIS ANSWERS that the bar list could not: which type is getting HIGHER. The list
// gave each type's count in the range, which is a fact about how much work there was and
// not about where it is going; a type can double while another triples, and both bars
// just sit there. So each type is drawn as its RANK in every bucket of the range, and a
// climb is a line going up.
//
// Every rule behind the picture — how time is bucketed, that an absent type is absent
// rather than last, how ties break, which types earn a line — lives in
// src/lib/categoryRank.js and is tested there. This draws what that returns.

const RANK_H = 236;
const RANK_PAD = { l: 30, r: 8, t: 14, b: 26 };
// How far apart two legend names must sit, in pixels.
const LEGEND_STEP = 22;

/**
 * The legend column's rows: one per drawn line, at that line's own end height, so a name
 * points at a line instead of merely being near it.
 *
 * Two ranks can land closer together than a name is tall — eleven types on a 236px plot
 * is 20px a lane — and two names printed on top of each other name nothing. So the rows
 * are pushed down by the minimum that separates them. The swatch's colour, not the exact
 * pixel, is what ties a row to its line.
 */
function legendRows(geometry) {
  const rows = (geometry ?? [])
    .map((t) => ({ ...t, top: (t.end?.y ?? RANK_PAD.t) - 10 }))
    .sort((a, b) => a.top - b.top);
  let floor = -Infinity;
  return rows.map((row) => {
    const top = Math.max(row.top, floor);
    floor = top + LEGEND_STEP;
    return { ...row, top };
  });
}

function CategoryRank({ series, byType, deltas, rangeTotal, from, to, onOpenReports }) {
  // WHICH TYPE IS PICKED, and which bucket is being read: two dimensions, two pieces of
  // state, because they are two different questions ("is this type climbing?" and "what
  // happened that week?") and neither is derivable from the other.
  const [focused, setFocused] = useState(null);
  const [read, setRead] = useState(null);
  // TWO refs, because they are two different frames: `wrapRef` is what the card is
  // positioned inside (the whole chart, labels included), and `plotRef` is the column the
  // SVG fills — the thing whose width IS the plot's width. Measuring the wrapper for the
  // SVG is what pushed the type labels off the panel: the grid then held an SVG as wide as
  // the panel AND a label column beside it.
  const wrapRef = useRef(null);
  const plotRef = useRef(null);
  const [W, setW] = useState(0);

  // Measured in a LAYOUT effect, which runs before the browser paints, so the first
  // frame is already the right size — see StackedColumns for the same arrangement.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const measure = () => {
      const next = Math.round(el.clientWidth);
      if (next > 0) setW((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chart = useMemo(() => {
    const { size, buckets } = bucketize(series ?? []);
    if (!buckets.length || !(byType ?? []).length) return null;
    const { lanes, perType } = rankByBucket(byType, buckets);
    const { drawn, omitted } = chooseDrawn(perType);
    const width = Math.max(1, W || 0);
    const geometry = drawn.length
      ? rankGeometry(drawn, { lanes, width, height: RANK_H, pad: RANK_PAD })
      : [];
    return {
      size,
      buckets,
      lanes,
      perType,
      drawn,
      omitted,
      geometry,
      ticks: axisTicks(buckets),
      headline: rankHeadline(perType, buckets),
      // The legend is built HERE rather than in a second memo of its own. A second memo
      // would have to read `chart` — the const being initialised by this very call — and
      // a `const` in its own initialiser's dependency array is the temporal dead zone:
      // the panel renders blank and React throws on the first frame.
      legend: legendRows(geometry),
      // The column each bucket occupies, for the hover targets and the highlight band.
      // `inner` is floored at zero because the plot is MEASURED and can momentarily be
      // narrower than its own padding: a negative width is not a narrow bar, it is an
      // SVG attribute error that React logs and drops.
      column: (i) => {
        const inner = Math.max(0, width - RANK_PAD.l - RANK_PAD.r);
        const step = buckets.length > 1 ? inner / (buckets.length - 1) : 0;
        const x = RANK_PAD.l + i * step;
        const w = buckets.length > 1 ? step * 0.62 : inner;
        return { x: x - w / 2, width: w };
      },
    };
  }, [series, byType, W]);

  /**
   * The plot walks BUCKETS on the arrow keys, stopping at both ends, and the type list
   * beside it is a row of real buttons — so the two questions this chart asks have two
   * different controls instead of one widget overloaded with four arrow keys.
   */
  const onPlotKeyDown = (e) => {
    if (!chart) return;
    if (e.key === 'Escape') {
      setRead(null);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const last = chart.buckets.length - 1;
    const cur = read?.bucket ?? null;
    const next = Math.min(last, Math.max(0, (cur == null ? (step > 0 ? -1 : last + 1) : cur) + step));
    readBucket(next, wrapRef.current?.querySelector(`[data-bucket="${next}"]`));
  };

  /** Read one bucket: the band, the card and the highlight all come from it. */
  const readBucket = (bucket, mark) => {
    const at = peekAt(mark, wrapRef.current);
    if (at) setRead({ bucket, ...at });
  };

  const rangeTotalSafe = rangeTotal ?? chart?.perType.reduce((sum, t) => sum + t.total, 0) ?? 0;
  const reading = chart && focused ? typeReading(chart.perType.find((t) => t.type === focused), { deltas, rangeTotal: rangeTotalSafe }) : null;

  const focusHandlers = (type) => ({
    onMouseEnter: () => setFocused(type),
    // Cleared only if this label is still the focused one, so moving from one label to
    // the next does not blink the highlight off on the way (the leave fires after the
    // enter of the label being moved to).
    onMouseLeave: () => setFocused((cur) => (cur === type ? null : cur)),
    onFocus: () => setFocused(type),
    onBlur: () => setFocused((cur) => (cur === type ? null : cur)),
  });

  if (!chart) {
    return (
      <div className="dash-rank" ref={wrapRef}>
        <EmptyNote>No incidents in this range yet.</EmptyNote>
      </div>
    );
  }

  const { buckets, lanes, perType, drawn, omitted, ticks, geometry, headline, legend, column } = chart;
  const readAt = read == null ? null : buckets[read.bucket];

  return (
    <div className="dash-rank" ref={wrapRef}>
      <div className="dash-rank__body">
        {/* The measured column: the SVG fills it, and the type list gets the rest. */}
        <div className="dash-rank__cell" ref={plotRef}>
        <svg
          className="dash-rank__plot"
          viewBox={`0 0 ${W || 1} ${RANK_H}`}
          width={W || 1}
          height={RANK_H}
          role="img"
          aria-label={`Incident type by rank per ${bucketNoun(chart.size, 2)} from ${buckets[0].start} to ${buckets[buckets.length - 1].end}, ${perType.length} types, the top ${drawn.length} drawn. ${headline.text} Arrow keys read a ${bucketNoun(chart.size, 1)} at a time.`}
          tabIndex={0}
          onKeyDown={onPlotKeyDown}
          onMouseLeave={() => setRead(null)}
          onBlur={() => setRead(null)}
        >
          {/* Rank 1 at the TOP: higher on the chart has to mean a better position, or
              every line in it reads backwards. */}
          {Array.from({ length: lanes }, (_, i) => {
            const y = RANK_PAD.t + (lanes === 1 ? 0 : (i / (lanes - 1)) * (RANK_H - RANK_PAD.t - RANK_PAD.b));
            return (
              <g key={i}>
                <line className="dash-rank__lane" x1={RANK_PAD.l} y1={y} x2={W - RANK_PAD.r} y2={y} />
                <text className="dash-rank__lanenum" x={RANK_PAD.l - 9} y={y + 3.5} textAnchor="end">
                  {i + 1}
                </text>
              </g>
            );
          })}

          {/* The bucket being read, as a band behind the lines — the device the hour
              strip and the trend chart both use for "this is the column in question". */}
          {readAt && (
            <rect className="dash-rank__band" x={column(read.bucket).x} y={RANK_PAD.t - 4} width={column(read.bucket).width} height={RANK_H - RANK_PAD.t - RANK_PAD.b + 8} />
          )}

          {/* A rule per slice, down the plot. The lanes give the ranks their rows; these
              give the slices their columns, so a wide panel reads as a table the lines
              move through rather than as empty space they happen to cross. */}
          {buckets.map((_, i) => (
            <line
              key={`v${i}`}
              className="dash-rank__grid"
              x1={column(i).x + column(i).width / 2}
              y1={RANK_PAD.t - 6}
              x2={column(i).x + column(i).width / 2}
              y2={RANK_H - RANK_PAD.b + 2}
            />
          ))}

          {geometry.map((t) => {
            const color = rampColor(Math.max(0, byType.findIndex((x) => x.type === t.type)));
            const isOn = focused === t.type;
            const dim = focused != null && !isOn;
            return (
              <g
                key={t.type}
                className={`dash-rank__line${isOn ? ' is-focused' : ''}${dim ? ' is-muted' : ''}`}
                stroke={color}
              >
                {/* A line is drawn as several segments, never joined across a bucket the
                    type had nothing in: the gap is the fact. */}
                {t.segments.map((seg, i) => (
                  <polyline key={i} points={seg.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" />
                ))}
                {/* A bead at every slice the type appeared in. A rank is a POSITION,
                    and a bare polyline leaves the reader guessing where the readings
                    actually are — the beads are where the data is and the lines only
                    join one to the next. They also keep a type that reported in a
                    single slice on the chart at all: a one-point polyline draws
                    nothing, which is how a type quietly vanishes from a rank chart. */}
                {t.points.map((p) => (
                  <circle key={`d${p.index}`} cx={p.x} cy={p.y} r={isOn ? 3.6 : 2.4} fill={color} />
                ))}
              </g>
            );
          })}

          {ticks.map((tick) => (
            <text key={tick.index} className="dash-rank__axis" x={column(tick.index).x + column(tick.index).width / 2} y={RANK_H - 8} textAnchor="middle">
              {tick.label}
            </text>
          ))}

          {/* The hover targets, one per bucket, drawn last so they sit over everything:
              the plot answers "what happened that week" from anywhere in the column. */}
          {buckets.map((_, i) => (
            <rect
              key={i}
              data-bucket={i}
              className="dash-rank__hit"
              x={column(i).x}
              y={0}
              width={column(i).width}
              height={RANK_H}
              onMouseEnter={(e) => readBucket(i, e.currentTarget)}
            />
          ))}
        </svg>
        </div>

        {/* THE TYPE LIST, and the only interactive part of the chart a pointer or a
            keyboard reaches by name. Each one is a real button: hovering or focusing it
            picks that type out of the tangle, and pressing it opens those reports in the
            register — so "who is this line?" and "show me them" are the same control. */}
        <ul className="dash-rank__labels">
          {legend.map((t) => {
            const color = rampColor(Math.max(0, byType.findIndex((x) => x.type === t.type)));
            return (
              <li key={t.type} style={{ top: t.top }}>
                <button
                  type="button"
                  className={`dash-rank__label${focused === t.type ? ' is-focused' : ''}`}
                  style={{ color }}
                  {...focusHandlers(t.type)}
                  onClick={() => onOpenReports?.({ date_from: from, date_to: to, type: t.type })}
                  title={`${t.type} — ${fmt.format(t.total)} in this range; open them in the register`}
                >
                  <span className="dash-rank__swatch" aria-hidden="true" />
                  <span className="dash-rank__name">{t.type}</span>
                  <em className="dash-rank__count">{fmt.format(t.total)}</em>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* THE SENTENCE, under the chart and OUTSIDE its grid. It used to be a child of
          `.dash-rank__body` — a two-column grid — so the reader's answer sat in the left
          column while the footnote about the cut was squeezed into the 176px legend
          column beside it. Under the chart, both are the full width of the panel.

          One line, and its height is reserved: picking a type swaps the range's own
          sentence for that type's reading, and the panel must not move while the reader
          moves along the lines. */}
      <p className="dash-rank__note">
        {reading ? (
          <>
            <strong>{reading.type}</strong> — {fmt.format(reading.total)} report
            {reading.total === 1 ? '' : 's'}
            {reading.share != null && <> · {reading.share}% of the range</>}
            {reading.deltaPct != null && reading.deltaPct !== 0 && (
              <> · {reading.deltaPct > 0 ? 'up' : 'down'} {Math.abs(reading.deltaPct)}% on the previous period</>
            )}
            {' · '}
            ranked in {reading.rankedIn} of {reading.bucketCount} {bucketNoun(chart.size, reading.bucketCount)}
          </>
        ) : (
          headline.text
        )}
      </p>

      {/* The bucket under the pointer: every drawn type's standing in it, in order. */}
      {readAt && (
        <Peek at={read}>
          <div className="dash-peek__head">
            <strong>{readAt.label}</strong>
            <span>{bucketNoun(chart.size, 1)} ending</span>
          </div>
          <ul className="dash-peek__rows">
            {drawn
              .map((t) => ({ type: t.type, count: t.counts[read.bucket], rank: t.ranks[read.bucket] }))
              .filter((r) => r.rank !== null)
              .sort((a, b) => a.rank - b.rank)
              .map((r) => (
                <li key={r.type}>
                  <span>
                    {r.rank}. {r.type}
                  </span>
                  <em>{fmt.format(r.count)}</em>
                </li>
              ))}
          </ul>
        </Peek>
      )}

      {omitted > 0 && (
        <p className="dash-rank__omitted">
          {omitted} more type{omitted === 1 ? '' : 's'} had reports here, too few to rank across the range.
        </p>
      )}
    </div>
  );
}

// ---- Status pie: three extruded wedges ---------------------------------------

// The three status inks are NOT named here. They belong to the fills, styles.css
// declares one per status against `.dash-pie__slice--<key>`, and the wedge is the
// only thing that wears them — so there is no second place for a colour to live.
//
// Drawing order, clockwise from 12 o'clock — the workflow's order (final,
// submitted, draft). Nothing here sorts by size: a pie ordered by value would move
// the workshop's own sequence around, and the colours only stay learnable while the
// order stays put.
const STATUS_SLICES = [
  { key: 'final', label: 'Final' },
  { key: 'submitted', label: 'Finalized' },
  { key: 'draft', label: 'Draft' },
];

// How far the stage leans toward the pointer, in degrees, at the edge of the box.
// Small on purpose: the lean is depth, not a spinning toy, and past about 8° the
// ellipse stops reading as a table seen from above and starts reading as tipped.
const TILT_MAX_DEG = 6;

function StatusPie({ status, scope = 'all', type = '', notify, onOpenReports }) {
  // THREE PIECES OF STATE, and the tilt is deliberately not one of them:
  //
  //   active  — which wedge the pointer is on. The readout's normal mode: a count
  //             is read off this chart by pointing at it (see the caption below).
  //   pinned  — which wedge the readout HOLDS, set from the right-click menu and
  //             released by Esc or a left click, the same contract as the trend
  //             chart's pinned day.
  //   menu    — the right-click menu's slice and position, or null.
  //
  // The pointer's parallax lean writes two custom properties straight onto the
  // stage instead (onStageMove): a state write per mousemove would re-render the
  // wedges at pointer speed for an effect that is nothing but presentation.
  const [active, setActive] = useState(null);
  const [pinned, setPinned] = useState(null);
  const [menu, setMenu] = useState(null);
  const stageRef = useRef(null);

  const { total, wedges } = pieWedges(
    STATUS_SLICES.map((s) => ({ ...s, value: status?.[s.key] ?? 0 })),
  );
  // WHICH SLICE THE READOUT IS ABOUT: the one under the pointer, else the pinned
  // one. Derived once, so the caption, the lift and the dim cannot disagree — and
  // hovering OVERRIDES the pin, the way the chart's hovered day overrides its
  // pinned one.
  const focusKey = active ?? pinned;
  const focus = wedges.find((w) => w.key === focusKey) ?? null;

  // A pinned slice the payload no longer carries — the range moved and it fell out
  // of it — is released rather than left to reappear on some later payload.
  useEffect(() => {
    if (pinned != null && !wedges.some((w) => w.key === pinned)) setPinned(null);
  }, [pinned, wedges]);

  // Escape releases the pin, the way it dismisses everything else in the app. Not
  // while the menu is up, though: one Escape belongs to the menu that is open.
  useEffect(() => {
    if (pinned == null || menu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPinned(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pinned, menu]);
  // The stage wears the module's own box rather than a size repeated in CSS: the
  // pop is solved against that box's margin, so a stage that disagreed with it
  // would clip the lifted wedge — and a clipped wedge reads as a rendering
  // glitch, not as a size that needs changing.
  const stage = { width: PIE_BOX.w, height: PIE_BOX.h };

  if (total === 0) {
    return (
      <div className="dash-pie">
        {/* The stage keeps the pie's own box, so the placeholder is the size of
            the thing it stands in for. Left bare it had no width or height of its
            own and fell back to the browser's 300x150 default — a placeholder
            nearly twice the size of the chart it replaced. */}
        <div className="dash-pie__stage" style={stage}>
          <svg
            viewBox={`0 0 ${PIE_BOX.w} ${PIE_BOX.h}`}
            role="img"
            aria-label="No reports in range"
          >
            <text
              x={PIE_CENTER.x}
              y={PIE_CENTER.y + 4}
              textAnchor="middle"
              fontSize="12"
              className="chart-axis"
            >
              No data
            </text>
          </svg>
        </div>
        {/* The caption keeps its space even with nothing to say, so the panel does
            not reflow between an empty range and a populated one. */}
        <p className="dash-pie__caption" />
      </div>
    );
  }

  // ---- The pointer's lean, the clipboard, and the menu's dispatch ------------

  /**
   * The stage leans toward the pointer — the pie turns to face what is being read.
   *
   * Two custom properties written straight onto the element: the lean is pure
   * presentation, and driving it through state would re-render every wedge at
   * pointer speed. CSS interpolates the written value, so the lean GLIDES into
   * place instead of tracking the cursor pixel-for-pixel, and under reduced motion
   * the stylesheet drops the transform entirely (styles.css) — nothing here has to
   * know which mode is on.
   */
  const onStageMove = (e) => {
    const el = stageRef.current;
    if (!el) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    el.style.setProperty('--pie-tilt-x', `${(-ny * TILT_MAX_DEG).toFixed(2)}deg`);
    el.style.setProperty('--pie-tilt-y', `${(nx * TILT_MAX_DEG).toFixed(2)}deg`);
  };
  const onStageLeave = () => {
    const el = stageRef.current;
    if (!el) return;
    el.style.setProperty('--pie-tilt-x', '0deg');
    el.style.setProperty('--pie-tilt-y', '0deg');
  };

  /**
   * The clipboard write behind "Copy the breakdown".
   *
   * A blocked clipboard (permissions, insecure origin) is reported rather than
   * swallowed: this menu entry exists for nothing else.
   */
  async function copyFigures() {
    const text = statusBreakdownText(wedges, { total, scope, type });
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify?.('Copied the status breakdown.');
    } catch {
      notify?.('This browser would not let the page write to the clipboard.');
    }
  }

  /** Dispatch one menu entry. Kept by KEY, so the entries stay data. */
  function runMenuAction(key, ctx) {
    if (key === PIE_MENU.openReports) onOpenReports?.({ status: REGISTER_STATUS[ctx.status] ?? '' });
    else if (key === PIE_MENU.copyFigures) copyFigures();
    else if (key === PIE_MENU.pinSlice) setPinned((cur) => (cur === ctx.status ? null : ctx.status));
  }

  /**
   * The same menu, opened without a pointer.
   *
   * Shift+F10 / the Menu key is the only way to reach a context menu from the
   * keyboard, and it opens for the slice on screen (the focused one, else the
   * first) — RowMenu takes focus from there, arrow keys and all.
   */
  const onSvgKeyDown = (e) => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    const w = focus ?? wedges[0];
    if (!w) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setMenu({ status: w.key, label: w.label, at: { x: box.left + 12, y: box.top + 12 } });
  };

  // The caption is where a 3D pie keeps what its missing hole used to say, and now
  // that the key under the pie is gone it is the WHOLE readout: the total at rest,
  // and pointed at a wedge that wedge's exact count and share. That is not
  // decoration — the drawn area of a foreshortened wedge, with a wall added to
  // whichever slices face the reader, is not a number anybody should read off it, so
  // the printed figures are the measurement and the shape is the summary. The
  // trade in removing the key is that a count is now read by pointing at it rather
  // than by scanning a row; the aria-label below still states all three at once.
  const caption = focus ? (
    <>
      <strong>{focus.label}</strong> — {fmt.format(focus.value)}{' '}
      <span className="dash-pie__caption-pct">({focus.pct}%)</span>
      {/* Only for the PINNED slice, and only while the pointer is not elsewhere:
          a readout that stays after the pointer has left is otherwise
          indistinguishable from one that is stuck, and the menu is the way out. */}
      {focus.key === pinned && <span className="dash-pie__caption-pin"> · pinned</span>}
    </>
  ) : (
    <>
      <strong>{fmt.format(total)}</strong> reports
    </>
  );

  return (
    // A left click releases a pinned slice. The RIGHT button is excluded on
    // purpose: it fires mousedown before contextmenu, so releasing the pin here
    // would close the very readout the menu is acting on.
    <div
      className={focus ? 'dash-pie is-lifted' : 'dash-pie'}
      onMouseDown={(e) => {
        if (e.button === 0 && pinned != null) setPinned(null);
      }}
    >
      <div
        className="dash-pie__stage"
        style={stage}
        ref={stageRef}
        onPointerMove={onStageMove}
        onPointerLeave={onStageLeave}
      >
        <svg
          viewBox={`0 0 ${PIE_BOX.w} ${PIE_BOX.h}`}
          role="img"
          aria-label={`Reports by status: ${wedges
            .map((w) => `${w.label} ${fmt.format(w.value)} (${w.pct}%)`)
            .join(', ')}`}
          // Focusable so the menu has a keyboard route as well: Shift+F10 / the
          // Menu key open it for the slice on screen.
          tabIndex={0}
          onKeyDown={onSvgKeyDown}
        >
          <defs>
            {/* THE WALL'S CURVATURE, painted rather than filtered. The wall is one
                flat brightness step today; a cylinder's side falls into shadow as
                it turns away, so this is a black falloff laid over the wall's own
                path — dark at both ends of the rim, clear across the middle where
                the surface faces the reader. Black-only on purpose: the wall is
                shaded by darkening and never by brightening (see the note on the
                SVG filter clamp in styles.css), and one overlay serves every
                status ink instead of three hand-picked shades. */}
            <linearGradient
              id="pie-wall-shade"
              gradientUnits="userSpaceOnUse"
              x1={-PIE_RX}
              y1="0"
              x2={PIE_RX}
              y2="0"
            >
              <stop offset="0" stopColor="#000" stopOpacity="0.38" />
              <stop offset="0.5" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.38" />
            </linearGradient>
            {/* THE GROUND, and the one depth cue the extrusion cannot draw for
                itself: a soft shadow pooled under the pie, so the slab reads as
                sitting on the panel instead of floating over it. It spreads under
                a lifted slice — the wedge is closer to the table, so its shadow is
                wider and softer. */}
            <radialGradient id="pie-ground-shadow">
              <stop offset="0" stopColor="#0B1220" stopOpacity="0.3" />
              <stop offset="0.65" stopColor="#0B1220" stopOpacity="0.1" />
              <stop offset="1" stopColor="#0B1220" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g transform={`translate(${PIE_CENTER.x} ${PIE_CENTER.y})`}>
            {/* Behind the wedges, or it would pool OVER the wall it is under. */}
            <ellipse
              className="dash-pie__ground"
              cx="0"
              cy={PIE_RY + PIE_DEPTH + 5}
              rx={PIE_RX * 1.02}
              ry="9"
            />
            {wedges.map((w) => {
              // The pop is the offset to apply WHEN THIS ONE IS PICKED, not a
              // property of every wedge. Applying it unconditionally pulls all three
              // apart at rest, which leaves a three-pointed hole of page background
              // around the centre — measured from rendered pixels at 3x, not guessed:
              // the hole was 19px wide on the centre line.
              const lifted = focus?.key === w.key;
              // Every OTHER wedge steps back while one is being read, the same
              // device the trend chart uses on its columns: on three wedges the
              // lifted one already pops, but it was still one of three marks of
              // equal weight and left the separating to the reader's eye.
              const muted = focus != null && !lifted;
              return (
                <g
                  key={w.key}
                  className={`dash-pie__slice dash-pie__slice--${w.key}${lifted ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
                  // Set as a CSS transform rather than as a transform ATTRIBUTE, so
                  // it can be transitioned: an attribute cannot be interpolated. The
                  // pop travels along the slice's own bisector and the scale grows
                  // it about the pie's centre — together, the wedge coming toward
                  // the reader (see PIE_LIFT_SCALE).
                  style={lifted ? { transform: `translate(${w.pop.dx}px, ${w.pop.dy}px) scale(${PIE_LIFT_SCALE})` } : undefined}
                  onMouseEnter={() => setActive(w.key)}
                  onMouseLeave={() => setActive(null)}
                  onContextMenu={(e) => {
                    // The browser's own menu is swallowed only once there is
                    // something to put in its place — and there always is here.
                    e.preventDefault();
                    setMenu({ status: w.key, label: w.label, at: { x: e.clientX, y: e.clientY } });
                  }}
                >
                  {/* The wall hangs under this slice's OWN arc, and each angle maps to
                      exactly one x, so the front walls occupy disjoint spans and the
                      draw order does not matter — see statusPie.js. The shade is the
                      same path again, in the curvature falloff from the defs. */}
                  {w.sidePath && (
                    <>
                      <path className="dash-pie__wall" d={w.sidePath} />
                      <path className="dash-pie__wall-shade" d={w.sidePath} />
                    </>
                  )}
                  <path className="dash-pie__top" d={w.topPath} />
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="dash-pie__caption">{caption}</p>
      {/* The slice's actions, at the pointer — the register's own menu, given this
          chart's items. Rendered here rather than inside the stage so the stage's
          pointer-lean transform cannot become the menu's containing block, and
          portaled to <body> by RowMenu itself. */}
      {menu && (
        <RowMenu
          at={menu.at}
          label={`Actions for ${menu.label}`}
          items={pieMenuItems({
            label: menu.label,
            status: menu.status,
            value: wedges.find((w) => w.key === menu.status)?.value ?? 0,
            pct: wedges.find((w) => w.key === menu.status)?.pct ?? 0,
            pinned: pinned === menu.status,
            scope,
          }).map((item) => ({ ...item, onSelect: () => runMenuAction(item.key, menu) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ---- Hour-of-day histogram: 24 thin DOM bars --------------------------------
//
// One strip, one window — the dashboard's own range — because that is what this panel
// is for on a dashboard whose every other number is "in the range you selected". Every
// day in the range is summed into the same 24 buckets, so the strip reads as the shape
// of a day in this range rather than the shape of any one day.

function HourChart({ hours }) {
  // Which hour is being read and where its card sits, in ONE piece of state: the lit
  // bar, the recession and the card are three faces of one fact, and split across two
  // states they could disagree.
  //
  // The hour is kept as the HOUR (0-23) rather than as an index into the array: the
  // hour is the identity the payload, the axis and the card all use, and an index would
  // be the same number only by coincidence of the server zero-filling the whole day.
  const [read, setRead] = useState(null);
  const wrapRef = useRef(null);

  if (!hours.length || hours.every((h) => h.count === 0)) {
    return <EmptyNote>No reports in this range yet.</EmptyNote>;
  }
  const max = Math.max(...hours.map((h) => h.count));
  const peak = hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0]);
  const total = hours.reduce((sum, h) => sum + h.count, 0);
  const active = read?.hour ?? null;
  const shown = active == null ? null : hours.find((h) => h.hour === active) ?? null;

  /** Read one hour: the lit bar, the recession and the card all come from this. */
  const readHour = (hour, mark) => {
    const at = peekAt(mark, wrapRef.current);
    // No measurement, no card. A card pinned to an unmeasurable mark would open in the
    // wrong place, which is worse than not opening.
    if (at) setRead({ hour, ...at });
  };

  /**
   * The strip walks on the arrow keys, one hour a press, and STOPS at both ends.
   *
   * The menu's idiom is to wrap, but a day is not a cycle: 23:00 is not "before"
   * 00:00 in any sense a shift plan reads, and an axis that wrapped under the arrow
   * keys would look like a bug in the walk rather than a decision. One tab stop for the
   * whole chart, the way the plot's own keyboard route is one, so reading the hours does
   * not cost the dashboard twenty-four of them.
   *
   * The card is measured from the column the walk lands on, so the keyboard's card
   * appears where the pointer's would have: one anchor, two ways of reaching it.
   */
  const onStripKeyDown = (e) => {
    if (e.key === 'Escape') {
      setRead(null);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    // From nothing, the first press lands ON an hour rather than one past the end:
    // right starts at 00:00, left at 23:00, which is where each key points.
    const next = Math.min(23, Math.max(0, (active == null ? (step > 0 ? -1 : 24) : active) + step));
    // The column is found by the hour it IS rather than by its position in the row: the
    // payload is zero-filled in clock order today, and an index would be the same number
    // only for as long as that stays true.
    readHour(next, wrapRef.current?.querySelector(`[data-hour="${next}"]`));
  };

  return (
    <div className="dash-hours-wrap" ref={wrapRef}>
      <div
        className="dash-hours"
        role="img"
        aria-label={`Reports by hour of day; busiest at ${peak.hour}:00 with ${fmt.format(
          peak.count,
        )} of ${fmt.format(total)} in this range. Arrow keys read an hour.`}
        // The keyboard route for the card: one focusable strip, walked with the arrow
        // keys, exactly as the trend chart's plot is one focusable box.
        tabIndex={0}
        onKeyDown={onStripKeyDown}
        // Dropping the strip — with the pointer or with the keyboard — closes the card.
        // On the STRIP rather than on each bar, so sliding between two hours never
        // flickers the card shut and open again.
        onMouseLeave={() => setRead(null)}
        onBlur={() => setRead(null)}
      >
        {hours.map((h) => {
          const lit = h.hour === active;
          // Every other hour steps back while one is read, the same device the trend
          // chart uses on its columns — and the two are mutually exclusive BY
          // CONSTRUCTION, so the bar the card names can never be the one that recedes.
          const muted = active != null && !lit;
          return (
            <div
              key={h.hour}
              data-hour={h.hour}
              className={`dash-hour${lit ? ' is-active' : ''}${muted ? ' is-muted' : ''}`}
              onMouseEnter={(e) => readHour(h.hour, e.currentTarget)}
            >
              {/* A ZERO HOUR DRAWS NOTHING. The floor below keeps a one-report hour
                  visible next to a busy one; applied to empty hours too it put a stub
                  under every one of them, which in a chart of counts is a claim rather
                  than a rendering nicety. */}
              {h.count > 0 && (
                <span className="dash-hour__bar" style={{ height: `${Math.max(3, (h.count / max) * 100)}%` }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="dash-hours__axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      {/* THE CHART'S OWN FACT, and it stays this while an hour is read: where the range
          peaks. The hour under the pointer is the CARD's job — one is about the whole
          range, the other about one bar, and keeping them separate is what stops this
          line from being two different sentences in one box. */}
      <p className="dash-hours__note">
        Busiest hour: <strong>{String(peak.hour).padStart(2, '0')}:00</strong> with {fmt.format(peak.count)}{' '}
        {peak.count === 1 ? 'report' : 'reports'}
      </p>
      {/* The hour under the pointer, on the trend chart's magnified-card device: the
          hour, its count, and its share of everything in range — the same number the
          status panel prints for a slice. It replaces the per-bar `title` that used to
          carry this: a native tooltip arrives a second late and covers the chart it
          describes. The card is the SAME state that lights the bar and dims the rest, so
          the number and the picture cannot disagree. */}
      {shown && (
        <Peek at={read}>
          <div className="dash-peek__head">
            <strong>{String(shown.hour).padStart(2, '0')}:00</strong>
            <span>
              {fmt.format(shown.count)} {shown.count === 1 ? 'report' : 'reports'}
            </span>
          </div>
          <p className="dash-peek__sub">
            {Math.round((shown.count / total) * 100)}% of {fmt.format(total)} in range
          </p>
        </Peek>
      )}
    </div>
  );
}


