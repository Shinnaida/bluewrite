import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isUnreachable } from '../lib/api.js';

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
 *   seriesOverTime[{date,count}] · categoryBreakdown[{type,count}]
 *   categoryDeltas{type:{current,previous}} · statusBreakdown{draft,submitted,final}
 *   hourHistogram[{hour,count}] · officerBreakdown[{officer,count}]
 *   finalizeTime{medianMinutes,finalizedCount}
 *   recentActivity[{action,entityId,createdAt,actor}] · meta{from,to,type,scope,availableTypes}
 */

const fmt = new Intl.NumberFormat();

// Real action strings written by Audit::log() across the app.
const ACTION_LABELS = {
  'report.create': 'Created a report',
  'report.update': 'Updated a report',
  'report.finalize': 'Finalized a report',
  'report.print': 'Printed a report',
  'report.archive': 'Archived a report',
  'report.restore': 'Restored a report',
  'user.create': 'Created a user account',
  'user.update': 'Updated a user account',
  'user.deactivate': 'Deactivated a user account',
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in attempt',
  'login.locked': 'Account locked (failed attempts)',
  'login.blocked_inactive': 'Blocked sign-in (inactive account)',
  logout: 'Signed out',
  'ai.narrative.generate': 'Generated an AI narrative draft',
};

function describeAction(action) {
  return ACTION_LABELS[action] || action;
}

function relativeTime(dbStamp) {
  if (!dbStamp) return '';
  const then = new Date(String(dbStamp).replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return '';
  const diffMin = Math.round((Date.now() - then.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

const isoDate = (d) => d.toISOString().slice(0, 10);

function datesForPreset(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

/** "2d 4h" / "5h 12m" / "38m" / "0m" — one consistent compact duration. */
function fmtMinutes(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// ---- Skeleton bits (shown while the first load is in flight) --------------

function KpiSkeleton() {
  return (
    <div className="dash-kpi is-skeleton" aria-hidden="true">
      <span className="dash-kpi__label sk sk--text" />
      <span className="dash-kpi__value sk sk--big" />
      <span className="dash-kpi__delta sk sk--text" />
    </div>
  );
}

function PanelSkeleton({ tall }) {
  return (
    <div className={`dash-panel is-skeleton ${tall ? 'dash-panel--tall' : ''}`} aria-hidden="true">
      <span className="dash-panel__title sk sk--text" style={{ width: 140 }} />
      <span className={`sk sk--block ${tall ? 'sk--chart-tall' : 'sk--chart'}`} />
    </div>
  );
}

// ---- Shared panel chrome ----------------------------------------------------

function Panel({ title, aside, children }) {
  return (
    <section className="dash-panel">
      <div className="dash-panel__head">
        <h2>{title}</h2>
        {aside && <div className="dash-panel__aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }) {
  return <p className="dash-empty">{children}</p>;
}

export default function Dashboard({ user, notify, onConnError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [preset, setPreset] = useState(30);
  const [scope, setScope] = useState('all'); // meaningful for Admin/Staff only
  const [{ from, to }, setDates] = useState(datesForPreset(30));
  const [type, setType] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (type) params.set('type', type);
    params.set('scope', scope);

    try {
      const out = await api(`/dashboard/stats?${params.toString()}`);
      if (live.current) {
        setData(out);
        setUpdatedAt(new Date());
      }
    } catch (err) {
      if (isUnreachable(err)) {
        onConnError?.();
        return;
      }
      if (live.current) setError(err?.message || 'The dashboard could not load its data.');
    }
  }, [from, to, type, scope, onConnError]);

  useEffect(() => {
    load();
  }, [load]);

  // Silent auto-refresh every 60s: supervisors leave this open on a wall
  // screen. Only when there is no error showing, so a real failure stays
  // visible until the viewer acknowledges it with a retry.
  useEffect(() => {
    const iv = setInterval(() => {
      if (!error) load();
    }, 60000);
    return () => clearInterval(iv);
  }, [load, error]);

  const applyPreset = (days) => {
    setPreset(days);
    setDates(datesForPreset(days));
  };

  const clearPreset = () => {
    if (preset !== null) setPreset(null);
  };

  const k = data?.kpis;
  const loading = data === null && !error;
  const statusDonut = data
    ? { draft: data.statusBreakdown?.draft ?? 0, submitted: data.statusBreakdown?.submitted ?? 0, final: data.statusBreakdown?.final ?? 0 }
    : null;
  const needsAttention = (k?.pending ?? 0) + (k?.submitted ?? 0);

  const activityItems = data?.recentActivity ?? [];
  const attentionItems = useMemo(
    () => activityItems.filter((a) => a.action === 'login.failed' || a.action === 'login.locked'),
    [activityItems]
  );

  return (
    <div className="dash">
      <header className="dash-topbar">
        <div>
          <h1>Dashboard</h1>
          <p className="dash-sub">
            {scope === 'mine' ? 'Your reports — ' : ''}
            Naga City Police Station — incident report overview
            {updatedAt && (
              <span className="dash-updated"> (updated {relativeTime(updatedAt.toISOString())})</span>
            )}
          </p>
        </div>

        <div className="dash-filters">
          <div className="dash-scope" role="group" aria-label="Data scope">
            <button
              type="button"
              className={`dash-chip ${scope === 'all' ? 'is-active' : ''}`}
              onClick={() => setScope('all')}
            >
              Station
            </button>
            <button
              type="button"
              className={`dash-chip ${scope === 'mine' ? 'is-active' : ''}`}
              onClick={() => setScope('mine')}
            >
              My reports
            </button>
          </div>

          <div className="dash-presets" role="group" aria-label="Date range presets">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                className={preset === d ? 'is-active' : ''}
                onClick={() => applyPreset(d)}
              >
                {d}d
              </button>
            ))}
          </div>

          <label className="dash-field">
            <span>From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                clearPreset();
                setDates((p) => ({ ...p, from: e.target.value }));
              }}
            />
          </label>
          <label className="dash-field">
            <span>To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => {
                clearPreset();
                setDates((p) => ({ ...p, to: e.target.value }));
              }}
            />
          </label>
          <label className="dash-field">
            <span>Incident type</span>
            <select
              value={type}
              onChange={(e) => {
                clearPreset();
                setType(e.target.value);
              }}
            >
              <option value="">All types</option>
              {(data?.meta?.availableTypes ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && (
        <div className="dash-alert" role="alert">
          {error}
          <button type="button" className="dash-alert__retry" onClick={load}>
            retry
          </button>
        </div>
      )}

      {/* ---- KPI strip ------------------------------------------------- */}
      <section className="dash-kpis" aria-busy={loading}>
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <KpiSkeleton key={i} />)
        ) : (
          <>
            <div className="dash-kpi dash-kpi--hero">
              <span className="dash-kpi__label">Total reports</span>
              <span className="dash-kpi__value">{k ? fmt.format(k.total) : '—'}</span>
              <span
                className={`dash-kpi__delta ${k && k.periodDeltaPct > 0 ? 'is-up' : ''} ${k && k.periodDeltaPct < 0 ? 'is-down' : ''}`}
              >
                {k
                  ? k.periodDeltaPct > 0
                    ? `↑ ${k.periodDeltaPct}% vs. previous period`
                    : k.periodDeltaPct < 0
                      ? `↓ ${Math.abs(k.periodDeltaPct)}% vs. previous period`
                      : 'No change vs. previous period'
                  : ''}
              </span>
            </div>
            <div className="dash-kpi" style={{ '--accent': 'var(--amber)' }}>
              <span className="dash-kpi__label">Needs attention</span>
              <span className="dash-kpi__value">{k ? fmt.format(needsAttention) : '—'}</span>
              <span className="dash-kpi__delta">
                {k ? `${fmt.format(k.pending)} draft · ${fmt.format(k.submitted)} awaiting finalization` : ''}
              </span>
            </div>
            <div className="dash-kpi" style={{ '--accent': 'var(--green-ok)' }}>
              <span className="dash-kpi__label">Finalized</span>
              <span className="dash-kpi__value">{k ? fmt.format(k.finalized) : '—'}</span>
              <span className="dash-kpi__delta">
                {k && finalizePct(k) !== null ? `${finalizePct(k)}% of reports in range` : ''}
              </span>
            </div>
            <div className="dash-kpi" style={{ '--accent': 'var(--cyan)' }}>
              <span className="dash-kpi__label">Median draft to final</span>
              <span className="dash-kpi__value dash-kpi__value--time">
                {data?.finalizeTime?.medianMinutes != null
                  ? fmtMinutes(data.finalizeTime.medianMinutes)
                  : '—'}
              </span>
              <span className="dash-kpi__delta">
                {data?.finalizeTime
                  ? data.finalizeTime.medianMinutes != null
                    ? `${fmt.format(data.finalizeTime.finalizedCount)} finalized in range`
                    : 'Nothing was finalized in this range'
                  : ''}
              </span>
            </div>
          </>
        )}
      </section>

      {/* ---- Trend + status -------------------------------------------- */}
      <div className="dash-grid-main">
        {loading ? <PanelSkeleton tall /> : (
          <Panel title="Reports over time">
            <LineChart series={data?.seriesOverTime ?? []} />
          </Panel>
        )}
        {loading ? <PanelSkeleton tall /> : (
          <Panel title="Status breakdown">
            <Donut status={statusDonut} />
          </Panel>
        )}
      </div>

      {/* ---- Categories + hour of day ---------------------------------- */}
      <div className="dash-grid-main dash-grid-main--reverse">
        {loading ? <PanelSkeleton /> : (
          <Panel title="Incident categories">
            <BarRows rows={data?.categoryBreakdown ?? []} deltas={data?.categoryDeltas ?? {}} />
          </Panel>
        )}
        {loading ? <PanelSkeleton /> : (
          <Panel title="Reports by hour">
            <HourChart hours={data?.hourHistogram ?? []} />
          </Panel>
        )}
      </div>

      {/* ---- Workload + activity --------------------------------------- */}
      <div className="dash-grid-main">
        {loading ? <PanelSkeleton /> : (
          <Panel title="Officer workload">
            <OfficerRows rows={data?.officerBreakdown ?? []} />
          </Panel>
        )}
        {loading ? <PanelSkeleton /> : (
          <Panel
            title="Recent activity"
            aside={
              attentionItems.length > 0 ? (
                <span className="dash-flag" title="Failed sign-ins and lockouts in this feed">
                  {attentionItems.length} security event{attentionItems.length === 1 ? '' : 's'}
                </span>
              ) : null
            }
          >
            <Activity items={activityItems} />
          </Panel>
        )}
      </div>
    </div>
  );
}

/** Share of the period's reports that reached `finalized`, or null when empty. */
function finalizePct(k) {
  if (!k || k.total <= 0) return null;
  return Math.round((k.finalized / k.total) * 100);
}

// ---- Line chart: hand-drawn SVG, zero dependencies --------------------------

function LineChart({ series }) {
  const W = 720;
  const H = 220;
  const PAD = { l: 34, r: 12, t: 14, b: 26 };
  const [hover, setHover] = useState(null); // index into series

  if (!series.length) {
    return (
      <svg className="dash-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Reports filed over time">
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="#6B7A8C">
          No reports in this range yet.
        </text>
      </svg>
    );
  }

  const max = Math.max(1, ...series.map((p) => p.count));
  // Round the axis up to a tidy number so the top gridline isn't "max+17%".
  const axisMax = Math.max(4, Math.ceil(max / 4) * 4);
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const stepX = innerW / Math.max(1, series.length - 1);
  const px = (i) => PAD.l + i * stepX;
  const py = (c) => PAD.t + innerH - (c / axisMax) * innerH;

  const points = series.map((p, i) => [px(i), py(p.count)]);
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(1)} ${py(0)} L${points[0][0].toFixed(1)} ${py(0)} Z`;

  // Hover target columns: each point gets an equal slice of the plot.
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((x - PAD.l) / stepX);
    setHover(Math.max(0, Math.min(series.length - 1, idx)));
  };

  const labelIdx = [0, Math.floor(points.length / 2), points.length - 1];
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="dash-line-wrap">
      <svg
        className="dash-line"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Reports filed over time"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={py(axisMax * f)} y2={py(axisMax * f)} stroke="#1E293B" strokeWidth="1" />
        ))}
        {[0, Math.round(axisMax / 2), axisMax].map((v) => (
          <text key={v} x={PAD.l - 6} y={py(v) + 3} fontSize="9.5" fill="#6B7A8C" textAnchor="end">
            {v}
          </text>
        ))}
        <path d={areaPath} fill="rgba(0,240,255,0.07)" stroke="none" />
        <path d={linePath} fill="none" stroke="#00F0FF" strokeWidth="2" />
        {hp && (
          <>
            <line x1={hp[0]} x2={hp[0]} y1={PAD.t} y2={py(0)} stroke="#00F0FF" strokeOpacity="0.35" strokeWidth="1" />
            <circle cx={hp[0]} cy={hp[1]} r="3.5" fill="#00F0FF" />
          </>
        )}
        {labelIdx.map((idx, n) =>
          idx >= 0 && idx < series.length ? (
            <text
              key={idx}
              x={points[idx][0]}
              y={H - 6}
              fontSize="10"
              fill="#9CA3AF"
              textAnchor={n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}
            >
              {series[idx].date.slice(5)}
            </text>
          ) : null
        )}
      </svg>
      {hp && hover != null && (
        <div
          className="dash-tip"
          style={{
            left: `${(hp[0] / W) * 100}%`,
            top: `${(hp[1] / H) * 100}%`,
            transform: `translate(${hp[0] > W * 0.7 ? '-108%' : '8px'}, -50%)`,
          }}
          role="status"
        >
          <strong>{fmt.format(series[hover].count)}</strong>
          {series[hover].count === 1 ? ' report' : ' reports'}
          <span>{series[hover].date}</span>
        </div>
      )}
    </div>
  );
}

// ---- Bar rows: DOM bars, accessible, with period-over-period deltas ---------

function BarRows({ rows, deltas }) {
  if (!rows.length) return <EmptyNote>No incident data for this range.</EmptyNote>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div className="dash-bars" role="img" aria-label="Report count by incident type">
      {rows.map((r) => {
        const d = deltas?.[r.type];
        const change = d && d.previous > 0 ? Math.round(((d.current - d.previous) / d.previous) * 100) : null;
        const grew = d ? d.current > d.previous : false;
        const shrank = d ? d.current < d.previous : false;
        return (
          <div key={r.type} className="dash-bar-row">
            <span className="dash-bar-row__label" title={r.type}>
              {r.type}
            </span>
            <span className="dash-bar-row__track">
              <span className="dash-bar-row__fill" style={{ width: `${Math.max(4, Math.round((r.count / max) * 100))}%` }} />
            </span>
            <span className="dash-bar-row__count">
              {fmt.format(r.count)}
              {change !== null && change !== 0 && (
                <em className={`dash-delta ${grew ? 'is-up' : 'is-down'}`}>
                  {grew ? '↑' : '↓'}
                  {Math.abs(change)}%
                </em>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Donut: three-slice stroke-dasharray ------------------------------------

const STATUS_COLORS = { draft: '#F59E0B', submitted: '#00F0FF', final: '#3ED598' };

function Donut({ status }) {
  const R = 60;
  const CX = 80;
  const CY = 80;
  const CIRC = 2 * Math.PI * R;
  const draft = status?.draft ?? 0;
  const submitted = status?.submitted ?? 0;
  const final = status?.final ?? 0;
  const total = draft + submitted + final;

  if (total === 0) {
    return (
      <div className="dash-donut-wrap">
        <svg viewBox="0 0 160 160" role="img" aria-label="No reports in range">
          <text x={80} y={84} textAnchor="middle" fontSize="12" fill="#6B7A8C">
            No data
          </text>
        </svg>
        <ul className="dash-legend">
          <li><span className="dot" style={{ background: STATUS_COLORS.draft }} /> Draft — 0</li>
          <li><span className="dot" style={{ background: STATUS_COLORS.submitted }} /> Submitted — 0</li>
          <li><span className="dot" style={{ background: STATUS_COLORS.final }} /> Final — 0</li>
        </ul>
      </div>
    );
  }

  const segs = [
    { key: 'final', value: final, label: 'Final' },
    { key: 'submitted', value: submitted, label: 'Submitted' },
    { key: 'draft', value: draft, label: 'Draft' },
  ];
  let acc = 0;
  const arcs = segs.map((s) => {
    const len = (s.value / total) * CIRC;
    const arc = { ...s, len, offset: acc };
    acc += len;
    return arc;
  });

  const pct = (v) => `${Math.round((v / total) * 100)}%`;

  return (
    <div className="dash-donut-wrap">
      <div className="dash-donut">
        <svg viewBox="0 0 160 160" role="img" aria-label="Reports by status: draft, submitted, finalized">
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1E293B" strokeWidth="18" />
          {arcs
            .filter((a) => a.len > 0)
            .map((a) => (
              <circle
                key={a.key}
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke={STATUS_COLORS[a.key]}
                strokeWidth="18"
                strokeDasharray={`${a.len} ${CIRC}`}
                strokeDashoffset={-a.offset}
                transform={`rotate(-90 ${CX} ${CY})`}
              />
            ))}
        </svg>
        <span className="dash-donut__center">
          <strong>{fmt.format(total)}</strong>
          <small>reports</small>
        </span>
      </div>
      <ul className="dash-legend">
        {arcs.map((a) => (
          <li key={a.key}>
            <span className="dot" style={{ background: STATUS_COLORS[a.key] }} /> {a.label} — {fmt.format(a.value)}{' '}
            <em className="dash-legend__pct">({pct(a.value)})</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Hour-of-day histogram: 24 thin DOM bars --------------------------------

function HourChart({ hours }) {
  if (!hours.length || hours.every((h) => h.count === 0)) {
    return <EmptyNote>No reports in this range yet.</EmptyNote>;
  }
  const max = Math.max(...hours.map((h) => h.count));
  const peak = hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0]);
  return (
    <div>
      <div className="dash-hours" role="img" aria-label={`Reports by hour of day; peak at ${peak.hour}:00`}>
        {hours.map((h) => (
          <div key={h.hour} className="dash-hour" title={`${String(h.hour).padStart(2, '0')}:00 — ${h.count} report${h.count === 1 ? '' : 's'}`}>
            <span className="dash-hour__bar" style={{ height: `${Math.max(3, (h.count / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="dash-hours__axis" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      <p className="dash-hours__note">
        Peak hour: <strong>{String(peak.hour).padStart(2, '0')}:00</strong> with {fmt.format(peak.count)}{' '}
        {peak.count === 1 ? 'report' : 'reports'}
      </p>
    </div>
  );
}

// ---- Officer workload --------------------------------------------------------

function OfficerRows({ rows }) {
  if (!rows.length) return <EmptyNote>No reports were created in this range.</EmptyNote>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div className="dash-bars" role="img" aria-label="Reports created per officer">
      {rows.map((r) => (
        <div key={r.officer} className="dash-bar-row">
          <span className="dash-bar-row__label" title={r.officer}>
            {r.officer}
          </span>
          <span className="dash-bar-row__track">
            <span
              className="dash-bar-row__fill dash-bar-row__fill--officer"
              style={{ width: `${Math.max(4, Math.round((r.count / max) * 100))}%` }}
            />
          </span>
          <span className="dash-bar-row__count">{fmt.format(r.count)}</span>
        </div>
      ))}
    </div>
  );
}

function Activity({ items }) {
  if (!items.length) {
    return <EmptyNote>No activity recorded for this range yet.</EmptyNote>;
  }
  return (
    <ul className="dash-activity">
      {items.map((a, i) => (
        <li key={`${a.createdAt}-${i}`}>
          <span>
            {describeAction(a.action)}
            <span className="dash-activity__actor"> — {a.actor || 'Unknown'}</span>
          </span>
          <span className="dash-activity__time">{relativeTime(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
