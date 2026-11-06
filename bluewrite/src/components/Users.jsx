import React, { useEffect, useRef, useState } from 'react';
// `apiUpload` is `api` for a body that is a FILE (multipart/form-data) — the one
// shape on this API that is not JSON, used by the two photo routes.
import { api, apiUpload } from '../lib/api.js';
import { checkPassword, MIN_LENGTH, passwordHint } from '../lib/passwordPolicy.js';
// The face: how it is drawn (the same circle the roster and Profile draw), how a
// chosen file becomes the 512px square that is sent, and the camera that can take
// the photograph instead of a file being found for it.
import Avatar, { PersonGlyph } from './Avatar.jsx';
import CameraCapture from './CameraCapture.jsx';
// What an administrator sees when they open an account, before any form: the person,
// what they have recorded, and when they were last at a desk. See the view's own note
// on why editing is a step from here rather than the way in.
import UserProfileView from './UserProfileView.jsx';
import { checkAvatarFile, prepareAvatar } from '../lib/avatar.js';
// The directory's per-row actions open where the officer is pointing, the same
// menu the register's rows use. See UsersTable on why the column is gone.
import RowMenu from './RowMenu.jsx';
// The ⓘ marker a field's explanation rides on, so the account form is fields rather than
// fields plus a paragraph each. One definition, shared with the AI panel — see
// InfoHint.jsx for the whole of its contract.
import InfoHint from './InfoHint.jsx';
// WHO IS AT A DESK RIGHT NOW, opened from this screen's toolbar. It reads the
// directory itself (see the component) and is mounted only while the toggle is on, so
// a closed panel costs no polling — and it lives here rather than on the Dashboard
// because "an account is signed in" is a fact about accounts.
import ConnectionHub from './ConnectionHub.jsx';

/**
 * The two roles this station has, in the order the account form offers them.
 *
 * ONE HOME for the list: it is the account form's select, the directory's filter,
 * and the two places a role decides what a row may do (Reset verification). A
 * third role is a server change (the `roles` table) and a line here; two
 * copies of the two names is how the filter ends up offering a role the form
 * cannot create.
 */
const ROLES = ['Admin', 'Officer'];
/** The orders the directory offers, in menu order. Name first: a station
 *  directory reads alphabetically. Badge number is the station's own identifier
 *  order; recently signed in answers who was last at a desk. */
const SORT_ORDERS = [
  { key: 'name', label: 'Name A–Z' },
  { key: 'badge', label: 'Badge number' },
  { key: 'recent', label: 'Recently signed in' },
];
/** Server time an account was last seen, for the recent order. An account the
 *  server has never stamped sorts after every account it has. */
function seenTime(u) {
  const t = new Date(String(u.last_seen_at ?? '').replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * The roles that sign in with an emailed code as well as a password.
 *
 * One home for the pair, because three places on this screen already need it: the
 * email field's `required`, the sentence under that field, and the panel beside the
 * form. It is the server's list (EmailOtp::REQUIRED_ROLES).
 */
const CODE_ROLES = ['Admin', 'Officer'];

/** Whether this role's sign-in needs an address for a code to arrive at. */
const usesEmailCode = (role) => CODE_ROLES.includes(role);

/**
 * WHAT EACH ROLE ACTUALLY REACHES, which is the thing this form was silent about: an
 * administrator was asked to pick between two words and had nothing to read.
 *
 * TAKEN FROM THE CODE, NOT FROM THE NAMES. The bar is built from `isAdmin`
 * (AppTopBar), the blotter scopes non-admins to their own reports
 * (ReportsController::index). If one of those rules moves,
 * it moves here with it — a panel that promises a reach the server does not honour is
 * worse than a form that says nothing at all.
 */
const ROLE_REACH = {
  Admin: {
    summary: 'Runs the station: everything an Officer can do, on every screen the bar offers.',
    reach: [
      'The whole station blotter, not only their own reports',
      'Dashboard, Audit Trail, Station Settings and this directory',
      'May finalize any report, name the noting officer, and restore an archived one',
    ],
  },
  Officer: {
    summary: 'Records and files reports: the station’s own working role.',
    reach: [
      'Home, Write Report and My Reports',
      'Their own reports only: the whole blotter is the Admin’s view',
      'May finalize their own report, and name the noting officer',
    ],
  },
};

const EMPTY_FORM = {
  full_name: '',
  badge_number: '',
  username: '',
  email: '',
  role: 'Officer',
  password: '',
};

/** What a row says under the pointer, and how its actions are found at all. */
function rowHint(user) {
  return user.status === 'active'
    ? 'Double-click to open this account · right-click for actions'
    : 'Deactivated account · double-click to open · right-click for actions';
}

/**
 * The directory: the table, and nothing else.
 *
 * A VIEW, exported, and for the reason this app splits the same way everywhere:
 * the container below fetches, `renderToString` never runs an effect, so a
 * component that reads the server cannot be rendered by a test at all. This one
 * takes its rows and its two handlers as props, which is what lets
 * tests/fixtures/usersDirectory.jsx paint it for real and read the markup.
 *
 * THE ACTIONS ARE NOT A COLUMN, and this is the change the register already
 * made. They were four ghost buttons per row — Edit, Reset password, Reset
 * verification, Deactivate Account — which needed more width than the eight
 * data columns had to spare, so at any realistic window they wrapped onto a
 * second line and every row came out a different height. A directory is read
 * down the NAME; a strip of four buttons is what the eye lands on instead.
 * Right-click (or the keyboard) is where the officer is already pointing, and
 * each row states what it holds in its own `title`.
 *
 * EVERY ROW IS FOCUSABLE, and that is not decoration either: with the buttons
 * gone, focus is what keeps a row's actions reachable without a mouse — Enter
 * edits, Menu / Shift+F10 opens the menu at the row, and Escape closes it. The
 * focus ring itself is the global `tbody tr:focus-visible` rule.
 *
 * ONE LINE PER CELL. Every cell here is nowrap by design (see .users-table): a
 * wrapped name or a wrapped timestamp is exactly what made the column of
 * buttons look like a layout accident. The email is the one value allowed to
 * give way, and it gives way with an ellipsis and its full text on `title`.
 *
 * AN EMPTY CELL SAYS SO IN WORDS. "Not recorded" rather than a dash: a dash is
 * a glyph that reads as a value in a column of values, and for the address that
 * a sign-in code needs there is no room for an administrator to guess whether
 * it means "none", "not applicable" or "not loaded".
 *
 * A ROW OPENS THE ACCOUNT, NOT THE FORM. It used to hand the row straight to the edit
 * form, which answered the wrong first question: an administrator opening a colleague
 * wants to see what they have been doing (see UserProfileView). Editing is one
 * deliberate press from there — the pen on the photograph — and the row menu still
 * carries the direct way in for anyone who already knows what they came to change.
 */
export function UsersTable({ users = [], onOpen = () => {}, onEdit = () => {}, onMenu = () => {}, sortKey = null }) {
  return (
    <div className="table-wrap">
      <table className="users-table">
        {/* The heading row is read out of the markup, so it needs a name of its
            own — and the sentence tells a screen reader the same thing a row's
            tooltip tells an eye. */}
        <caption className="sr-only">          Station accounts: name, badge number, username, email, role, status and last sign-in. Press Enter on a row to open that account, or Menu / Shift+F10 for its actions.
        </caption>
        <thead>
          <tr>
            {/* THE SORTED COLUMN SAYS SO: the rail's Sort key decides the order, and
                the column that order is read down wears the blue (see styles.css) —
                Recent reads newest-first, so it alone sorts descending. */}
            <th scope="col" aria-sort={sortKey === 'name' ? 'ascending' : undefined} className={sortKey === 'name' ? 'is-sorted' : undefined}>Full name</th>
            <th scope="col" aria-sort={sortKey === 'badge' ? 'ascending' : undefined} className={sortKey === 'badge' ? 'num is-sorted' : 'num'}>Badge no.</th>
            <th scope="col">Username</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            {/* Centred with its cells (see th.status in styles.css): a chip hard
                against the left edge read as if it belonged to the column before it. */}
            <th scope="col" className="status">Status</th>
            <th scope="col" aria-sort={sortKey === 'recent' ? 'descending' : undefined} className={sortKey === 'recent' ? 'num is-sorted' : 'num'}>Last sign-in</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            return (
              <tr
                key={u.id}
                tabIndex={0}
                aria-haspopup="menu"
                title={rowHint(u)}
                onDoubleClick={() => onOpen(u)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onMenu(u, { x: e.clientX, y: e.clientY }, e.currentTarget, false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onOpen(u);
                    return;
                  }
                  if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
                  // A keyboard has no pointer to open at, so the menu drops from
                  // the row's own box — left edge, just below it.
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  onMenu(u, { x: box.left + 12, y: box.bottom }, e.currentTarget, true);
                }}
              >
                {/* THE FACE IN THE DIRECTORY: the account's own photograph where
                    one was recorded, initials where none was — the same circle
                    the roster and the account page draw, so the table reads as
                    people before it reads as values. */}
                <td data-label="Full name">
                  <span className="users-name">
                    <Avatar user={u} size={28} />
                    {u.full_name}
                  </span>
                </td>
                <td className="num stamp" data-label="Badge no.">{u.badge_number}</td>
                <td className="num" data-label="Username">{u.username}</td>
                <td data-label="Email">
                  {u.email
                    ? <span className="users-email" title={u.email}>{u.email}</span>
                    : <span className="users-none">Not recorded</span>}
                </td>
                <td data-label="Role">{u.role}</td>
                <td className="status" data-label="Status">
                  <span className={`badge ${u.status}`}>{u.status}</span>
                </td>
                {/* The stamp the server sent, verbatim — never a client-side
                    "2h ago": a station PC's clock is whatever somebody set it
                    to, which is the same reason the rail is handed ages rather
                    than timestamps (see lib/presence.js). Read in the table's
                    own face like the name beside it, not the machine `stamp`:
                    this column is read down, not scanned for values. */}
                <td className="num" data-label="Last sign-in">
                  {u.last_login_at ? u.last_login_at.replace('T', ' ') : 'Never'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Users({ notify, initialUserId = null }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(null); // null = list view, object = edit/create
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, action, confirmLabel }
  // Password reset dialog state (Admin action on an existing account).
  const [resetFor, setResetFor] = useState(null); // user row being reset
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  // The directory's two filters, held here rather than in the toolbar: the table,
  // the meta block's count and the empty state all read them, and a second copy
  // inside the table would be a second answer to "what is on screen".
  // True while the create or edit request is in flight. It guards the second press of a
  // button whose first press has already been sent — the same shape the station settings
  // forms use, on a form that creates a login.
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState('name');
  const [sortMenuAt, setSortMenuAt] = useState(null);
  // The open row menu: which account, where the pointer was, and the row it came
  // from. The row is what takes focus back when the menu was opened from the
  // keyboard rather than the mouse (see closeRowMenu).
  const [menu, setMenu] = useState(null);
  // Whether the Connected now panel is open. CLOSED BY DEFAULT, because the directory
  // is what this screen is for and the roster is a question an administrator asks
  // occasionally: it takes the top of the page, and it polls while it is up.
  const [presenceOpen, setPresenceOpen] = useState(false);
  // The generated recovery-code sheet (migration 018): null, or the codes the
  // server just issued — shown ONCE in a dialog, and printable from there. It is
  // the only moment they exist in readable form; the server keeps hashes.
  const [recoverySheet, setRecoverySheet] = useState(null);

  // ---- The account's face ----------------------------------------------------
  //
  // TWO WAYS TO SET ONE PHOTOGRAPH, and which is in play depends on whether the
  // account exists yet. `photoUrl` is what the SERVER holds for an account that
  // exists — the only kind that can have a file. `pendingPhoto` is a photograph
  // chosen while CREATING one, held here because a new account has no id to hang a
  // file on: it is uploaded the moment the account is created (see saveForm), and
  // a local object URL is what lets the administrator see the face they are about
  // to file before the account behind it exists.
  const [photoUrl, setPhotoUrl] = useState(null);
  const [pendingPhoto, setPendingPhoto] = useState(null); // { blob, url }
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState(null); // { kind: 'ok' | 'error', text }
  const [cameraOpen, setCameraOpen] = useState(false);
  // The file input behind the picker button: a real input a browser will open a dialog
  // for, clicked by the button beside it the way the Profile panel's label does it.
  const photoInputRef = useRef(null);

  // ---- The open account ------------------------------------------------------
  //
  // WHICH ACCOUNT IS BEING READ, held as an ID rather than as a copy of the row. The row
  // lives in `users`, which `load()` replaces after every change, so an edit made from
  // this page is reflected on it the moment the list comes back — where a captured copy
  // would keep showing the name somebody just corrected.
  const [profileId, setProfileId] = useState(initialUserId);
  const [profileNonce, setProfileNonce] = useState(0);
  // Deep-link from the dashboard's hanging badges: dragging a badge to the
  // bottom opens that account here, so a new id prop opens its page.
  useEffect(() => {
    if (initialUserId !== null && initialUserId !== undefined) setProfileId(initialUserId);
  }, [initialUserId]);
  // What the page has read so far. `reports` is { rows, total }; `signIns` and `activity`
  // are the audit trail's own entries; `sheet` is the trail counted per day, for the year
  // (see the view's note on where each number comes from).
  const [profile, setProfile] = useState({ reports: null, signIns: [], activity: [], sheet: null, loading: false, failed: null });
  // WHICH READING THE SHEET SHOWS — the two are one chart with a switch, so the choice
  // lives here rather than in the sheet: it survives moving to another colleague, which is
  // what an administrator comparing two accounts wants, and it keeps the sheet a view.
  const [sheetMetric, setSheetMetric] = useState('attendance');

  async function load() {
    try {
      const data = await api('/users');
      setUsers(data.users);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // WHAT THE OPEN ACCOUNT PAGE SHOWS.
  //
  // THREE READS, ALL OF THEM ENDPOINTS OTHER SCREENS ALREADY USE, and that is the whole
  // argument for doing it this way rather than inventing a /users/:id/summary: the
  // reports come from the SAME list query with the SAME filters, so the count and the
  // statuses here cannot drift from what All Reports shows, and the activity is the
  // audit trail's own rows rather than a second account of the same events.
  //
  //   /reports?created_by=…   the officer's blotter (Admin-only filter; pagination.total
  //                           is their total, not the station's)
  //   /audits?user_id=…       everything the trail has recorded for them
  //   …&action=login.success  their sign-ins, which is the only attendance record this
  //                           system keeps
  //   /users/:id/activity     the same trail COUNTED PER DAY, for the year sheet — two
  //                           counts per day rather than two lists to be counted on the
  //                           client, zero-filled server-side (see the controller)
  //
  // ALL THREE AT ONCE, and one loading state for the page: a page drawn in thirds, each
  // arriving when it arrives, is three layouts shifting under somebody who is trying to
  // read it. A failure is reported once, with the retry beside it.
  useEffect(() => {
    if (profileId === null) return undefined;
    let alive = true;
    setProfile({ reports: null, signIns: [], activity: [], sheet: null, loading: true, failed: null });

    Promise.all([
      api(`/reports?created_by=${profileId}&per_page=5`),
      api(`/audits?user_id=${profileId}&action=login.success&per_page=5`),
      api(`/audits?user_id=${profileId}&per_page=8`),
      api(`/users/${profileId}/activity`),
    ])
      .then(([reports, signIns, activity, sheet]) => {
        if (!alive) return;
        setProfile({
          reports: {
            rows: Array.isArray(reports?.reports) ? reports.reports : [],
            total: Number(reports?.pagination?.total ?? 0),
          },
          signIns: Array.isArray(signIns?.audits) ? signIns.audits : [],
          activity: Array.isArray(activity?.audits) ? activity.audits : [],
          // The year, exactly as the server counted it: the day series, both summaries
          // and the window (which is what tells the sheet which squares are days that
          // have not happened yet).
          sheet: {
            days: Array.isArray(sheet?.days) ? sheet.days : [],
            summary: sheet?.summary ?? null,
            window: sheet?.window ?? {},
          },
          loading: false,
          failed: null,
        });
      })
      .catch((err) => {
        if (!alive) return;
        setProfile({
          reports: null,
          signIns: [],
          activity: [],
          sheet: null,
          loading: false,
          failed: err.message || 'The server could not be reached.',
        });
      });

    return () => {
      alive = false;
    };
  }, [profileId, profileNonce]);

  // ESCAPE CLOSES A DIALOG, AND ELSEWHERE THE OPEN ACCOUNT. Every other panel in this
  // app answers Escape for itself — the profile menu, the shortcut sheet, the AI panel —
  // and these were the exception: the only way out of a confirmation was the Cancel
  // button under the pointer, which is a trap for a keyboard.
  //
  // ONE ESCAPE BELONGS TO ONE THING, in this order: a dialog that is up takes it (a
  // confirmation about an account is more specific than the page it was opened from),
  // and with no dialog up it is the account page's way back to the directory. The
  // listener only exists while there is something for it to close, which is also what
  // keeps it from racing the row menu's own handler.
  useEffect(() => {
    if (confirm === null && resetFor === null && profileId === null) return undefined;

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirm !== null || resetFor !== null) {
        setConfirm(null);
        setResetFor(null);
        return;
      }
      setProfileId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirm, resetFor, profileId]);

  async function runConfirm() {
    const c = confirm;
    setConfirm(null);
    try {
      await c.action();
      notify(c.doneMessage);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function askDeactivate(u) {
    setConfirm({
      title: `Deactivate account for ${u.full_name}?`,
      message:
        'The account will be deactivated, not deleted. Their past reports and audit history remain intact. They will no longer be able to sign in.',
      confirmLabel: 'Deactivate Account',
      doneMessage: `Account for ${u.full_name} deactivated.`,
      action: () => api(`/users/${u.id}`, { method: 'DELETE' }),
    });
  }

  function askReactivate(u) {
    setConfirm({
      title: `Reactivate account for ${u.full_name}?`,
      message: 'The user will be able to sign in again with their existing password.',
      confirmLabel: 'Reactivate Account',
      doneMessage: `Account for ${u.full_name} reactivated.`,
      action: () => api(`/users/${u.id}`, { method: 'PATCH', body: { status: 'active' } }),
    });
  }

  /**
   * Issue a fresh set of OFFLINE recovery codes for an account (migration 018).
   *
   * THE ENROLMENT STEP the station chose: Admin-assisted, in person, so every
   * Admin/Officer has a way in when mail cannot send. The server REPLACES any
   * existing codes, so regenerating after a leak is the same press as the first
   * issue, and the previous set stops working immediately.
   *
   * The response carries the plaintext codes and nothing else ever will — the
   * database stores only a one-way hash of each. That is why the dialog is a
   * PRINT moment rather than a manage screen: there is no "view them again".
   */
  async function askRecoveryCodes(u) {
    try {
      const res = await api(`/users/${u.id}/recovery-codes`, { method: 'POST' });
      setRecoverySheet({
        account: res.account || u.full_name,
        username: u.username,
        codes: Array.isArray(res.codes) ? res.codes : [],
      });
    } catch (err) {
      notify(err.message || 'The recovery codes could not be generated.');
    }
  }

  // The print twin is gated on a body class so a browser print of the recovery
  // sheet prints ONLY the codes — the app hides behind it (see @media print).
  useEffect(() => {
    if (!recoverySheet) return undefined;
    document.body.classList.add('recovery-sheet-open');
    return () => document.body.classList.remove('recovery-sheet-open');
  }, [recoverySheet]);

  function askResetPassword(u) {
    setResetFor(u);
    setResetPassword('');
    setResetError('');
  }

  /**
   * Clear an account's second factor — the way back in when the phone and the
   * recovery codes are both gone.
   *
   * The dialog says what actually happens rather than "are you sure": the
   * officer is signed out at their next action, the account is password-only
   * until they sign in again, and they will be asked to enrol from scratch. The
   * sentence about NOT being able to read their codes is the important one — an
   * administrator's first instinct is to ask for the codes, and there is no
   * screen anywhere that can show them (the server keeps digests).
   */
  function askResetMfa(u) {
    setConfirm({
      title: `Reset verification for ${u.full_name}?`,
      message:
        'Use this when their account is locked out by too many incorrect codes, or when their mailbox has just been fixed. Any code they are still holding stops working, and the next sign-in sends a fresh one to the same address. Their email address and password are not changed, and this is recorded in the audit trail. Nobody can read a code for you — only a one-way hash of each is stored.',
      confirmLabel: 'Reset Verification',
      doneMessage: `Verification reset for ${u.full_name}.`,
      action: () => api(`/users/${u.id}/mfa-reset`, { method: 'POST' }),
    });
  }

  async function runResetPassword(e) {
    e.preventDefault();
    // The same rule the server will apply, from the same one home on this side
    // (lib/passwordPolicy.js, which is held to app/core/PasswordPolicy.php by
    // test). Checked against the account being reset, so an admin cannot set a
    // password that is really just that officer's username. The server refuses
    // it either way — this is so the admin is told before the round trip.
    const policy = checkPassword(resetPassword, {
      username: resetFor.username,
      badge: resetFor.badge_number,
    });
    if (policy !== null) {
      setResetError(policy);
      return;
    }
    try {
      await api(`/users/${resetFor.id}`, { method: 'PATCH', body: { password: resetPassword } });
      notify(`Password reset for ${resetFor.full_name}.`);
      setResetFor(null);
    } catch (err) {
      setResetError(err.message);
    }
  }

  /**
   * A row's actions, as the menu wants them.
   *
   * ORDER IS THE ROW'S OWN HISTORY: read the account, then the two things an
   * administrator comes to this screen to fix (a password, a stuck second
   * factor), then the one that ends it — last, and the only one marked `danger`.
   *
   * The destructive item never disappears — a deactivated row's menu has to
   * carry the way back, which is the only thing anyone wants from it.
   */
  function rowItems(u) {
    return [
      // FIRST, because it is what the row does now and the question an administrator
      // actually arrives with. "Edit details" stays where it was, one line below, for the
      // administrator who already knows what they came to change.
      { label: 'View profile', onSelect: () => openProfile(u) },
      { label: 'Edit details', onSelect: () => startEdit(u) },
      { label: 'Reset password', onSelect: () => askResetPassword(u) },
      // The offline factor (migration 018) sits beside the mailbox one: one
      // issues a printed way in, the other clears a stuck mailbox code.
      { label: 'Issue recovery codes', onSelect: () => askRecoveryCodes(u) },
      { label: 'Reset verification', onSelect: () => askResetMfa(u) },
      u.status === 'active'
        ? { label: 'Deactivate account', danger: true, onSelect: () => askDeactivate(u) }
        : { label: 'Reactivate account', onSelect: () => askReactivate(u) },
    ];
  }

  function openRowMenu(u, at, rowEl, viaKeyboard) {
    setMenu({ user: u, at, rowEl, viaKeyboard });
  }

  function closeRowMenu() {
    const opened = menu;
    setMenu(null);
    // A menu opened from the KEYBOARD hands focus back to its row; the mouse does
    // not need this, because the click that dismissed the menu has already put
    // focus where the officer aimed it.
    if (opened?.viaKeyboard && opened.rowEl && document.contains(opened.rowEl)) {
      opened.rowEl.focus?.({ preventScroll: true });
    }
  }

  /**
   * Drop a photograph that has not been filed yet, revoking the URL it owned.
   *
   * An object URL holds its bytes until it is revoked, and this one is replaced
   * every time the administrator picks a different picture — so "the last one"
   * would otherwise stay in memory for the life of the tab.
   */
  function discardPendingPhoto() {
    setPendingPhoto((held) => {
      if (held) URL.revokeObjectURL(held.url);
      return null;
    });
  }

  /**
   * One photograph job at a time. Decoding, re-encoding and uploading all count as
   * busy, because on a large photograph the decode is the slow half and an
   * administrator with no feedback would press the button again.
   */
  async function withPhotoJob(job) {
    setPhotoBusy(true);
    setPhotoNote(null);
    try {
      await job();
    } catch (err) {
      setPhotoNote({ kind: 'error', text: err.message || 'That photograph could not be saved.' });
    } finally {
      setPhotoBusy(false);
    }
  }

  /**
   * Send a prepared photograph to the account being edited, or hold it until there
   * is an account to send it to.
   *
   * THE ADMIN ROUTE, not /me: this is an administrator setting somebody else's
   * face, which is the case /me/photo cannot answer — an account being created has
   * an owner who has not signed in yet. Both routes audit `user.photo_set`; on this
   * one the ADMIN is the actor, which is what the trail is read for.
   */
  async function attachPhoto(blob) {
    if (!editingId) {
      discardPendingPhoto();
      setPendingPhoto({ blob, url: URL.createObjectURL(blob) });
      setPhotoNote({ kind: 'ok', text: 'This photograph is saved to the account when you create it.' });
      return;
    }

    const body = new FormData();
    body.append('photo', blob, 'avatar.jpg');
    const saved = await apiUpload(`/users/${editingId}/photo`, body);
    setPhotoUrl(saved.photo_url ?? null);
    // THE ROW IS PATCHED, NOT THE LIST RE-FETCHED: the face is the only thing that
    // changed, and re-loading would throw away the filters an administrator has set
    // on the directory behind this form.
    setUsers((rows) => (rows ?? []).map((r) => (r.id === editingId ? { ...r, photo_url: saved.photo_url ?? null } : r)));
    setPhotoNote({ kind: 'ok', text: 'Photograph saved to the account.' });
  }

  async function choosePhoto(e) {
    const file = e.target.files && e.target.files[0];
    // Cleared before anything else, so choosing the SAME file again re-fires this
    // handler — otherwise "Replace photo" would do nothing the second time.
    e.target.value = '';
    if (!file) return;

    const rejected = checkAvatarFile(file);
    if (rejected !== null) {
      setPhotoNote({ kind: 'error', text: rejected });
      return;
    }

    await withPhotoJob(async () => {
      // Re-encoded HERE, before it is sent: a photograph off a phone is several
      // megabytes and the server accepts 2 MB, so shrinking it in the browser
      // removes the failure instead of explaining it (see lib/avatar.js).
      await attachPhoto(await prepareAvatar(file));
    });
  }

  /** A frame from the camera — through the SAME encode as a chosen file. */
  function takePhoto(blob) {
    setCameraOpen(false);
    withPhotoJob(async () => {
      await attachPhoto(await prepareAvatar(blob));
    });
  }

  function removePhoto() {
    if (!editingId) {
      discardPendingPhoto();
      setPhotoNote(null);
      return;
    }
    withPhotoJob(async () => {
      await api(`/users/${editingId}/photo`, { method: 'DELETE' });
      setPhotoUrl(null);
      setUsers((rows) => (rows ?? []).map((r) => (r.id === editingId ? { ...r, photo_url: null } : r)));
      setPhotoNote({ kind: 'ok', text: 'Photograph removed — the directory draws their initials.' });
    });
  }

  /**
   * Open an account: read it rather than edit it.
   *
   * The row's own way in, and the row menu's first item. Nothing is edited until the
   * pen on the account page is pressed — the whole point of the page.
   */
  function openProfile(u) {
    setForm(null);
    setEditingId(null);
    setProfileId(u.id);
  }

  /**
   * Leave the account page for the directory.
   *
   * `profileId` is also what the edit form comes BACK to: `startEdit` does not clear it,
   * so  opening a row, pressing the pen, and cancelling the form lands on the account
   * again rather than on a directory the administrator did not ask to see.
   */
  function closeProfile() {
    setProfileId(null);
  }

  /** Read the page again after a failure — the retry beside the message. */
  function reloadProfile() {
    setProfileNonce((n) => n + 1);
  }

  function startEdit(u) {
    setEditingId(u.id);
    setForm({
      full_name: u.full_name,
      badge_number: u.badge_number,
      username: u.username,
      email: u.email || '',
      role: u.role,
      password: '',
    });
    setPhotoUrl(u.photo_url ?? null);
    discardPendingPhoto();
    setPhotoNote(null);
  }

  function startCreate() {
    setEditingId(null);
    // A new account has no page to come back to: the create form is opened from the
    // directory and closes back to it.
    setProfileId(null);
    setForm({ ...EMPTY_FORM });
    setPhotoUrl(null);
    discardPendingPhoto();
    setPhotoNote(null);
  }

  /**
   * Leave the form, taking any unfiled photograph with it.
   *
   * Cancel goes through here rather than setting `form` to null directly for one
   * reason: a photograph chosen while creating has an object URL holding its bytes, and
   * an abandoned form that nobody revokes keeps them for the life of the tab.
   */
  function closeForm() {
    setForm(null);
    discardPendingPhoto();
    setPhotoNote(null);
  }

  async function saveForm(e) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body = { ...form };
    if (editingId && !body.password) delete body.password;
    try {
      if (editingId) {
        await api(`/users/${editingId}`, { method: 'PATCH', body });
        notify('Account updated.');
      } else {
        const created = await api('/users', { method: 'POST', body });
        // THE PHOTOGRAPH HAS NOWHERE TO GO UNTIL THE ACCOUNT EXISTS, so it is sent
        // here — after the id arrives, and not as part of the create request, which
        // is JSON and has no field for a file.
        //
        // AND ITS FAILURE IS NOT THE ACCOUNT'S. The account was created; saying
        // otherwise because a photograph did not land would send the administrator
        // back to a form that would now refuse the username as taken. So this is
        // reported as what it is — one thing worked and one did not — with the way
        // to finish it (the account is in the directory, and its own form has the
        // same photo controls).
        if (pendingPhoto) {
          try {
            const photoBody = new FormData();
            photoBody.append('photo', pendingPhoto.blob, 'avatar.jpg');
            await apiUpload(`/users/${created.id}/photo`, photoBody);
          } catch (err) {
            discardPendingPhoto();
            setSaving(false);
            setForm(null);
            await load();
            setError(
              `The account was created, but its photograph could not be saved: ${err.message} Open the account to try again.`,
            );
            return;
          }
        }
        notify('Account created.');
      }
      // Cleared before the form closes: a flag left true behind an unmounted form is a
      // button that stays disabled the next time it is opened.
      setSaving(false);
      closeForm();
      await load();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // WHAT THE DIRECTORY IS SHOWING: the roster, narrowed by the toolbar's two
  // controls. Filtered HERE rather than server-side because the whole station
  // arrives in one response — there is no page to fetch, so there is no round
  // trip worth making for a keystroke.
  const needle = search.trim().toLowerCase();
  const shown = (users ?? []).filter((u) => {
    if (role !== '' && u.role !== role) return false;
    if (status !== '' && u.status !== status) return false;
    if (needle === '') return true;
    return `${u.full_name} ${u.username} ${u.badge_number} ${u.email ?? ''}`
      .toLowerCase()
      .includes(needle);
  });
  const filtered = needle !== '' || role !== '' || status !== '';
  // How many of the row's own keys are set: the Filters button wears this while
  // the row is folded away, so a narrowed list never reads as unfiltered.
  const filterCount = (role !== '' ? 1 : 0) + (status !== '' ? 1 : 0);
  // THE DIRECTORY'S ORDERS. Name first: a station directory reads alphabetically.
  // Badge number is the station's own identifier order; recently signed in answers
  // who was last at a desk. The server's own arrival order is not offered — the
  // directory never promised it, so it is not a choice on screen.
  const sorted = [...shown].sort((a, b) => {
    if (sort === 'badge') {
      return String(a.badge_number ?? '').localeCompare(String(b.badge_number ?? ''), undefined, { numeric: true });
    }
    if (sort === 'recent') return seenTime(b) - seenTime(a);
    return String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''), undefined, { sensitivity: 'base' });
  });
  const sortOrder = SORT_ORDERS.find((o) => o.key === sort) ?? SORT_ORDERS[0];
  // The sort menu opens under its button, the way the row's own menu opens where
  // the officer is pointing: viewport coordinates for a menu portaled to <body>.
  function openSortMenu(e) {
    const box = e.currentTarget.getBoundingClientRect();
    setSortMenuAt({ x: box.left, y: box.bottom + 6 });
  }
  const sortItems = SORT_ORDERS.map((o) => ({
    label: o.label,
    checked: o.key === sort,
    onSelect: () => { setSort(o.key); setSortMenuAt(null); },
  }));
  function clearFilters() {
    setSearch('');
    setRole('');
    setStatus('');
  }

  // The account being READ, looked up out of the list rather than copied at the moment
  // the row was clicked: `load()` replaces that list after every change, so a name, a
  // role or a photograph corrected from this page is on the page the moment the server
  // answers. An account that is no longer in the list — deactivated out of the filtered
  // view, or gone — closes the page by simply not being renderable.
  const profileUser = profileId === null ? null : (users ?? []).find((u) => u.id === profileId) ?? null;

  // THE PASSWORD RULE, BEFORE THE ROUND TRIP, through the same mirror of
  // PasswordPolicy that the reset dialog uses and measured against the identifiers this
  // account WILL have (the server checks the same pair). Blank says nothing at all: on
  // the edit form blank means "keep the current one", and on the create form the browser
  // has already stopped the submit.
  const passwordProblem = form && form.password !== ''
    ? checkPassword(form.password, { username: form.username, badge: form.badge_number })
    : null;

  if (users === null && !error) {
    // The screen keeps its page head while the directory is being read. It used
    // to return a bare "Loading users…" line first, which took the title and the
    // meta block off the page and put them back once the read landed, so the
    // screen changed shape twice on every visit. Placeholder rows stand where
    // the table will be instead, so nothing moves when it arrives.
    return (
      <>
        <h1 className="sr-only">User management</h1>
        <div aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton-row" />)}
        </div>
      </>
    );
  }

  // What the meta block reports, in three states rather than two. A failed read
  // leaves the list undefined, and the old two-way test then printed "LOADING…"
  // for as long as the screen stayed open — the one thing the screen was no
  // longer doing. The error itself is stated by the alert below.
  // The count says what is SHOWN and what exists, in that order, so a filtered
  // directory never reads as a station that lost its accounts.
  const totalLine = users ? `${users.length} ACCOUNT${users.length === 1 ? '' : 'S'}` : '';
  // THE DIRECTORY COUNT FOR THE TOOLBAR CHIP. The page head no longer carries
  // the count (owner request): the chip beside Who's connected is the one place
  // that says how many accounts the station holds. Filtered or not, it names the
  // whole directory — a filtered view never reads as a station that lost accounts.
  const directoryCount = users ? users.length : 0;
  const directoryStatus = error
    ? 'Account list unavailable'
    : users
      ? (filtered
        ? `${shown.length} of ${directoryCount} accounts shown`
        : `${directoryCount} account${directoryCount === 1 ? '' : 's'}`)
      : 'Loading accounts…';

  return (
    // THE PAGE ITSELF CARRIES `.acct-page` WHILE THE FORM OR AN ACCOUNT IS OPEN, which is
    // what centres it. The reason it wraps the TITLE as well as the form is the one
    // `.st-page` gives for Station Settings: a centred card under a page title pinned to
    // the left edge is two alignments on one screen, so the title moves in with the form
    // and the whole thing reads as one page. The directory is deliberately left alone —
    // its table is meant to use the whole window, and centring it would narrow the very
    // thing the screen exists to show. The account READ view adds `.acct-read`: it sits
    // flat on the page with no card boxes, like Station Settings, while the edit form
    // keeps its cards.
    <div className={form || profileUser ? `acct-page${profileUser && !form ? ' acct-read' : ''}` : 'users-page'}>
      {/* NO VISIBLE TITLE. The rail is the head of this screen: it sits 0.02cm
          under the top bar the way the register's own strip does (owner request),
          so there is no title block and no gutter between them. The name travels
          in the heading below, for the document outline and screen readers. */}
      <h1 className="sr-only">User management</h1>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {form ? (
        <form onSubmit={saveForm}>
            {/* THE FORM IS THE SCREEN, so it says so at the top rather than hanging
                under the page head with no frame around it. Both sentences are the two
                things the fields cannot say: what happens to what an administrator
                types, and what the officer gets at the other end — and they are on the
                marker beside the title, because a 40-word paragraph between the title
                and the first field is a paragraph an administrator scrolls past. */}
            <div className="acct-head">
              <div className="acct-headline">
                <h2 className="acct-title">
                  {editingId ? `Edit ${form.full_name || 'this account'}` : 'Create an account'}
                </h2>
                <InfoHint
                  text={editingId
                    ? 'A change here is recorded in the audit trail under your name. Leave the password blank and they keep the one they have.'
                    : 'One account per officer. Everything on this form is recorded in the audit trail under your name, and the password below is the one they start with: they can change it themselves from their Profile.'}
                />
              </div>
            </div>

            <div className="acct-grid">
              <div className="acct-main">
                {/* ============ 1. WHO THE ACCOUNT IS FOR ============ */}
                <section className="st-block">
                  <div className="st-block-head">
                    {/* The card's own sentence rides on the marker beside its heading,
                        the same way a field's does beside its label — so each card is a
                        heading, a circle, and the fields it is about. What a card is
                        FOR is worth having; it is not worth taking three lines between
                        the heading and the first field it describes. */}
                    <div className="acct-headline">
                      <h3>Who the account is for</h3>
                      <InfoHint text="How they read in the directory, in the audit trail and on every report they record. All three identify them for as long as the account exists, so they are worth a moment." />
                    </div>
                  </div>

                  {/* THE FACE COMES FIRST IN THE CARD ABOUT IDENTITY, because it is the
                      one thing on this form that is a person rather than a field. It is
                      also the one part of the record that the officer will replace
                      themselves — every other field here is the administration's, and
                      this one is only the administration's UNTIL they sign in. */}
                  <div className="acct-photo">
                    <Avatar
                      user={{
                        // The ACCOUNT's id, so the circle is the same colour here as it
                        // is on the roster and in the audit trail — the gradient is
                        // picked from the id, and a face that changed colour between
                        // this form and the directory would read as a different person.
                        // Null while creating: there is no id yet, and Avatar's rule for
                        // that is the first gradient rather than no colour at all.
                        id: editingId,
                        full_name: form.full_name,
                        // The held photograph wins while there is one: it is the face
                        // about to be filed, and drawing the saved one until the
                        // account is created would show the administrator something
                        // they did not choose.
                        photo_url: pendingPhoto ? pendingPhoto.url : photoUrl,
                      }}
                      className="acct-photo__face"
                      // A NEW ACCOUNT HAS NO NAME YET, and this circle is the first thing
                      // on the form: without a stand-in it is a coloured circle with
                      // nothing in it, which reads as a broken image rather than as an
                      // empty field. The silhouette holds the place until either a
                      // photograph or a name arrives — see Avatar on why a placeholder is
                      // opt-in. The other faces in the app are untouched: a colleague
                      // with a name wears their initials, and always has.
                      placeholder={<PersonGlyph />}
                    />
                    <div className="acct-photo__text">
                      <span className="acct-photo__label">
                        Photograph
                        <InfoHint
                          text={
                            editingId
                              ? 'Shown in the directory and on the presence rail. You can set it here, and they can replace it themselves from their own Profile — either way the change is recorded in the audit trail under the name of whoever made it.'
                              : 'Optional, and saved with the account. An account with no photograph is drawn from its initials. The officer can replace it themselves from their own Profile.'
                          }
                        />
                      </span>
                      <span className="acct-photo__hint">
                        {photoUrl || pendingPhoto
                          ? 'Saved as a square, 256px. Whatever is chosen is centre-cropped to fit the circle.'
                          : 'Upload one from this computer, or take one with the camera.'}
                      </span>
                      <div className="acct-photo__actions">
                        {/* REAL BUTTONS, unlike the Profile panel's label-wrapped
                            input: here the picker sits beside the camera and a Remove,
                            and all three are the app's own neutral controls — a label
                            mimicking that look would be a fourth place for it to drift.
                            The input is real and out of the tab order; this button is
                            what has the name. */}
                        <button
                          type="button"
                          className="acct-photo__pick"
                          onClick={() => photoInputRef.current?.click()}
                          disabled={photoBusy}
                        >
                          {photoBusy ? 'Saving…' : photoUrl || pendingPhoto ? 'Replace photo' : 'Upload a photo'}
                        </button>
                        <input
                          ref={photoInputRef}
                          type="file"
                          className="acct-photo__input"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={choosePhoto}
                          tabIndex={-1}
                          aria-hidden="true"
                          disabled={photoBusy}
                        />
                        <button
                          type="button"
                          className="acct-photo__camera"
                          onClick={() => setCameraOpen(true)}
                          disabled={photoBusy}
                        >
                          Take a photo
                        </button>
                        {(photoUrl || pendingPhoto) && (
                          <button
                            type="button"
                            className="acct-photo__remove"
                            onClick={removePhoto}
                            disabled={photoBusy}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {/* One line, and only when there is something to say: a permanent
                          "no error" line is a row of the card spent on nothing.
                          Polite rather than assertive, because the failure of a
                          photograph must not interrupt a field somebody is typing in. */}
                      {photoNote && (
                        <p className={`acct-photo__note is-${photoNote.kind}`} role="status">
                          {photoNote.text}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="form-grid">
                    {/* EVERY SENTENCE THAT USED TO SIT UNDER A FIELD IS ON THE ⓘ MARKER
                        BESIDE ITS LABEL. The form is read to be filled in, and four
                        explanatory paragraphs under four fields is a page an administrator
                        scrolls rather than completes — so the words are kept and the space
                        is given back. Nothing is hover-only: the marker takes focus, and
                        it sits INSIDE the label, so its sentence is part of what a screen
                        reader announces for the field either way.

                        The one thing that does NOT go behind a marker is a COMPLAINT —
                        see the password field below. A rule can wait to be asked for; a
                        refusal has to be on the screen. */}
                    <div className="field">
                      <label htmlFor="u-fullname">
                        Full name<span className="req">*</span>
                        <InfoHint text="The whole name, as it should appear in the directory." />
                      </label>
                      <input
                        id="u-fullname"
                        value={form.full_name}
                        maxLength={120}
                        autoComplete="off"
                        onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="u-badge">
                        Badge / employee number<span className="req">*</span>
                        <InfoHint text="Unique on the station: a second account with the same number is refused." />
                      </label>
                      <input
                        id="u-badge"
                        value={form.badge_number}
                        maxLength={40}
                        autoComplete="off"
                        onChange={(e) => setForm({ ...form, badge_number: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="u-username">
                        Username<span className="req">*</span>
                        <InfoHint text="What they type to sign in. Unique, and safe to change later." />
                      </label>
                      <input
                        id="u-username"
                        value={form.username}
                        maxLength={60}
                        autoComplete="off"
                        onChange={(e) => setForm({ ...form, username: e.target.value })}
                        required
                      />
                      {/* No claim about case or characters: the server compares what it
                          is given, and this form does not get to describe a rule it does
                          not enforce. Unique is the rule it does enforce, and it is
                          checked against the same column the sign-in reads. */}
                    </div>
                  </div>
                </section>

                {/* ============ 2. SIGN-IN AND ACCESS ============ */}
                <section className="st-block">
                  <div className="st-block-head">
                    <div className="acct-headline">
                      <h3>Sign-in and access</h3>
                      <InfoHint text="The role decides which screens this account is offered; the address decides whether a sign-in code has anywhere to arrive." />
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="u-role">
                        Role
                        {/* The one sentence here that CHANGES with the form rather than
                            describing a fixed rule: it is read off `ROLE_REACH`, so the
                            marker beside the control always explains the role the select
                            is currently showing, and a fourth role is one object in the
                            table rather than a fourth branch in this markup. */}
                        <InfoHint text={ROLE_REACH[form.role].summary} />
                      </label>
                      <select
                        id="u-role"
                        value={form.role}
                        onChange={(e) => setForm({ ...form, role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      {/* The rule is the server's (EmailOtp::REQUIRED_ROLES), stated on
                          the marker beside the label so the admin is not surprised by a
                          422 after typing a whole form: Admin and Officer sign in with an
                          emailed code, so their account needs somewhere for the code to
                          go. The same predicate as the field's own `required` and the
                          asterisk in its label — one answer to "does this role get a
                          code?". */}
                      <label htmlFor="u-email">
                        Email address{usesEmailCode(form.role) && <span className="req">*</span>}
                        <InfoHint
                          text={usesEmailCode(form.role)
                            ? 'Sign-in codes are sent here, so it is required for an Admin or an Officer. One account per address.'
                            : 'Sign-in codes are sent here.'}
                        />
                      </label>
                      <input
                        id="u-email"
                        type="email"
                        autoComplete="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        required={usesEmailCode(form.role)}
                      />
                    </div>
                  </div>

                  <div className="form-grid">
                    {/* `acct-pass` caps this field rather than letting `span-2` stretch it
                        across the whole card: a password input the width of the page is a
                        field whose end nobody can see. */}
                    <div className="field span-2 acct-pass">
                      <label htmlFor="u-pass">
                        Password{!editingId && <span className="req">*</span>}
                        {editingId && ' (leave blank to keep the current one)'}
                        <InfoHint text={`${passwordHint()} Not the account's username or badge number.`} />
                      </label>
                      <input
                        id="u-pass"
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required={!editingId}
                        minLength={MIN_LENGTH}
                        aria-describedby={passwordProblem ? 'u-pass-problem' : undefined}
                      />
                      {/* THE RULE IS BEHIND THE MARKER; THE COMPLAINT IS NOT. The rule is
                          something an administrator may want to know, which is what a
                          marker is for. A refusal is something they have to act on, and a
                          tooltip is the one place nobody looks for one — so the complaint
                          stays a line of the form, appearing the moment the value in the
                          box breaks a rule and gone again when it does not.

                          It is measured by the same mirror of PasswordPolicy the reset
                          dialog uses, against the identifiers this account WILL have
                          (the server checks the same pair). Blank says nothing, because
                          blank is legal on the edit form. `aria-describedby` is claimed
                          only while there is something in it, so the field is never
                          described by an element that is not there. */}
                      {passwordProblem && (
                        <p className="field-hint is-problem" id="u-pass-problem">
                          {passwordProblem}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <div className="st-actions acct-actions">
                  <button type="submit" className="primary" disabled={saving}>
                    {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Account'}
                  </button>
                  <button type="button" onClick={closeForm} disabled={saving}>
                    Cancel
                  </button>
                  <span className="st-quiet">
                    <span className="req">*</span> Required.{' '}
                    {editingId
                      ? 'The password is the only field that may be left blank.'
                      : 'The server refuses a duplicate username, badge number or address.'}
                  </span>
                </div>
              </div>

            </div>
          </form>
      ) : profileUser ? (
        <UserProfileView
          user={profileUser}
          reports={profile.reports}
          signIns={profile.signIns}
          activity={profile.activity}
          sheet={profile.sheet}
          metric={sheetMetric}
          onMetric={setSheetMetric}
          loading={profile.loading}
          failed={profile.failed}
          onEdit={() => startEdit(profileUser)}
          onBack={closeProfile}
          onRetry={reloadProfile}
        />
      ) : (
        <>
          {/* NO INSTRUCTION STRIP. Where the actions are is said where it is
              needed: each row's own `title` on hover, and the table's caption
              for anyone reading by screen reader. A standing sentence above the
              table is read once and then skimmed forever. */}

          <form className="reports-toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
            {/* `users-filters` IS WHY THIS ROW IS ONE LINE. `.reports-toolbar-row` is a plain
                block shared with the audit trail's toolbar, and this is the one screen with
                something that belongs at the END of the filter line rather than on the line
                after it — the presence pill (see ConnectionHub.css, where the row's own rule
                is scoped to this class). */}
            <div className="reports-toolbar-row users-filters">
              {/* The box IS the filter: there is nothing to submit and nothing to
                  wait for, so the magnifier submits nothing — the list narrows as it is typed, in the register's own dress. Escape clears
                  it, which is the one key a search field is expected to answer. */}
              <div className="reports-search register-tools__search">
                <button type="submit" className="reports-search__go" aria-label="Search accounts">
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" />
                    <path d="m16.2 16.2 4.3 4.3" />
                  </svg>
                </button>
                <input
                  type="search"
                  className="register-tools__input"
                  placeholder="Search name, username, badge no. or email…"
                  aria-label="Search accounts by name, username, badge number or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setSearch('');
                  }}
                />
              </div>
              {/* The seam between "what you are looking for" and the keys that
                  narrow and order it — the register's own hairline, not an edge. */}
              <span className="register-tools__rule" aria-hidden="true" />
              {/* FILTERS. The role and status keys live in the row below; this is
                  their disclosure, wearing the count of what that row is holding
                  while it is folded away (the audit trail's own pattern). */}
              <button
                type="button"
                className="register-tool"
                aria-label={filterCount > 0 ? `Filters — ${filterCount} set` : 'Filters'}
                aria-expanded={filtersOpen}
                aria-controls="users-filter-row"
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 5.5h16l-6.2 7.2v5.1l-3.6 1.7v-6.8L4 5.5z" /></svg>
                <span className="register-tool__label">Filters</span>
                {filterCount > 0 && (<span className="register-tool__count" aria-hidden="true">{filterCount}</span>)}
              </button>
              {/* SORT. The directory's order, as a menu, with the order in force
                  ticked (see RowMenu's `checked`). The button states that order in
                  its own name, and wears the accent while the list is in an order
                  other than Name A–Z. */}
              <button
                type="button"
                className="register-tool"
                aria-label={`Sort accounts — ${sortOrder.label}`}
                aria-haspopup="menu"
                aria-expanded={sortMenuAt !== null}
                data-on={sort !== 'name' ? 'true' : undefined}
                onClick={openSortMenu}
              >
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M4 6.5h11" /><path d="M4 12h7.5" /><path d="M4 17.5h4.5" /><path d="M17.5 9.5v8" /><path d="m14.6 14.9 2.9 2.9 2.9-2.9" /></svg>
                <span className="register-tool__label">Sort</span>
              </button>
              {/* THE SCREEN'S PRIMARY ACTION, in the rail where the filters are
                  (owner request): a labelled Add User beside the keys, so creating
                  an account is found where the directory is read. Its label is
                  visible, so it needs no aria-label of its own. */}
              <button type="button" className="primary users-add" onClick={startCreate}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5.5v13M5.5 12h13" />
                </svg>
                Add User
              </button>
              {/* THE DIRECTORY'S MARK, beside the roster's doorway: the account icon
                  carries the station's headcount as its badge — the page head's old meta block, moved to the toolbar
                  (owner request) so the count sits with Who's connected rather than
                  across the page from it. A status, not a control: it names the whole
                  directory even while the table is filtered. */}
              <span className="users-directory-chip" role="status" aria-label={directoryStatus} title={directoryStatus}>
                <span className="users-directory-chip__icon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="8" r="3.6" />
                    <path d="M4.5 19.5c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4" />
                  </svg>
                  <span className="users-directory-chip__badge">{error ? '–' : directoryCount}</span>
                </span>
              </span>

              {/* THE ROSTER'S DOORWAY, and it is a pill rather than a panel because the
                  panel is the top of the page: a toggle says whether it is open (the
                  words change, `aria-expanded` states it, and the accent lights), and
                  the live dot says the thing the panel is about — that this is a live
                  reading rather than a report. It floats to the right end of the row
                  (see .conn-hub-toggle), so the filter controls stay where they were. */}
              <button
                type="button"
                className={`conn-hub-toggle${presenceOpen ? ' is-open' : ''}`}
                aria-expanded={presenceOpen}
                aria-controls="users-presence"
                onClick={() => setPresenceOpen((v) => !v)}
              >
                <span className="conn-hub-toggle__dot" aria-hidden="true" />
                <span className="conn-hub-toggle__label">
                  {presenceOpen ? 'Hide who’s connected' : 'Who’s connected now'}
                </span>
              </button>
            </div>
            {/* THE FILTER ROW. Role and status live here, in labelled cells the way
                the register's own filters do — the rail above stays a rail. Folded
                away until asked for; the Filters key wears the count meanwhile. */}
            <div className="reports-toolbar register-filters" id="users-filter-row" hidden={!filtersOpen}>
              <div className="reports-filters">
                <label className="reports-filter">
                  <span className="reports-filter__label">Role</span>
                  <select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">All roles</option>
                    {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                  </select>
                </label>
                <label className="reports-filter">
                  <span className="reports-filter__label">Status</span>
                  <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                {filtered && (<button type="button" className="reports-filter__clear" onClick={clearFilters}>Clear filters</button>)}
              </div>
            </div>
          </form>

          {/* THE ELEMENT `aria-controls` NAMES IS ALWAYS HERE, and the panel is mounted
              INSIDE it only while it is open: an `aria-controls` pointing at an id that
              does not exist is a broken reference for a screen reader, and the panel it
              would point at fetches the directory every thirty seconds — which a closed
              panel must not do. */}
          <div id="users-presence">
            {presenceOpen && (
              <ConnectionHub />
            )}
          </div>

          {users === null ? (
            // The read failed. The alert above carries the server's own sentence;
            // this is the space the directory would have filled, and it says what
            // happened rather than blaming the filters for matching nobody.
            <div className="empty">The station directory could not be read.</div>
          ) : users.length === 0 ? (
            <div className="empty">
              <strong>No accounts yet.</strong> Choose “Create Account” to add the first user.
            </div>
          ) : shown.length === 0 ? (
            <div className="empty">
              <strong>No accounts match these filters.</strong>{' '}
              <button type="button" className="button-link" onClick={clearFilters}>Clear them</button>{' '}
              to see the whole directory.
            </div>
          ) : (
            <UsersTable users={sorted} sortKey={sort} onOpen={openProfile} onEdit={startEdit} onMenu={openRowMenu} />
          )}
        </>
      )}

      {menu && (
        <RowMenu
          at={menu.at}
          label={`Actions for ${menu.user.full_name}`}
          items={rowItems(menu.user)}
          onClose={closeRowMenu}
        />
      )}

      {sortMenuAt && (
        <RowMenu
          at={sortMenuAt}
          label="Sort accounts"
          items={sortItems}
          onClose={() => setSortMenuAt(null)}
        />
      )}

      {resetFor && (
        <div className="dialog-overlay" onClick={() => setResetFor(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-pass-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reset-pass-title">Reset password — {resetFor.full_name}</h2>
            <p>
              Set a new password for <strong>{resetFor.username}</strong>. They will use it on
              their next sign-in. This action is recorded in the audit trail.
            </p>
            <form onSubmit={runResetPassword}>
              <div className="field">
                <label htmlFor="reset-pass-input">New password</label>
                <input
                  id="reset-pass-input"
                  type="password"
                  autoComplete="new-password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  minLength={MIN_LENGTH}
                  required
                  autoFocus
                />
                {/* Reset sets the password the OFFICER will type at the gate, so
                    it is held to the same rule as account creation and as the
                    officer's own change form — no path to a weaker password,
                    and no path to a stricter one either. */}
                <p className="field-hint">
                  {passwordHint()} Same rule as account creation — and as the
                  password an officer sets for themselves.
                </p>
              </div>
              {resetError && (
                <div className="alert error" role="alert">{resetError}</div>
              )}
              <div className="actions">
                <button type="button" onClick={() => setResetFor(null)}>Cancel</button>
                <button type="submit" className="primary">Reset Password</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* THE CAMERA DIALOG IS MOUNTED ONLY WHILE IT IS OPEN, and that is what stops
          the stream: leaving it mounted would leave a camera running behind the
          form, with the light on, for the rest of the shift (see CameraCapture).
          `form` is checked because this sits with the other dialogs, outside the
          branch that decides whether the form is drawn at all. */}
      {cameraOpen && form && (
        <CameraCapture
          title={editingId ? `Photograph for ${form.full_name || 'this account'}` : 'Photograph for this account'}
          onCapture={takePhoto}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {recoverySheet && (
        <div className="dialog-overlay" onClick={() => setRecoverySheet(null)}>
          <div
            className="dialog dialog--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-sheet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="recovery-sheet-title">Recovery codes — {recoverySheet.account}</h2>
            <p>
              Print <strong>two</strong> copies: one for the officer, and one to seal at the
              station. These codes are shown <strong>once</strong> and cannot be retrieved
              again — the server keeps only a one-way hash of each. Any previous codes for this
              account no longer work.
            </p>
            <div className="recovery-sheet">
              <div className="recovery-sheet-head">
                BlueWrite recovery codes — {recoverySheet.username}
              </div>
              <ol className="recovery-sheet-list">
                {recoverySheet.codes.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ol>
              <p className="recovery-sheet-foot">
                Each code can be used once, at the sign-in code screen, when email cannot be used.
              </p>
            </div>
            <div className="actions">
              <button type="button" onClick={() => setRecoverySheet(null)}>Close</button>
              <button type="button" className="primary" onClick={() => window.print()}>Print</button>
            </div>
          </div>
        </div>
      )}

      {/* The PRINT twin of the sheet above: hidden on screen, shown only in print
          (see @media print), so the browser prints the codes alone rather than the
          whole directory behind the dialog. */}
      {recoverySheet && (
        <div className="recovery-print-overlay" aria-hidden="true">
          <h1>BlueWrite recovery codes</h1>
          <p className="recovery-print-account">
            {recoverySheet.account}
            {recoverySheet.username ? ` (${recoverySheet.username})` : ''}
          </p>
          <ol className="recovery-print-list">
            {recoverySheet.codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ol>
          <p className="recovery-print-foot">
            Each code can be used once, at the sign-in code screen, when email cannot be used.
            Keep this sheet safe.
          </p>
        </div>
      )}

      {confirm && (
        <div className="dialog-overlay" onClick={() => setConfirm(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-title">{confirm.title}</h2>
            <p id="confirm-message">{confirm.message}</p>
            <div className="actions">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button className="danger" onClick={runConfirm}>
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
