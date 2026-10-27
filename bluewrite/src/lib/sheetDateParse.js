// BlueWrite — the sheet's typed-date reader (owner request).
//
// The sheet's date lines are typed text, not pickers ("Around 21/10/2026
// 09:40 pm"), so a commit has to be READ back into the stored shape: a
// 'YYYY-MM-DD' date and an 'HH:MM' 24-hour time. Pure, no DOM — the rule
// tests run it in node without one.
//
// Accepted, in order: ISO ('2026-10-21', '2026-10-21T21:40'), the station's
// own 'DD/MM/YYYY' ('21/10/2026', dashes too), month-name forms
// ('October 21, 2026', '21 October 2026'), each with an optional time
// ('9:40 pm', '21:40', '9:40 P.M.'). A leading "Around" is the template's
// own chrome and is stripped before reading. Anything else — a word, a
// half-date, an impossible day — reads as null, and the caller keeps the
// stored value instead of writing the guess.

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function validDate(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function expandYear(y) {
  if (y.length === 4) return Number(y);
  if (y.length === 2) return 2000 + Number(y);
  return null;
}

/** '9:40 pm' / '21:40' / '9:40 P.M.' → 'HH:MM', or null. */
export function parseSheetTime(text) {
  const m = /(\d{1,2}):(\d{2})\s*([ap])\.?\s?m\.?/i.exec(String(text ?? ''));
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 1 || h > 12 || min > 59) return null;
    const pm = m[3].toLowerCase() === 'p';
    h = h % 12 + (pm ? 12 : 0);
    return `${pad(h)}:${pad(min)}`;
  }
  const t = /(\d{1,2}):(\d{2})/.exec(String(text ?? ''));
  if (t) {
    const h = Number(t[1]);
    const min = Number(t[2]);
    if (h > 23 || min > 59) return null;
    return `${pad(h)}:${pad(min)}`;
  }
  return null;
}

function stripAround(text) {
  return String(text ?? '').replace(/^\s*around\s+/i, '').trim();
}

/**
 * Read a typed sheet date line.
 * @returns {{date: string|null, time: string|null}} date 'YYYY-MM-DD',
 *   time 'HH:MM' — either may be null when the text carries only the other.
 *   Both null means unreadable: keep the stored value.
 */
export function parseSheetDateTime(text) {
  const src = stripAround(text);
  if (src === '') return { date: null, time: null };
  const time = parseSheetTime(src);

  // ISO first: unambiguous, and what a paste from the form looks like. The
  // trailing guard stops a longer digit run ('20261021') reading as ISO.
  let m = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?(?![\w])/.exec(src);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!validDate(y, mo, d)) return { date: null, time: null };
    return {
      date: `${y}-${pad(mo)}-${pad(d)}`,
      time: m[4] !== undefined ? `${m[4]}:${m[5]}` : time,
    };
  }

  // The station's own numeric form: 21/10/2026 (dashes too), optional time.
  // The trailing guard rejects a half-typed year ('21/10/26x').
  m = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?![\w])/.exec(src);
  if (m) {
    const y = expandYear(m[3]);
    if (y === null) return { date: null, time: null };
    let d = Number(m[1]);
    let mo = Number(m[2]);
    // Disambiguate the two orders: the part over 12 is the day. Both under
    // 12 reads day-first — the Philippine convention on this sheet.
    if (d > 12 && mo <= 12) {
      // already day-first
    } else if (mo > 12 && d <= 12) {
      [d, mo] = [mo, d];
    }
    if (!validDate(y, mo, d)) return { date: null, time: null };
    return { date: `${y}-${pad(mo)}-${pad(d)}`, time };
  }

  // Month-name forms: 'October 21, 2026', '21 October 2026'.
  m = /([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/i.exec(src)
    || /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{2,4})/i.exec(src);
  if (m) {
    const namedFirst = /^[a-z]/i.test(m[1]);
    const monthName = (namedFirst ? m[1] : m[2]).toLowerCase();
    const mo = MONTHS[monthName];
    const d = Number(namedFirst ? m[2] : m[1]);
    const y = expandYear(m[3]);
    if (!mo || y === null || !validDate(y, mo, d)) return { date: null, time: null };
    return { date: `${y}-${pad(mo)}-${pad(d)}`, time };
  }

  // A bare time with no date ("9:40 pm") still carries half the datum.
  if (time) return { date: null, time };
  return { date: null, time: null };
}

/** The date half of a typed line, or null when it carries none. */
export function parseSheetDate(text) {
  return parseSheetDateTime(text).date;
}
