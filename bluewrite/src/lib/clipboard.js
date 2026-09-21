// BlueWrite — copying to the clipboard, with a fallback that works on a LAN.
//
// WHY THIS IS NOT JUST `navigator.clipboard.writeText`. The clipboard API is
// only available in a SECURE CONTEXT: HTTPS, or localhost. This application is
// served over plain HTTP from a station's LAN address (`http://192.168.1.10` —
// see config/config.sample.php), which is exactly the case where
// `navigator.clipboard` is undefined. A copy button that silently did nothing
// there would be worse than no button: the officer would paste, get the old
// contents of their clipboard, and have no idea why.
//
// So: try the modern API, fall back to the old selection-and-execCommand path
// (deprecated, but present in every browser this app runs in, and it is the only
// thing that works without a secure context), and REPORT whether it worked. The
// caller is expected to say something when it did not — see the copy button in
// the sign-in gate, which tells the officer to select the key and press Ctrl+C
// rather than pretending.
//
// The one thing it does not do is ask for permission: on an insecure origin
// there is nothing to ask, and a permission prompt for a setup key the officer
// is looking at would be noise on a screen they are already reading.

/**
 * Copy `text` to the clipboard.
 *
 * @returns {Promise<boolean>} whether the text is on the clipboard now
 */
export async function copyToClipboard(text) {
  const value = String(text ?? '');
  if (value === '') return false;

  // The modern path. `navigator.clipboard` can exist and still reject (the
  // document is not focused, permission is denied), so the rejection is caught
  // and the fallback is tried rather than reported as a failure.
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  return legacyCopy(value);
}

/**
 * The pre-secure-context path: put the text in a textarea off-screen, select it,
 * and ask the document to copy the selection.
 *
 * The textarea is `readonly` so focusing it cannot open a keyboard on a phone,
 * and it is removed in a `finally` so a thrown error cannot leave it in the
 * document. Position `fixed` with a negative offset rather than `display: none`:
 * a hidden element cannot be selected, and a `visibility: hidden` one cannot be
 * either — the element has to be on the page to have a selection.
 */
function legacyCopy(value) {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, value.length);
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
