// BLUEWRITE — the keyboard shortcut sheet (Profile ▸ Keyboard shortcuts, or ?).
//
// It renders lib/shortcuts.js, which is also what Shell's listener acts on, so
// the sheet cannot drift from the keys: a key that is handled is listed, and
// nothing is listed that nothing answers.
//
// Portalled to the body: it is opened from the top bar, which carries a z-index,
// and a panel inside that layer would be painted under the report screen's
// docked action bar. The row menu and the About panel make the same move.

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MOD_LABEL, shortcutsFor } from '../../lib/shortcuts.js';

/** One key cap. Two-chord keys (Ctrl+S) print as two caps joined by a plus. */
function Keys({ keys, withMod }) {
  return (
    <span className="keys">
      {withMod && (
        <>
          <kbd>{MOD_LABEL}</kbd>
          <span className="keys-plus" aria-hidden="true">
            +
          </span>
        </>
      )}
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  );
}

export default function KeyboardShortcuts({ isAdmin, onClose }) {
  // Escape closes. Shell's listener deliberately ignores every key while a
  // modal is on screen — including this one, which is itself a modal — so the
  // panel answers Escape for itself.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = shortcutsFor(isAdmin);

  return createPortal(
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <p className="shortcuts-lead">
          Letters work anywhere in the workspace except while you are typing in a field.
        </p>

        {groups.map((group) => (
          <section className="shortcuts-group" key={group.title}>
            <h3>{group.title}</h3>
            <dl className="shortcuts-list">
              {group.items.map((item) => (
                <div className="shortcut" key={item.label}>
                  <dt>
                    <Keys keys={item.keys} withMod={item.withMod} />
                  </dt>
                  <dd>
                    <span className="shortcut-label">{item.label}</span>
                    <span className="shortcut-hint">{item.hint}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        <div className="actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
