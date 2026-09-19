// BLUEWRITE — the keyboard, stated once.
//
// This module is the LIST. Shell owns the listener that acts on it, and the
// cheatsheet in Profile ▸ Keyboard shortcuts renders it — so a key cannot be
// handled without being documented, and the sheet cannot promise a key that
// nothing answers.
//
// The set is deliberately small and made of letters an officer can remember
// without a sheet: navigate (h/m/n), search (/), and the two things a form
// needs (save, close). Anything that could be mistaken for a browser key is out
// — no Ctrl+W, no Ctrl+N — and every letter is ignored while the officer is
// typing, which is what makes single letters safe in an app made of text fields.
//
// NOT in the list, on purpose: Esc. Every surface that can be closed already
// answers it on its own (the profile menu, the AI panel, the About panel, the
// row menu), and a global listener would double-handle a key those components
// own. It is documented in the sheet's own copy as part of the furniture.

/** The save chord's name differs by platform, because the key does. */
const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

/** What to print for the modifier on this machine. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

/**
 * The sheet, as data. `admin` rows are shown only to admins — a key that would
 * do nothing on this officer's menu should not be advertised to them.
 */
export const SHORTCUT_GROUPS = [
  {
    title: 'Go to',
    items: [
      { keys: ['H'], label: 'Home', hint: 'The landing page and your recent drafts' },
      { keys: ['M'], label: 'My reports', hint: 'The register, with search and filters' },
      { keys: ['N'], label: 'New report', hint: 'Opens a blank incident form' },
      {
        keys: ['D'],
        label: 'Dashboard',
        hint: 'Admin only — the station’s figures',
        admin: true,
      },
    ],
  },
  {
    title: 'In a report',
    items: [
      {
        keys: ['S'],
        label: 'Save draft',
        hint: 'Saves without validating the report as complete',
        withMod: true,
      },
      { keys: ['/'], label: 'Search reports', hint: 'Jumps to the register’s search box' },
    ],
  },
  {
    title: 'Anywhere',
    items: [
      { keys: ['?'], label: 'This list', hint: 'Opens and closes this panel' },
      { keys: ['Esc'], label: 'Close', hint: 'Closes an open menu, panel or dialog' },
    ],
  },
];

/** The rows this user may be shown. */
export function shortcutsFor(isAdmin) {
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.admin || isAdmin),
  })).filter((group) => group.items.length > 0);
}

/**
 * Is the officer typing? A shortcut that stole a letter out of the narrative
 * field would be a bug report the same afternoon, so every plain-letter key
 * checks this first. `contenteditable` is included because a rich-text surface
 * is a text field that does not announce itself as one.
 */
export function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  // A textbox that is not an input (the pickers in the report form).
  return el.getAttribute && el.getAttribute('role') === 'textbox';
}

/** The letter a navigation key stands for, or null. Modifiers disqualify it. */
export function plainLetter(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (typeof e.key !== 'string' || e.key.length !== 1) return null;
  return e.key.toLowerCase();
}

/** Ctrl+S on Windows/Linux, ⌘S on a Mac. */
export function isSaveChord(e) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's';
}

/**
 * Is a modal on screen? Shortcuts must never fire behind one — `h` while the
 * logout dialog is up would navigate under the officer's answer. Every modal in
 * the app carries role="dialog" + aria-modal, so that is the question to ask.
 */
export function modalOpen() {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}
