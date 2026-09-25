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

/**
 * The three roles this station has, in the order the account form offers them.
 *
 * ONE HOME for the list: it is the account form's select, the directory's filter,
 * and the two places a role decides what a row may do (Reset verification). A
 * fourth role is a server change (the `roles` table) and a line here; three
 * copies of the three names is how the filter ends up offering a role the form
 * cannot create.
 */
const ROLES = ['Admin', 'Officer', 'Staff'];

/**
 * The roles that sign in with an emailed code as well as a password.
 *
 * One home for the pair, because three places on this screen already need it: the
 * email field's `required`, the sentence under that field, and the panel beside the
 * form. It is the server's list (EmailOtp::REQUIRED_ROLES), and the directory's own
 * Two-factor column reports on the same two roles.
 */
const CODE_ROLES = ['Admin', 'Officer'];

/** Whether this role's sign-in needs an address for a code to arrive at. */
const usesEmailCode = (role) => CODE_ROLES.includes(role);

/**
 * WHAT EACH ROLE ACTUALLY REACHES, which is the thing this form was silent about: an
 * administrator was asked to pick between three words and had nothing to read.
 *
 * TAKEN FROM THE CODE, NOT FROM THE NAMES. The bar is built from `isAdmin`
 * (AppTopBar), the blotter scopes non-admins to their own reports
 * (ReportsController::index), and finalize and the noting-officer designation are
 * refused to Staff there too (ReportsController::update). If one of those rules moves,
 * it moves here with it — a panel that promises a reach the server does not honour is
 * worse than a form that says nothing at all.
 *
 * `signIn` is the same distinction the directory's Two-factor column draws, stated
 * once so the two cannot disagree about what a Staff account is.
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
  Staff: {
    summary: 'An Officer’s workspace without the emailed sign-in code.',
    reach: [
      'Home, Write Report and My Reports',
      'Their own reports only',
      'Cannot finalize a report: that takes an Officer or an Admin',
    ],
  },
};

const EMPTY_FORM = {
  full_name: '',
  badge_number: '',
  username: '',
  email: '',
  role: 'Staff',
  password: '',
};

/**
 * What the Two-factor column says about one account.
 *
 * The second factor is a six-digit code emailed to the account's own address, so
 * what this column reports is whether that address EXISTS (the factor rests on
 * it), whether the factor is currently LOCKED after too many wrong codes, and
 * nothing else. 'Not required' is a Staff account — the factor is only mandatory
 * for Admin and Officer (see EmailOtp::REQUIRED_ROLES).
 *
 * "No email" is the state worth an administrator's attention: that account
 * cannot finish signing in at all, and the fix — recording an address — is on
 * the Edit form directly below this row.
 */
function twoFactorCell(user) {
  if (user.role !== 'Admin' && user.role !== 'Officer') {
    return { text: 'Not required', cls: 'user-mfa--na', title: 'Staff accounts sign in with a password only.' };
  }
  if (!user.email) {
    return {
      text: 'No email',
      cls: 'user-mfa--off',
      title: 'This account cannot receive a sign-in code. Add an email address before it needs to sign in.',
    };
  }
  if (user.otp_locked_until) {
    return {
      text: 'Locked',
      cls: 'user-mfa--thin',
      title: `Codes go to ${user.email}. Locked until ${user.otp_locked_until} after too many incorrect codes — Reset verification clears it.`,
    };
  }
  return {
    text: 'Email code',
    cls: 'user-mfa--on',
    title: `A six-digit code is sent to ${user.email} at each sign-in.`,
  };
}

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
export function UsersTable({ users = [], onOpen = () => {}, onEdit = () => {}, onMenu = () => {} }) {
  return (
    <div className="table-wrap">
      <table className="users-table">
        {/* The heading row is read out of the markup, so it needs a name of its
            own — and the sentence tells a screen reader the same thing a row's
            tooltip tells an eye. */}
        <caption className="sr-only">          Station accounts: name, badge number, username, email, role, status, second factor and last sign-in. Press Enter on a row to open that account, or Menu / Shift+F10 for its actions.
        </caption>
        <thead>
          <tr>
            <th scope="col">Full name</th>
            <th scope="col" className="num">Badge no.</th>
            <th scope="col">Username</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            {/* Centred with its cells (see th.status in styles.css): a chip hard
                against the left edge read as if it belonged to the column before it. */}
            <th scope="col" className="status">Status</th>
            <th scope="col">Two-factor</th>
            <th scope="col" className="num">Last sign-in</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const cell = twoFactorCell(u);

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
                <td>{u.full_name}</td>
                <td className="num stamp">{u.badge_number}</td>
                <td className="num">{u.username}</td>
                <td>
                  {u.email
                    ? <span className="users-email" title={u.email}>{u.email}</span>
                    : <span className="users-none">Not recorded</span>}
                </td>
                <td>{u.role}</td>
                <td className="status">
                  <span className={`badge ${u.status}`}>{u.status}</span>
                </td>
                <td>
                  <span className={`user-mfa ${cell.cls}`} title={cell.title}>
                    {cell.text}
                  </span>
                </td>
                {/* The stamp the server sent, verbatim — never a client-side
                    "2h ago": a station PC's clock is whatever somebody set it
                    to, which is the same reason the rail is handed ages rather
                    than timestamps (see lib/presence.js). */}
                <td className="num stamp">
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

export default function Users({ notify }) {
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
  // The open row menu: which account, where the pointer was, and the row it came
  // from. The row is what takes focus back when the menu was opened from the
  // keyboard rather than the mouse (see closeRowMenu).
  const [menu, setMenu] = useState(null);

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
  const [profileId, setProfileId] = useState(null);
  const [profileNonce, setProfileNonce] = useState(0);
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

  // THE CORNER IS THE PRESENCE RAIL'S, SO THIS SCREEN ASKS FOR IT RATHER THAN
  // TAKING IT. The create circle is fixed in the bottom-right square (`.users-fab`)
  // and the chathead rail is anchored in that same square, so the rail is lifted by
  // exactly the button's height instead of the two landing on each other with a
  // colleague underneath. That lift is `body.users-fab-open .dash-dock` in
  // styles.css — a body class is the only way a screen can reach a box that Shell
  // renders, and it is the mechanism the docked panels already use to move this same
  // corner sideways (ProfilePanel, AiNarrativePanel).
  //
  // PUBLISHED FOR THE LIFETIME OF THE SCREEN, NOT OF THE BUTTON. Tying it to the
  // form would drop the rail back into the corner every time somebody pressed "+",
  // which is the edge of the window jumping for no reason an administrator can see.
  useEffect(() => {
    document.body.classList.add('users-fab-open');
    return () => document.body.classList.remove('users-fab-open');
  }, []);

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
   * Reset verification is ABSENT for a Staff account rather than disabled: there
   * is no second factor to clear, and a dead item asks the officer to work out
   * why. The destructive item never disappears — a deactivated row's menu has to
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
      ...(u.role === 'Admin' || u.role === 'Officer'
        ? [{ label: 'Reset verification', onSelect: () => askResetMfa(u) }]
        : []),
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
    if (needle === '') return true;
    return `${u.full_name} ${u.username} ${u.badge_number} ${u.email ?? ''}`
      .toLowerCase()
      .includes(needle);
  });
  const filtered = needle !== '' || role !== '';

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
        <div className="ir-page-head">
          <h1 className="ir-title">USER MANAGEMENT</h1>
          <div className="ir-meta">
            <div>LOADING…</div>
            <div>STATION DIRECTORY</div>
          </div>
        </div>
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
  const accountLine = error
    ? 'UNAVAILABLE'
    : users
      ? (filtered ? `${shown.length} OF ${totalLine}` : totalLine)
      : 'LOADING…';

  return (
    // THE PAGE ITSELF CARRIES `.acct-page` WHILE THE FORM OR AN ACCOUNT IS OPEN, which is
    // what centres it. The reason it wraps the TITLE as well as the form is the one
    // `.st-page` gives for Station Settings: a centred card under a page title pinned to
    // the left edge is two alignments on one screen, so the title moves in with the form
    // and the whole thing reads as one page. The directory is deliberately left alone —
    // its table is meant to use the whole window, and centring it would narrow the very
    // thing the screen exists to show.
    <div className={form || profileUser ? 'acct-page' : undefined}>
      {/* Same page grammar as every other screen: document title, a
          right-aligned meta block, then the working surface. */}
      <div className="ir-page-head">
        <h1 className="ir-title">USER MANAGEMENT</h1>
        <div className="ir-meta">
          <div>{accountLine}</div>
          <div>STATION DIRECTORY</div>
        </div>
      </div>

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
                            : 'Optional for Staff, who sign in with a password only. An account can be given a code later by adding the address here.'}
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

          {/* THE SCREEN'S ONE PRIMARY ACTION, HELD OVER THE TABLE. It was a labelled
              button on a line of its own, which spent a whole row of the page on one
              word and put "create an account" above "read the accounts" — and the
              corner is where an operator already looks for "add".

              THE LABEL IS NOT VISIBLE AND IS NOT GONE. A plus is a shape every
              officer reads and a screen reader cannot, so what it does travels in
              `aria-label`, and the same two words are in `title` for the pointer that
              has never met a floating button. Stroked SVG rather than a "+" glyph for
              the reason ThemeIcons.jsx gives: a glyph is the font's to draw, and it
              lands off-centre in a circle at the first station with a different
              default font. The stroke is a little heavier than the chrome icons —
              this is the heaviest control on the screen — and the drawing itself is
              in styles.css's `.users-fab` contract. */}
          <button
            type="button"
            className="users-fab"
            onClick={startCreate}
            aria-label="Create account"
            title="Create account"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5.5v13M5.5 12h13" />
            </svg>
          </button>

          <form className="reports-toolbar" role="search" onSubmit={(e) => e.preventDefault()}>
            <div className="reports-toolbar-row">
              {/* The box IS the filter: there is nothing to submit and nothing to
                  wait for, so there is no Search button beside it. Escape clears
                  it, which is the one key a search field is expected to answer. */}
              <div className="reports-search">
                <input
                  type="search"
                  placeholder="Search name, username, badge no. or email…"
                  aria-label="Search accounts by name, username, badge number or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setSearch('');
                  }}
                />
              </div>
              <select
                aria-label="Filter by role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              {filtered && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setRole('');
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </form>

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
              <strong>No accounts match these filters.</strong> Clear them to see the whole directory.
            </div>
          ) : (
            <UsersTable users={shown} onOpen={openProfile} onEdit={startEdit} onMenu={openRowMenu} />
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
