// BlueWrite — the Profile panel (Profile ▸ the identity row in the top bar).
//
// WHAT THIS IS, and the reason it is not just a bigger menu: the top bar's
// profile menu is a list of ACTIONS (shortcuts, about, log out) with a name at
// the top of it. This is the surface that answers "who am I in this system, and
// what is mine to change" — so it is identity, then what the account has
// recorded, then the display preferences that used to live folded up inside
// that menu.
//
// The split that organises the whole panel, and the one worth stating plainly:
// ALMOST NOTHING HERE IS THE OFFICER'S TO CHANGE. Badge number, role, station,
// account status and the sign-in dates are issued by the department, and the
// panel shows them precisely BECAUSE they cannot be edited — an officer who can
// read their own record stops asking an admin what it says. Only the
// Preferences block at the bottom is editable, and it is deliberately the last
// thing on the panel: you come here to find out who you are, not to fiddle.
//
// Where the preferences went: they were a disclosure inside the top bar's menu.
// That menu is for actions you take once and leave, and a settings fold in it
// made the menu as tall as the screen it dropped over. They live here now, and
// the menu keeps only things that DO something and then get out of the way.
//
// The rules that can be wrong without looking wrong (the date rule, the count
// rule, the role note) are in lib/profile.js with tests; this file is layout,
// the fetch, and the docking.

import React, { useEffect, useRef, useState } from 'react';
import { api, apiUpload, isUnreachable } from '../lib/api.js';
// The avatar: the shared face component, and the browser-side rules that turn a
// 5 MB photograph into a 60 KB square before it is sent (see lib/avatar.js for why
// that is the client's job and not the server's).
import Avatar from './Avatar.jsx';
// The camera: a live photograph instead of one found on the disk. The same dialog
// the account form uses — see CameraCapture for why a webcam is a component and
// not markup in two screens.
import CameraCapture from './CameraCapture.jsx';
import { checkAvatarFile, prepareAvatar } from '../lib/avatar.js';
import { THEME_HINTS, useResolvedTheme, useThemeSpread } from '../lib/theme.js';
import { DENSITY_HINTS } from '../lib/density.js';
import {
  FORM_FORMAT_HINTS,
  FORM_FORMAT_LABELS,
  FORM_FORMATS,
} from '../lib/formFormat.js';
import { IDLE_LIMIT_MIN } from '../lib/session.js';
import {
  activityRows,
  activityScope,
  activitySummary,
  dbDateLabel,
  DEFAULT_OPEN_SECTIONS,
  identitySummary,
  preferencesSummary,
  securitySummary,
  standingOf,
} from '../lib/profile.js';
// The password rule, mirrored from the server so the officer is told what is
// wrong before the round trip — the server is authoritative and refuses what it
// refuses regardless. tests/rules/passwordPolicy.test.mjs holds the two together.
import {
  checkPassword,
  confirmError,
  MIN_LENGTH,
  passwordHint,
} from '../lib/passwordPolicy.js';
import { MoonIcon, SunIcon } from './ThemeIcons.jsx';

/**
 * The activity counts, read from the register's own list endpoint.
 *
 * Three requests, each asking for ONE row it will throw away: what we want is
 * `pagination.total`, the server's count of everything the caller may see under
 * that filter — which is why `per_page=1` is not a trick but the point (the
 * rows themselves are ~1.5kb each here, and 100 of them would be the whole
 * Home payload again).
 *
 * The three filters are the three numbers, and they are the SERVER's
 * definitions rather than ours: `status=attention` is `status != 'finalized'`,
 * `status=finalized` is the settled set, and no filter is everything. It also
 * means the counts are scoped correctly for free — the list narrows to
 * `created_by = me` for every role except Admin, whose profile therefore counts
 * the station. That is what lib/profile.js's `activityScope` is labelling.
 *
 * A failure is NOT an error state. The numbers are a courtesy on a panel whose
 * real job is identity, so they degrade to dashes with one quiet line saying so
 * rather than blanking the panel or throwing a banner over the app.
 */
function useActivityCounts(onConnError) {
  // undefined = still reading · null = could not be read · object = the counts
  const [counts, setCounts] = useState(undefined);

  useEffect(() => {
    let alive = true;
    const total = (d) => {
      const n = d && d.pagination ? d.pagination.total : null;
      return Number.isFinite(n) ? n : null;
    };
    Promise.all([
      api('/reports?per_page=1&status=attention'),
      api('/reports?per_page=1&status=finalized'),
      api('/reports?per_page=1'),
    ])
      .then(([open, done, all]) => {
        if (!alive) return;
        setCounts({
          unfinished: total(open),
          finalized: total(done),
          total: total(all),
        });
      })
      .catch((err) => {
        if (!alive) return;
        setCounts(null);
        // Only a genuinely unreachable server deserves the shared banner; the
        // panel's own dashes already say the counts did not arrive.
        if (isUnreachable(err)) onConnError?.(err);
      });
    return () => {
      alive = false;
    };
  }, [onConnError]);

  return counts;
}

/**
 * One collapsible block.
 *
 * The disclosure is a real button inside the heading, which is the standard
 * accordion shape: a heading that is also the control, with `aria-expanded` and
 * `aria-controls` tying it to the region it opens. No `role="button"` on a div,
 * no click handler on the heading itself — either would announce as text and be
 * unreachable from a keyboard.
 *
 * THE HEADER CARRIES THE VALUES, which is the part that makes folding acceptable.
 * A folded section states what it holds (see lib/profile.js), so collapsing the
 * panel never withholds the answer — it hides only the controls. A section with
 * nothing to say passes `summary={null}` and its header ends at the title rather
 * than at a dangling separator.
 *
 * THE FOLD IS THREE ELEMENTS ON PURPOSE, and the reason is the classic bug: a
 * grid track of `0fr` clips its item, but padding on the ITEM still draws a strip
 * of its own height, so a section would stay visibly open by a few pixels. The
 * spacing therefore lives on `.profile-block-content`, INSIDE the clipper, where
 * it is cut off along with everything else. `.profile-block-inner` is the clipper
 * and `.profile-block-body` is the animating track; neither carries padding.
 */
function PanelSection({ id, title, summary, open, onToggle, children }) {
  return (
    <section className="profile-block" aria-labelledby={`${id}-title`}>
      <h3 className="profile-block-heading">
        <button
          type="button"
          className="profile-block-toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <span className="profile-block-title" id={`${id}-title`}>{title}</span>
          {summary && <span className="profile-block-summary">{summary}</span>}
          <svg
            className="profile-block-chevron"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      <div className="profile-block-body" id={`${id}-body`} data-open={open}>
        <div className="profile-block-inner">
          <div className="profile-block-content">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default function ProfilePanel({
  user,
  // The station's letterhead, read once by Shell for the whole workspace. Its
  // `station_name` is the only place the deployment's station is named, and the
  // identity block needs it to answer "where do I work".
  stationName,
  formFormat,
  onFormFormat,
  theme,
  onTheme,
  density,
  onDensity,
  onClose,
  onConnError,
  // Called after a successful password change. The endpoint has ALREADY
  // destroyed the session by the time this runs (see
  // AuthController::changePassword), so there is nothing to confirm and nothing
  // to sign out of — this tells the workspace to save what is open and hand the
  // officer back to the gate. Shell owns that sequence.
  onPasswordChanged,
  // A field of the session's own account changed and App's copy must follow — the
  // profile photo today. Passed up rather than kept here because the top bar draws
  // the same face, and two copies of it would disagree the moment one changed.
  onUserPatch,
}) {
  const counts = useActivityCounts(onConnError);
  const rows = activityRows(counts);
  const scope = activityScope(user.role);
  const standing = standingOf(user.status);

  // Which sections are unfolded. Seeded from lib/profile.js, where the choice is
  // written down and tested (record open, settings folded), and kept in COMPONENT
  // state rather than storage: the panel is opened, read and closed, and always
  // presenting the same thing is worth more than remembering that somebody once
  // folded the block they are now looking for. Persisting it would be a key and a
  // validator; say the word and it is three lines.
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN_SECTIONS);

  // ---- The profile photo ----------------------------------------------------
  //
  // The file never leaves this function untouched: it is decoded, centre-cropped and
  // re-encoded by lib/avatar.js before it is sent, because PHP on this deployment
  // accepts 2 MB and a photograph off a phone is larger than that. `busy` covers the
  // whole sequence (decode, encode, upload) — the parts the officer can see are
  // quick, and the decode is the slow one on a big image.
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  /**
   * One photograph job: decode, re-encode and upload, with the busy state and the
   * outcome line shared by both entry points.
   *
   * ONE PATH FOR BOTH SOURCES — the file picker and the camera — because everything
   * after "we have the bytes" is identical, and the thing that would drift if it
   * were written twice is the failure handling: a rejected upload has to reach the
   * officer the same way whichever button they pressed.
   */
  const runPhotoJob = async (job) => {
    setPhotoBusy(true);
    setPhotoNote(null);
    try {
      await job();
    } catch (err) {
      if (isUnreachable(err)) onConnError?.(err);
      setPhotoNote({ kind: 'error', text: err.message || 'That photo could not be saved.' });
    } finally {
      setPhotoBusy(false);
    }
  };

  /** The upload itself. Throws, so the caller's busy state and note cover it too. */
  const sendPhoto = async (blob) => {
    const form = new FormData();
    form.append('photo', blob, 'avatar.jpg');
    const saved = await apiUpload('/me/photo', form);
    // The URL comes back with its cache key (?v=…), and it is the SERVER's — the
    // same string /me and the roster will hand out, so the face that appears here
    // is the one colleagues are about to see rather than a locally invented one.
    onUserPatch?.({ photo_url: saved.photo_url });
    setPhotoNote({ kind: 'ok', text: 'Photo saved.' });
  };

  const choosePhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    // Cleared before anything else so choosing the SAME file again re-fires this
    // handler: otherwise "Replace photo" would do nothing the second time, which
    // reads as a broken button.
    e.target.value = '';
    if (!file) return;

    const rejected = checkAvatarFile(file);
    if (rejected) {
      setPhotoNote({ kind: 'error', text: rejected });
      return;
    }

    runPhotoJob(async () => {
      await sendPhoto(await prepareAvatar(file));
    });
  };

  /** A frame from the camera — re-encoded here exactly like a chosen file. */
  const takePhoto = (blob) => {
    setCameraOpen(false);
    runPhotoJob(async () => {
      await sendPhoto(await prepareAvatar(blob));
    });
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    setPhotoNote(null);
    try {
      await api('/me/photo', { method: 'DELETE' });
      onUserPatch?.({ photo_url: null });
      setPhotoNote({ kind: 'ok', text: 'Photo removed. Your initials are shown instead.' });
    } catch (err) {
      if (isUnreachable(err)) onConnError?.(err);
      setPhotoNote({ kind: 'error', text: err.message || 'That photo could not be removed.' });
    } finally {
      setPhotoBusy(false);
    }
  };

  // Same appearance control as the sign-in gate and the top bar's menu, and the
  // same resolution rule: 'system' has no icon of its own, so it draws whichever
  // of the two is in force.
  const mode = useResolvedTheme(theme);
  const [themeRef, commitTheme] = useThemeSpread(onTheme);

  const panelRef = useRef(null);
  const closeRef = useRef(null);

  // ---- The change-password form --------------------------------------------
  //
  // COLLAPSED UNTIL ASKED FOR, and that is not decoration: three password fields
  // sitting open on a panel whose other job is being read would make the panel
  // look like a form when it is a record, and the two eye-shaped fields would
  // invite a shoulder behind the officer. The row states that the action exists;
  // pressing it produces the fields.
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  // { field, message } — the field the message belongs under, so the error lands
  // on the input that caused it rather than in a general banner.
  const [pwError, setPwError] = useState(null);

  // ---- The second factor ---------------------------------------------------
  //
  // Read from the account's own state, which arrives with /me (and with the
  // sign-in response, in `user.mfa`). It is shown, never changed from here: the
  // factor is a code emailed to the address an Admin recorded, so there is
  // nothing on this panel an officer can edit about it — the address is an
  // administrative fact, and the only way past a lost mailbox is an Admin
  // resetting the account (see Users ▸ Reset verification).
  const mfaState = user.mfa ?? null;

  function resetPasswordForm() {
    setPwCurrent('');
    setPwNext('');
    setPwConfirm('');
    setPwError(null);
  }

  /**
   * Fold or unfold a section.
   *
   * Folding SECURITY also shuts its password form and clears it, for the same
   * reason the form's own Cancel does: three fields holding half of a credential
   * are the one piece of state on this panel that should not survive being put
   * away. The fields would otherwise stay mounted — the fold hides with
   * `visibility`, it does not unmount — so they have to be emptied explicitly.
   */
  function toggleSection(id) {
    const next = !openSections[id];
    // The clearing happens HERE rather than inside the state updater: an updater
    // must be pure (React may call it more than once), and calling two other
    // setters from inside one is how a double-invoked updater becomes a bug that
    // only shows up in development.
    if (id === 'security' && !next) {
      setPwOpen(false);
      resetPasswordForm();
    }
    setOpenSections({ ...openSections, [id]: next });
  }

  /**
   * The pre-flight check, in the SERVER's order.
   *
   * Order matters and is not arbitrary: the current password first (nothing else
   * about the request is worth discussing with someone who has not shown they
   * are the account holder), then the confirmation, then the policy. The
   * confirmation comes before the policy because until the two new fields agree
   * there is no single candidate password to judge — running the policy against
   * a value the officer may not have meant and reporting "too short" about a
   * string that was going to be discarded is worse than saying nothing.
   * AuthController::changePassword runs the same three in the same order, so the
   * two sides can never disagree about WHICH problem to report.
   */
  async function submitPassword(e) {
    e.preventDefault();
    if (pwCurrent === '') {
      setPwError({ field: 'current_password', message: 'Enter your current password.' });
      return;
    }
    const mismatch = confirmError(pwNext, pwConfirm);
    if (mismatch !== null) {
      setPwError({ field: 'confirm_password', message: mismatch });
      return;
    }
    const policy = checkPassword(pwNext, {
      username: user.username,
      badge: user.badge_number,
      // The current password rides along so reusing it is refused here too —
      // otherwise the form would accept a "change" that changed nothing.
      current: pwCurrent,
    });
    if (policy !== null) {
      setPwError({ field: 'new_password', message: policy });
      return;
    }

    setPwBusy(true);
    setPwError(null);
    try {
      await api('/me/password', {
        method: 'POST',
        body: {
          current_password: pwCurrent,
          new_password: pwNext,
          confirm_password: pwConfirm,
        },
      });
      // Deliberately NOT clearing `busy` or the fields: the session is already
      // gone, so this component is on its way out, and re-enabling the button
      // would invite a second submission against a dead session.
      onPasswordChanged();
    } catch (err) {
      setPwBusy(false);
      // A wrong current password arrives as a 422 naming the field; a network
      // failure arrives as neither, and belongs in the app's shared banner
      // rather than under a field it has nothing to do with.
      if (isUnreachable(err)) onConnError?.(err);
      setPwError({ field: err.field ?? null, message: err.message });
    }
  }

  // Docked-panel layout, the same contract the AI panel uses: publish the open
  // state on `body` so the workspace's own stylesheet can reserve the width via
  // `.main` margin-right. The panel is mounted only while it is open, so an
  // effect on mount is the whole story — no separate open/closed toggle to drift
  // out of step with what is on screen (the bug that once left the report form
  // squeezed next to an empty gap).
  //
  // The WIDTH is not published here: it is one declaration under
  // `body.profile-panel-open` in styles.css, because the panel's own box and the
  // gap .main reserves have to be the same number and two places setting it is
  // how they start disagreeing.
  useEffect(() => {
    document.body.classList.add('profile-panel-open');
    return () => {
      document.body.classList.remove('profile-panel-open');
    };
  }, []);

  // Escape closes, and a press outside closes. This is a docked panel rather
  // than a modal — the workspace beside it stays live and usable — so there is
  // no scrim and no focus trap; the two ways out are the keyboard and a click
  // anywhere else, which is the same pair the menu above it offers.
  //
  // The trigger is excluded because the click that OPENS a thing must not also
  // close it: without this, pressing the menu's identity row would open the
  // panel and then, in the same event, see a target outside the panel and shut
  // it again.
  useEffect(() => {
    const onDown = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.ir-profile-wrap')) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Focus lands on the way out, so a keyboard user is inside the panel the
  // moment it opens and can leave with one key. Not restored on close: the
  // panel is opened from a menu that has already closed, so there is no longer
  // a trigger to hand focus back to.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const memberSince = dbDateLabel(user.created_at);
  const lastSeen = dbDateLabel(user.last_login_at);

  return (
    <aside
      className="profile-side-panel"
      ref={panelRef}
      aria-label="Your profile"
    >
      <header className="profile-panel-head">
        <h2>Your profile</h2>
        <button
          type="button"
          className="profile-panel-close"
          ref={closeRef}
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close your profile"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="profile-panel-body">
        {/* ---- Identity ------------------------------------------------------
            What the DEPARTMENT records. Every line here is issued, not chosen,
            which is why there is no edit affordance anywhere in the block — the
            absence is the answer, not an oversight. */}
        <PanelSection
          id="identity"
          title="Identity"
          summary={identitySummary(user)}
          open={openSections.identity}
          onToggle={() => toggleSection('identity')}
        >
          <div className="profile-identity">
            {/* The face as the RECORD has it — the photograph when the officer has
                set one, initials when they have not. It is shown here but changed
                in Preferences, because this block is what the department issued
                and that is the answer to "why is there no edit control here". */}
            <Avatar user={user} className="profile-panel-avatar" />
            <div className="profile-identity-text">
              <p className="profile-identity-name">{user.full_name}</p>
              <p className="profile-identity-meta">
                Badge {user.badge_number} · {user.role}
              </p>
              {stationName && <p className="profile-identity-station">{stationName}</p>}
            </div>
            {standing && (
              <span className={`profile-chip profile-chip--${standing.code}`} title={standing.note}>
                {standing.label}
              </span>
            )}
          </div>

          <dl className="profile-facts">
            <div className="profile-fact">
              <dt>Member since</dt>
              <dd>{memberSince || '—'}</dd>
            </div>
            <div className="profile-fact">
              <dt>Last signed in</dt>
              {/* An account that has never signed in is a real state — an admin
                  creates the record before the officer first uses it — so it
                  says so rather than showing an empty value. */}
              <dd>{lastSeen || 'Never'}</dd>
            </div>
          </dl>
          {/* The idle rule used to sit in this list. It is a SESSION fact rather
              than an account one, and it now lives in Security beside the
              password it is the companion of — "how long am I trusted for" is
              one question, not two. */}
        </PanelSection>

        {/* ---- Activity ------------------------------------------------------
            The counts are the register's, so the block is TITLED by what they
            actually counted (lib/profile.js): an admin's list is the station's,
            everyone else's is their own. */}
        <PanelSection
          id="activity"
          title={scope.title}
          summary={activitySummary(counts)}
          open={openSections.activity}
          onToggle={() => toggleSection('activity')}
        >
          <p className="profile-block-note">{scope.note}</p>
          <ul className="profile-counts">
            {rows.map((row) => (
              <li key={row.key} className="profile-count">
                <span className="profile-count-num" data-pending={counts === undefined ? 'true' : undefined}>
                  {row.display}
                </span>
                <span className="profile-count-label">
                  {row.label}
                  <span className="profile-count-hint">{row.hint}</span>
                </span>
              </li>
            ))}
          </ul>
          {counts === null && (
            <p className="profile-block-note profile-block-note--warn">
              Couldn’t read the counts just now. Everything else here is still right.
            </p>
          )}
        </PanelSection>

        {/* ---- Preferences ---------------------------------------------------
            Moved here from the top bar's menu, markup and behaviour unchanged:
            the same segmented form format, the same sun/moon appearance switch,
            the same spacing switch. A preference that is set in two places is a
            preference with two answers, so this block is now the only home. */}
        <PanelSection
          id="preferences"
          title="Preferences"
          summary={preferencesSummary({ formFormat, mode, density })}
          open={openSections.preferences}
          onToggle={() => toggleSection('preferences')}
        >
          {/* THE AVATAR IS THE ONE THING IN THIS BLOCK THAT IS NOT LOCAL, so it is
              stated separately and first. Everything below it is a device
              preference (the block says so); a photograph silently written to the
              station's server, filed under a heading that promises the opposite,
              is exactly the kind of surprise this panel is careful about. */}
          <div className="profile-photo">
            <Avatar user={user} className="profile-photo__face" />
            <div className="profile-photo__text">
              <span className="ir-pref-name">Profile photo</span>
              <span className="ir-pref-hint">
                Saved on your account, and shown to colleagues on the presence rail.
              </span>
              <div className="profile-photo__actions">
                {/* A LABEL WRAPPING THE INPUT, not a button beside it: the file
                    picker is a browser dialog, and a styled button would have to
                    forward the click anyway. The input is visually hidden and
                    still the thing focus lands on — the text is its label. */}
                <label className={`profile-photo__pick${photoBusy ? ' is-busy' : ''}`}>
                  {photoBusy ? 'Saving…' : user.photo_url ? 'Replace photo' : 'Add a photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={choosePhoto}
                    disabled={photoBusy}
                  />
                </label>
                {/* The camera is offered BESIDE the picker rather than instead of it:
                    the front desk has a webcam and no photographs on disk, the
                    offices have photographs and no webcam, and neither should have
                    to work out where the other one went. */}
                <button
                  type="button"
                  className="profile-photo__camera"
                  onClick={() => setCameraOpen(true)}
                  disabled={photoBusy}
                >
                  Take a photo
                </button>
                {user.photo_url && (
                  <button
                    type="button"
                    className="profile-photo__remove"
                    onClick={removePhoto}
                    disabled={photoBusy}
                  >
                    Remove
                  </button>
                )}
              </div>
              {/* One line, and it appears only when there is something to say —
                  a permanent "no error" line would be a row of the panel spent
                  on nothing. Polite rather than assertive because the failure of
                  a photograph must not interrupt the field somebody is typing in. */}
              {photoNote && (
                <p className={`profile-photo__note is-${photoNote.kind}`} role="status">
                  {photoNote.text}
                </p>
              )}
            </div>
          </div>

          <p className="profile-block-note">Saved on this device.</p>

          <div className="ir-pref-row ir-pref-row--stack">
            <span className="ir-pref-text">
              <span className="ir-pref-name" id="panel-pref-form-format">Form format</span>
              <span className="ir-pref-hint" id="panel-pref-form-format-hint">
                {FORM_FORMAT_HINTS[formFormat]}
              </span>
            </span>
            {/* A segmented group rather than a switch: the answer is no longer
                binary (see formFormat.js), and there is no "off" that could mean
                both Sheet and Steps. */}
            <div
              className="ir-pref-seg"
              role="radiogroup"
              aria-labelledby="panel-pref-form-format"
              aria-describedby="panel-pref-form-format-hint"
            >
              {FORM_FORMATS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={formFormat === value}
                  className={`ir-pref-seg-btn${formFormat === value ? ' on' : ''}`}
                  onClick={() => onFormFormat(value)}
                  title={FORM_FORMAT_HINTS[value]}
                >
                  {FORM_FORMAT_LABELS[value]}
                </button>
              ))}
            </div>
          </div>

          <div className="ir-pref-row">
            <span className="ir-pref-text">
              <span className="ir-pref-name" id="panel-pref-theme">Appearance</span>
              <span className="ir-pref-hint" id="panel-pref-theme-hint">
                {THEME_HINTS[mode]}
              </span>
            </span>
            <button
              ref={themeRef}
              type="button"
              role="switch"
              className="ir-theme-toggle theme-control"
              aria-checked={mode === 'dark'}
              aria-labelledby="panel-pref-theme"
              aria-describedby="panel-pref-theme-hint"
              onClick={() => commitTheme(mode === 'dark' ? 'light' : 'dark')}
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="theme-icons">
                <SunIcon />
                <MoonIcon />
              </span>
            </button>
          </div>

          <div className="ir-pref-row">
            <span className="ir-pref-text">
              <span className="ir-pref-name" id="panel-pref-density">Spacing</span>
              <span className="ir-pref-hint" id="panel-pref-density-hint">
                {DENSITY_HINTS[density]}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              className="ir-switch"
              aria-checked={density === 'compact'}
              aria-labelledby="panel-pref-density"
              aria-describedby="panel-pref-density-hint"
              onClick={() => onDensity(density === 'compact' ? 'comfortable' : 'compact')}
              title={
                density === 'compact'
                  ? 'Give the rows and field gaps more room'
                  : 'Tighten the rows so more fits on screen'
              }
            >
              <span className="ir-switch-knob" aria-hidden="true" />
            </button>
          </div>
        </PanelSection>

        {/* ---- Security ------------------------------------------------------
            LAST in the panel, and that placement is the design: this is the only
            thing here that ENDS THE SESSION, so it sits where a scroll has to
            happen first and cannot be hit on the way past. Same grammar the
            profile menu uses for Log out.

            The account's credential is the ONE editable thing on this panel
            that the officer owns outright. Everything above it is issued by the
            department; this is theirs, and until now they could not change it —
            every password was set by an Admin, so an officer who thought theirs
            was known had to ask someone else to fix it. */}
        <PanelSection
          id="security"
          title="Security"
          summary={securitySummary(IDLE_LIMIT_MIN, mfaState)}
          open={openSections.security}
          onToggle={() => toggleSection('security')}
        >
          {/* ---- The factor that arrives by mail, above the one you know ---
              Order follows the sign-in itself: the password first, then the code
              from the email. READ-ONLY, and deliberately so: the factor rests on
              the address an Admin recorded for the account, which is an
              administrative fact rather than something an officer changes here,
              and there are no recovery codes any more to replace. A row that
              offered a button would be offering something this app does not
              have. */}
          {mfaState?.required && (
            <div className="ir-pref-row">
              <span className="ir-pref-text">
                <span className="ir-pref-name">Two-step verification</span>
                <span className="ir-pref-hint">
                  {mfaState.has_email
                    ? `Codes are sent to ${mfaState.email_hint}`
                    : 'No email address on file — ask an administrator to add one.'}
                  {mfaState.locked_until ? ' · temporarily locked after incorrect codes' : ''}
                </span>
              </span>
            </div>
          )}

          <div className="ir-pref-row">
            <span className="ir-pref-text">
              <span className="ir-pref-name">Password</span>
              <span className="ir-pref-hint">
                You'll sign in again with it straight away.
              </span>
            </span>
            <button
              type="button"
              className="profile-inline-btn"
              aria-expanded={pwOpen}
              aria-controls="profile-password-form"
              onClick={() => {
                // Closing always clears: a half-typed password left sitting in
                // the fields behind a closed form is the one bit of state on
                // this panel worth not keeping.
                setPwOpen((v) => !v);
                resetPasswordForm();
              }}
            >
              {pwOpen ? 'Cancel' : 'Change'}
            </button>
          </div>

          {pwOpen && (
            <form
              id="profile-password-form"
              className="profile-password-form"
              onSubmit={submitPassword}
              noValidate
            >
              <div className="profile-pw-field">
                <label htmlFor="pw-current">Current password</label>
                <input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  aria-invalid={pwError?.field === 'current_password' ? 'true' : undefined}
                  aria-describedby={
                    pwError?.field === 'current_password' ? 'pw-current-error' : undefined
                  }
                />
                {pwError?.field === 'current_password' && (
                  <p className="profile-pw-error" id="pw-current-error" role="alert">
                    {pwError.message}
                  </p>
                )}
              </div>

              <div className="profile-pw-field">
                <label htmlFor="pw-new">New password</label>
                <input
                  id="pw-new"
                  type="password"
                  autoComplete="new-password"
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                  minLength={MIN_LENGTH}
                  aria-invalid={pwError?.field === 'new_password' ? 'true' : undefined}
                  // The rule is always described; the refusal joins it when there
                  // is one. A field that stops describing its own error once it
                  // has one is the common way an inline message is visible and
                  // still unannounced.
                  aria-describedby={
                    pwError?.field === 'new_password'
                      ? 'pw-new-hint pw-new-error'
                      : 'pw-new-hint'
                  }
                />
                {/* The HINT states the rule, and it is built from the same
                    constant the rule uses, so the sentence cannot be left behind
                    by a change to the number. */}
                <p className="profile-pw-hint" id="pw-new-hint">
                  {passwordHint()} Not your username or badge number.
                </p>
                {pwError?.field === 'new_password' && (
                  <p className="profile-pw-error" id="pw-new-error" role="alert">
                    {pwError.message}
                  </p>
                )}
              </div>

              <div className="profile-pw-field">
                <label htmlFor="pw-confirm">Confirm new password</label>
                <input
                  id="pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  aria-invalid={pwError?.field === 'confirm_password' ? 'true' : undefined}
                  aria-describedby={
                    pwError?.field === 'confirm_password' ? 'pw-confirm-error' : undefined
                  }
                />
                {pwError?.field === 'confirm_password' && (
                  <p className="profile-pw-error" id="pw-confirm-error" role="alert">
                    {pwError.message}
                  </p>
                )}
              </div>

              <button type="submit" className="primary profile-pw-submit" disabled={pwBusy}>
                {pwBusy ? 'Changing…' : 'Change password'}
              </button>

              {/* Anything the server refused WITHOUT naming a field (a 500, a
                  dead connection) has nowhere else to land — a named field would
                  be a guess about which input was wrong. */}
              {pwError && !pwError.field && (
                <p className="profile-pw-error" role="alert">{pwError.message}</p>
              )}

              {/* Stated plainly rather than left to be discovered. The change
                  ends THIS session (see AuthController::changePassword), but
                  other machines are PHP sessions with no register to revoke
                  from, so they keep working until their idle timeout runs out.
                  An officer who thinks a password was known needs to know that,
                  because "sign out everywhere" is not a button this app has. */}
              <p className="profile-pw-note">
                This signs you out here. On any other machine you're signed in on, the
                session ends when it next goes idle.
              </p>
            </form>
          )}

          <dl className="profile-facts profile-facts--ruled">
            <div className="profile-fact">
              <dt>Signs out after</dt>
              <dd>{IDLE_LIMIT_MIN} min idle</dd>
            </div>
          </dl>
        </PanelSection>
      </div>

      {/* MOUNTED ONLY WHILE IT IS OPEN, which is what stops the stream: a camera left
          mounted would keep its light on behind the panel. See CameraCapture. */}
      {cameraOpen && (
        <CameraCapture
          title="Your profile photo"
          onCapture={takePhoto}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </aside>
  );
}
