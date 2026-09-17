import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const EMPTY_FORM = {
  full_name: '',
  badge_number: '',
  username: '',
  role: 'Staff',
  password: '',
};

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

  async function runResetPassword(e) {
    e.preventDefault();
    if (resetPassword.length < 10) {
      setResetError('Password must be at least 10 characters.');
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

  function startEdit(u) {
    setEditingId(u.id);
    setForm({
      full_name: u.full_name,
      badge_number: u.badge_number,
      username: u.username,
      role: u.role,
      password: '',
    });
  }

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  }

  async function saveForm(e) {
    e.preventDefault();
    setError(null);
    const body = { ...form };
    if (editingId && !body.password) delete body.password;
    try {
      if (editingId) {
        await api(`/users/${editingId}`, { method: 'PATCH', body });
        notify('Account updated.');
      } else {
        await api('/users', { method: 'POST', body });
        notify('Account created.');
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (users === null && !error) return <p>Loading users…</p>;

  return (
    <>
      {/* Same page grammar as every other screen: serif document title, a
          right-aligned meta block, then the working surface. */}
      <div className="ir-page-head">
        <h1 className="ir-title">USER MANAGEMENT</h1>
        <div className="ir-meta">
          <div>{users ? `${users.length} ACCOUNT${users.length === 1 ? '' : 'S'}` : 'LOADING…'}</div>
          <div>STATION DIRECTORY</div>
        </div>
      </div>

      <div className="ir-status">
        <span className="badge active">Admin</span>
        <span>Administer officer, staff, and administrator accounts.</span>
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {form ? (
        <form onSubmit={saveForm}>
          <h2>{editingId ? `Edit Account — ${form.full_name}` : 'Create Account'}</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="u-fullname">Full name</label>
              <input
                id="u-fullname"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="u-badge">Badge / employee number</label>
              <input
                id="u-badge"
                value={form.badge_number}
                onChange={(e) => setForm({ ...form, badge_number: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="u-username">Username</label>
              <input
                id="u-username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="u-role">Role</label>
              <select
                id="u-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option>Admin</option>
                <option>Officer</option>
                <option>Staff</option>
              </select>
            </div>
            <div className="field span-2">
              <label htmlFor="u-pass">
                Password {editingId && '(leave blank to keep current)'}
              </label>
              <input
                id="u-pass"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editingId}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="submit" className="primary">
              {editingId ? 'Save Changes' : 'Create Account'}
            </button>
            <button type="button" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div style={{ marginBottom: '0.75rem' }}>
            <button className="primary" onClick={startCreate}>
              Create Account
            </button>
          </div>
          {users && users.length === 0 ? (
            <div className="empty">
              <strong>No accounts yet.</strong> Choose “Create Account” to add the first user.
            </div>
          ) : (
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Full name</th>
                  <th>Badge no.</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users &&
                  users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.full_name}</td>
                      <td className="num">{u.badge_number}</td>
                      <td>{u.username}</td>
                      <td>{u.role}</td>
                      <td>
                        <span className={`badge ${u.status}`}>{u.status}</span>
                      </td>
                      <td>{u.last_login_at ? u.last_login_at.replace('T', ' ') : 'Never'}</td>
                      <td>
                        <button onClick={() => startEdit(u)}>Edit</button>{' '}
                        <button onClick={() => askResetPassword(u)}>Reset password</button>{' '}
                        {u.status === 'active' ? (
                          <button className="danger" onClick={() => askDeactivate(u)}>
                            Deactivate Account
                          </button>
                        ) : (
                          <button onClick={() => askReactivate(u)}>Reactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            </div>
          )}
        </>
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
                  minLength={10}
                  required
                  autoFocus
                />
                <p className="field-hint">Minimum 10 characters, same rule as account creation.</p>
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

      {confirm && (
        <div className="dialog-overlay" onClick={() => setConfirm(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{confirm.title}</h2>
            <p>{confirm.message}</p>
            <div className="actions">
              <button onClick={() => setConfirm(null)}>Cancel</button>
              <button className="danger" onClick={runConfirm}>
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
