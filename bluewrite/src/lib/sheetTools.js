// The letter's single toolbox needs one question answered: which of the
// sheet's prose editors holds the caret right now. This module is that answer
// — a tiny registry, not state: a `toolbar="none"` editor registers its box
// and its emit on focus and unregisters on blur, and the one SheetToolBox
// beside the sheet follows it. Plain functions, no component, so the form's
// own top-toolbar editor (which never registers) cannot summon the box.

let active = null; // { el, emit } | null
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn(active);
    } catch {
      // A stale subscriber never breaks the editor it follows.
    }
  });
}

export function getSheetToolTarget() {
  return active;
}

export function subscribeSheetToolTarget(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function registerSheetEditor(el, emit) {
  if (!el) return;
  active = { el, emit };
  notify();
}

export function unregisterSheetEditor(el) {
  if (active && active.el === el) {
    active = null;
    notify();
  }
}

// One command press, wherever the button lives: the editor keeps focus (the
// box uses onMouseDown + preventDefault so no blur ever fires), the browser
// runs the command on the live selection, and the sanitized html leaves.
export function execSheetCommand(command) {
  try {
    document.execCommand(command, false, null);
  } catch {
    // A command the browser does not offer is a no-op, never a crash.
  }
}

export function runSheetCommand(command) {
  const target = active;
  if (!target) return;
  target.el.focus();
  execSheetCommand(command);
  target.emit?.();
}
