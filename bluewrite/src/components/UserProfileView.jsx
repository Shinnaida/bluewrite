// BlueWrite — one account, read before it is edited.
//
// WHY THIS SCREEN EXISTS. Opening a row in User Management used to drop the
// administrator straight into the edit form, which is the wrong first question. The
// question an administrator actually has about a colleague is "what have they been
// doing" — their reports, their sign-ins, whether they are still working here — and
// the form answers none of it: it is six fields that all look the same whether the
// account has filed forty reports this month or none since it was created.
//
// So the account opens as a PAGE: who they are, what they have recorded, and when
// they were last at a desk. Editing is one deliberate step from here — the pen on
// their photograph (see `.acct-profile__edit`), which is where a hand reaches for it.
//
// PRESENTATIONAL, AND THAT IS THE TEST STORY. Every number below is fetched by the
// container (Users.jsx) and handed in as a prop, so this can be rendered and read in
// tests/rules — see the fixture. It fetches nothing, decides nothing about
// permissions, and holds no state beyond nothing at all.
//
// EVERY NUMBER COMES FROM A RECORD, NEVER FROM A GUESS:
//
//   - the FACTS are the account row itself (GET /users), including the two columns
//     the directory does not draw (when the account was created, when it was last
//     seen);
//   - the REPORTS are GET /reports?created_by=N — the same list, the same filters and
//     the same derived statuses the All Reports screen shows, so `total` is that
//     officer's count and not an estimate from one page of rows;
//   - the SIGN-INS are the audit trail's own `login.success` entries for this account
//     (GET /audits?user_id=N&action=login.success) — which is the only record of
//     attendance this system keeps. There is no clock-in table, and inventing a
//     number for one would be the worst thing this page could do;
//   - the ACTIVITY is the same trail, unfiltered (GET /audits?user_id=N).

import React from 'react';
import Avatar from './Avatar.jsx';
// The year, drawn: one square per day, with a switch between the two readings the trail
// supports (days they signed in, and everything recorded for them). It is handed the
// server's own series — this view counts nothing.
import ActivitySheet from './ActivitySheet.jsx';

/**
 * The audit actions as sentences.
 *
 * A LABELLED MAP WITH A FALLBACK, which is the whole design: an action this map has
 * never heard of is printed as its code rather than dropped, so a new server-side
 * action shows up on this page the day it starts being logged — and looks untranslated
 * rather than invisible. (The server owns the list; see AuditsController::ACTIONS.)
 */
const ACTION_LABEL = {
  'login.success': 'Signed in',
  'login.failed': 'Password refused',
  'login.locked': 'Locked out after too many attempts',
  'login.blocked_inactive': 'Sign-in refused — account deactivated',
  logout: 'Signed out',
  'user.create': 'Account created',
  'user.update': 'Account details changed',
  'user.password_reset': 'Password reset by an administrator',
  'user.password_change': 'Changed their own password',
  'user.password_change_failed': 'Password change refused',
  'user.deactivate': 'Account deactivated',
  'user.reactivate': 'Account reactivated',
  'user.photo_set': 'Photograph set',
  'user.photo_remove': 'Photograph removed',
  'mfa.reset_by_admin': 'Verification reset by an administrator',
  'report.create': 'Report created',
  'report.update': 'Report updated',
  'report.finalize': 'Report finalized',
  'report.archive': 'Report archived',
  'report.restore': 'Report restored',
};

/** The sentence for one audit entry. The code itself when nothing here knows it. */
export function actionLabel(action) {
  return ACTION_LABEL[String(action ?? '')] ?? String(action ?? '');
}

/** A stamp the server sent, verbatim — never a client-side "2h ago" (see the view note). */
const stamp = (value) => (value ? String(value).replace('T', ' ') : null);

/** One fact in the account's definition list. */
function Fact({ label, children }) {
  return (
    <div className="acct-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** What a fact reads when the record holds nothing for it. */
function Absent({ children = 'Not recorded' }) {
  return <span className="acct-none">{children}</span>;
}

/**
 * The account page.
 *
 * `reports` is `{ rows, total }` or null while it is being read; `signIns` and
 * `activity` are arrays of audit entries. `loading` and `failed` describe the read of
 * all three at once — they are one page, and a page half-drawn with a spinner in the
 * middle of it is worse than one that says it is still being read.
 */
export default function UserProfileView({
  user,
  reports = null,
  signIns = [],
  activity = [],
  sheet = null,
  metric = 'attendance',
  onMetric = () => {},
  loading = false,
  failed = null,
  onEdit = () => {},
  onBack = () => {},
  onRetry = () => {},
}) {
  const twoFactor = user.role === 'Admin' || user.role === 'Officer'
    ? (user.email ? 'Emailed code required' : 'Required, but there is no address to send it to')
    : 'Not required for this role';

  return (
    <>
      {/* The way back is the first thing on the page and the quietest thing on it: the
          administrator arrived by a double-click, and Escape or this button is how they
          leave. */}
      <div className="acct-back">
        <button type="button" className="acct-back__btn" onClick={onBack}>
          ← Station directory
        </button>
      </div>

      <div className="acct-head">
        <div className="acct-headline">
          <h2 className="acct-title">{user.full_name || 'This account'}</h2>
        </div>
        <p className="acct-subtitle">
          {user.role}
          <span className="acct-dot" aria-hidden="true">·</span>
          Badge {user.badge_number || '—'}
          <span className="acct-dot" aria-hidden="true">·</span>
          <span className={`badge ${user.status}`}>{user.status}</span>
        </p>
      </div>

      {/* ============ 1. THE PERSON ============ */}
      <section className="st-block">
        <div className="st-block-head">
          <div className="acct-headline">
            <h3>The account</h3>
          </div>
        </div>

        <div className="acct-profile">
          <div className="acct-profile__face">
            <Avatar user={user} className="acct-profile__avatar" />
            {/* THE PEN, ON THE PHOTOGRAPH, because that is where a hand reaches for
                "change this person" — and because the form behind it is a deliberate
                step rather than the accident of opening a row. It is a real button with
                the account's name in its label, so it is reachable and unambiguous for
                a screen reader, which cannot see a pencil. */}
            <button
              type="button"
              className="acct-profile__edit"
              onClick={onEdit}
              aria-label={`Edit ${user.full_name || 'this account'}`}
              title="Edit this account"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h4l10-10-4-4L4 16v4z" />
                <path d="M14 6l4 4" />
              </svg>
            </button>
          </div>

          <dl className="acct-facts">
            <Fact label="Full name">{user.full_name || <Absent />}</Fact>
            <Fact label="Badge / employee number">{user.badge_number || <Absent />}</Fact>
            <Fact label="Username">{user.username || <Absent />}</Fact>
            <Fact label="Email address">{user.email || <Absent>None — no address on file</Absent>}</Fact>
            <Fact label="Role">{user.role}</Fact>
            <Fact label="Two-factor">
              {twoFactor}
              {user.otp_locked_until ? (
                <> <span className="acct-fact__note">Locked until {stamp(user.otp_locked_until)}.</span></>
              ) : null}
            </Fact>
            <Fact label="Last sign-in">{stamp(user.last_login_at) ?? <Absent>Never</Absent>}</Fact>
            <Fact label="Last seen">
              {stamp(user.last_seen_at) ?? <Absent>Not since the count started</Absent>}
            </Fact>
            <Fact label="Account created">{stamp(user.created_at) ?? <Absent />}</Fact>
          </dl>
        </div>

        <p className="acct-footnote">
          Last seen updates while they are signed in and using the station — it is the
          presence rail's own clock, not a shift record.
        </p>
      </section>

      {/* ============ 2. WHAT THEY HAVE RECORDED ============ */}
      <section className="st-block">
        <div className="st-block-head">
          <div className="acct-headline">
            <h3>Reports recorded</h3>
          </div>
        </div>

        {failed ? (
          <div className="alert error" role="alert">
            This account's reports could not be read: {failed}
            <button type="button" className="acct-retry" onClick={onRetry}>Try again</button>
          </div>
        ) : loading ? (
          <p className="acct-quiet" role="status">Reading their reports…</p>
        ) : (
          <>
            <p className="acct-count">
              <strong>{reports?.total ?? 0}</strong>{' '}
              {(reports?.total ?? 0) === 1 ? 'report' : 'reports'} recorded in the station blotter.
            </p>
            {(reports?.rows ?? []).length === 0 ? (
              <p className="acct-quiet">
                Nothing recorded yet. Reports appear here as soon as this account saves
                its first one.
              </p>
            ) : (
              <ul className="acct-list">
                {(reports?.rows ?? []).map((r) => (
                  <li key={r.id} className="acct-list__row">
                    <span className="acct-list__when">{r.report_date || r.incident_date || 'No date'}</span>
                    <span className="acct-list__what">{r.incident_type || 'Report'}</span>
                    {r.blotter_no ? <span className="acct-list__stamp">{r.blotter_no}</span> : null}
                    <span className={`badge ${r.status}`}>{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
            {(reports?.total ?? 0) > (reports?.rows ?? []).length ? (
              <p className="acct-footnote">
                Showing the {reports.rows.length} most recent. The rest are on All Reports.
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ============ 3. THE YEAR, THEN THE DAYS THEMSELVES ============ */}
      <section className="st-block">
        <div className="st-block-head">
          <div className="acct-headline">
            {/* THE CARD IS ONE QUESTION AT TWO DISTANCES: the sheet is the shape of the
                year — time at a desk, and what was recorded — and the lists under it are
                the days themselves, which is where a reader goes once the shape has given
                them a date to look up. */}
            <h3>Attendance and activity</h3>
          </div>
        </div>

        {/* THE YEAR, ABOVE THE LIST, because the two answer the question at different
            distances. The sheet is the shape of a year — the pattern of days and where it
            thins out — and the lists under it are the days themselves, which is what a
            reader goes to once the shape has given them a date to look up. */}
        <ActivitySheet
          days={sheet?.days ?? []}
          summary={sheet?.summary ?? null}
          window={sheet?.window ?? {}}
          metric={metric}
          onMetric={onMetric}
          loading={loading}
          failed={failed}
        />

        {failed ? null : loading ? (
          <p className="acct-quiet" role="status">Reading the audit trail…</p>
        ) : (
          <>
            {signIns.length === 0 ? (
              <p className="acct-quiet">
                No sign-ins recorded. The trail keeps them from the moment this account
                first signs in.
              </p>
            ) : (
              <ul className="acct-list">
                {signIns.map((entry) => (
                  <li key={`in-${entry.id}`} className="acct-list__row">
                    <span className="acct-list__when">{stamp(entry.created_at)}</span>
                    <span className="acct-list__what">
                      {entry.ip_address ? `Signed in from ${entry.ip_address}` : 'Signed in'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {activity.length > 0 ? (
              <>
                <p className="acct-subhead">What the trail last recorded for this account</p>
                <ul className="acct-list">
                  {activity.map((entry) => (
                    <li key={entry.id} className="acct-list__row">
                      <span className="acct-list__when">{stamp(entry.created_at)}</span>
                      <span className="acct-list__what">{actionLabel(entry.action)}</span>
                      {entry.detail ? <span className="acct-list__stamp">{entry.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
