// BlueWrite — what the workspace keeps on THIS computer so a dropped connection
// does not take the screen with it.
//
// THE FAILURE THIS EXISTS FOR. The app is a session app on a LAN: every list it
// draws and every draft it saves comes back from the station server. When that
// server cannot be reached, the officer reloads and the register they were
// reading a second ago is an empty page with a warning on it — and the draft they
// were halfway through writing is gone, because the only copy of it was on the
// server they can no longer reach. Neither of those losses needs to happen: the
// browser already holds the last answer it was given. This module is that
// holding place, and nothing more — it fetches nothing, renders nothing and
// knows nothing about React.
//
// THREE DECISIONS WORTH THE WORDS:
//
//   1. sessionStorage, NEVER localStorage. A station PC is shared — the officer
//      who signs in next is a colleague, not the same person — so what is held
//      here has to die with the tab that read it rather than sit on the disk for
//      whoever sits down next. (localStorage would outlive sign-out, the tab and
//      the shift, and the next officer would open the register onto reports that
//      are not theirs. That is a privacy failure in a police station, not a
//      caching detail.)
//
//   2. NOTHING HERE MAY EVER THROW. Every entry point answers null / false rather
//      than raising: Safari's private mode, a browser with storage switched off,
//      a quota that fills mid-shift and JSON that was half-written by the failure
//      that filled it are all normal states of the world. A cache that can break
//      the screen it exists to protect is worse than no cache at all — the
//      register must open onto the server's answer whether or not this module
//      works.
//
//   3. THE STORED VALUE IS STAMPED with `savedAt` and the shape's own version, so
//      a build that changes what a draft looks like ignores what the older build
//      left behind instead of rendering it as a form full of blanks. A version
//      the reader does not recognise reads as NOTHING STORED — never as an empty
//      draft, which an officer could then save over the real one.
//
// The API is deliberately four verbs (save / read / clear / hasAnything) over two
// kinds of thing (the last report list, and one draft), because that is all the
// wiring needs: Reports.jsx stores what the server just answered with and, when
// the server cannot answer at all, reads it back.

/** The shape this build writes. Bump it when a stored draft changes shape. */
export const CACHE_VERSION = 1;

// Every key this module owns starts here: the module's own name, the version, and
// the account it belongs to. `clearFor` and the byte budget both work by reading
// this prefix back, so there is exactly one place that spells a key.
const NAMESPACE = `bw.offline.v${CACHE_VERSION}`;

/** The slot the last report list lives in. */
const LIST_SLOT = 'list';

/** The slot one report's draft lives in. */
const draftSlot = (reportId) => `draft.${String(reportId ?? '').trim()}`;

// ABOUT 1.5 MB, measured as UTF-16 code units × 2 — a cheap, monotone stand-in
// for bytes that is honest about what it is. sessionStorage is a few megabytes
// in every browser this station runs, so the budget exists to keep one huge list
// from evicting everything else with a quota error, not because the space is
// tight. A value that cannot fit even after the drafts give way is NOT stored at
// all: half a list of reports is a register showing some of the truth.
const BUDGET_BYTES = 1_500_000;

/** What a stored value weighs, generously (UTF-16 code units, two bytes each). */
const weigh = (text) => text.length * 2;

/**
 * The account these values belong to, or null when there is nobody to name.
 *
 * NO ACCOUNT, NO STORAGE. An unidentified user is not a shared bucket: storing
 * under a made-up name would hand one officer's register to the next one. The
 * absence is handled by every writer returning false and every reader null.
 */
function identity(userId) {
  if (userId === null || userId === undefined) return null;
  const id = String(userId).trim();
  return id === '' || id === 'null' || id === 'undefined' ? null : id;
}

function slot(id, what) {
  return `${NAMESPACE}.u${id}.${what}`;
}

/**
 * sessionStorage, or null when this browser will not part with it.
 *
 * The probe read is not decoration: some privacy modes hand back an object whose
 * getters throw on use, and asking it a question here is how the rest of the
 * module gets to assume it is talking to something that answers.
 */
function storage() {
  try {
    const store = globalThis.sessionStorage;
    if (!store) return null;
    store.getItem(`${NAMESPACE}.probe`);
    return store;
  } catch {
    return null;
  }
}

/** The stored text of one of this user's keys, or null. Never throws. */
function rawAt(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A stored value, read back — `{ value, savedAt }`, or null.
 *
 * NULL IS THE ONLY FAILURE MODE, and it covers all four ways an entry can be
 * unusable: it is not there, it is not JSON, it is JSON of another version, or it
 * is JSON of this version without a value. The caller cannot act on the
 * difference, and must not: every one of them means "there is nothing to show".
 */
function decode(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== CACHE_VERSION) return null;
    if (!('value' in parsed)) return null;
    return { value: parsed.value, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null };
  } catch {
    return null;
  }
}

/** Every key this module has stored for one account, in no particular order. */
function keysOf(store, id) {
  const prefix = `${NAMESPACE}.u${id}.`;
  const keys = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (typeof key === 'string' && key.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // A store that cannot be enumerated is a store this module will not trust
    // with an eviction decision: it simply declines the write below.
  }
  return keys;
}

/** What this account's stored values weigh, ignoring one key that is being replaced. */
function usedBytes(store, id, except) {
  let used = 0;
  for (const key of keysOf(store, id)) {
    if (key === except) continue;
    used += weigh(key) + weigh(rawAt(store, key) ?? '');
  }
  return used;
}

/** The drafts this account holds, oldest first — the order they give way in. */
function draftsOldestFirst(store, id) {
  return keysOf(store, id)
    .filter((key) => key.includes('.draft.'))
    .map((key) => ({ key, savedAt: decode(rawAt(store, key))?.savedAt ?? '' }))
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
}

/**
 * Make room for `need` bytes, or say that there is none.
 *
 * THE DRAFTS GIVE WAY FIRST, and they give way oldest-first: a list can be asked
 * for again the moment the server is back, and the draft nearest the officer's
 * own hands is the one worth keeping. The list being written is excluded from the
 * count because it is being REPLACED, not added to — which is also why a write
 * that still does not fit stores nothing and leaves whatever was there intact.
 */
function makeRoom(store, id, incomingKey, need) {
  // A value that cannot fit even in an EMPTY cache is refused before anything is
  // evicted: dropping the officer's drafts to make room for something that still
  // will not fit is the worst of both, and it is the one way this module could
  // destroy work it was installed to protect.
  if (need > BUDGET_BYTES) return false;
  if (usedBytes(store, id, incomingKey) + need <= BUDGET_BYTES) return true;
  for (const draft of draftsOldestFirst(store, id)) {
    if (draft.key === incomingKey) continue;
    try {
      store.removeItem(draft.key);
    } catch {
      return false;
    }
    if (usedBytes(store, id, incomingKey) + need <= BUDGET_BYTES) return true;
  }
  return usedBytes(store, id, incomingKey) + need <= BUDGET_BYTES;
}

/** Store one value in one slot. True when it is on this computer now. */
function writeSlot(userId, what, value) {
  const id = identity(userId);
  const store = storage();
  if (!id || !store) return false;

  let text;
  try {
    text = JSON.stringify({ v: CACHE_VERSION, savedAt: new Date().toISOString(), value });
  } catch {
    // A value that cannot be serialised (a circular structure, a BigInt) is a
    // value that cannot be held — not a reason to fail the save the officer asked
    // the server for.
    return false;
  }
  if (typeof text !== 'string') return false;

  const key = slot(id, what);
  if (!makeRoom(store, id, key, weigh(key) + weigh(text))) return false;
  try {
    store.setItem(key, text);
    return true;
  } catch {
    // Quota, or a store that went read-only between the probe and here.
    return false;
  }
}

/** Read one slot back. `{ value, savedAt }` or null. */
function readSlot(userId, what) {
  const id = identity(userId);
  const store = storage();
  if (!id || !store) return null;
  return decode(rawAt(store, slot(id, what)));
}

/** Remove one slot. True when it is gone (or was never there). */
function dropSlot(userId, what) {
  const id = identity(userId);
  const store = storage();
  if (!id || !store) return false;
  try {
    store.removeItem(slot(id, what));
    return true;
  } catch {
    return false;
  }
}

/**
 * The fields the register's own question is made of, and only those.
 *
 * A signature rather than the object itself, because the object is rebuilt on
 * every render: object identity and key order both change without the question
 * changing, and a cache keyed on either would miss every time. A field this list
 * does not name is IGNORED on purpose — a new piece of UI state must not be able
 * to split one list into two cached copies, or evict the copy the officer
 * actually needs.
 */
const QUERY_FIELDS = [
  'q',
  'sort',
  'dir',
  'status',
  'type',
  'from',
  'to',
  'page',
  'per_page',
  'archived',
  'awaiting',
  'created_by',
];

/**
 * A stable signature of one register query — the key the last list is filed under.
 *
 * Empty and missing are the SAME QUESTION (`q: ''` and no `q` both mean "no
 * search"), and so are `false` and missing for the flags, because the register
 * builds its query object from several places and one of them spelling an
 * absence differently from another must not cost the officer their cached list.
 * Numbers and their strings agree too, for the same reason (`page: 1`).
 */
export function reportListKey(query) {
  const src = query && typeof query === 'object' ? query : {};
  const parts = [];
  for (const field of QUERY_FIELDS) {
    const raw = src[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'boolean') {
      if (raw) parts.push(`${field}=1`);
      continue;
    }
    const text = String(raw).trim();
    if (text === '') continue;
    parts.push(`${field}=${text}`);
  }
  return parts.join('&');
}

/**
 * Keep the list the server just answered with.
 *
 * `payload` is the API's own reading of the register — `{ reports, total }` — and
 * a payload that is not that shape (a 500, a payload from an older build) is not
 * stored rather than stored as an empty register.
 */
export function saveReports(userId, key, payload) {
  if (!Array.isArray(payload?.reports)) return false;
  return writeSlot(userId, LIST_SLOT, {
    key: String(key ?? ''),
    reports: payload.reports,
    total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : payload.reports.length,
  });
}

/**
 * The stored list, but ONLY for the question that is still being asked.
 *
 * The key is part of the answer: a stored list from a different search, filter or
 * page is not "the last loaded list", it is a different list, and showing it
 * would be the register quietly answering a question nobody asked. A mismatch
 * reads as nothing stored — the screen then says it has nothing, which is true.
 *
 * @returns {{reports: Array, total: number, savedAt: string|null}|null}
 */
export function readReports(userId, key) {
  const entry = readSlot(userId, LIST_SLOT);
  if (!entry || !entry.value || typeof entry.value !== 'object') return null;
  if (entry.value.key !== String(key ?? '')) return null;
  if (!Array.isArray(entry.value.reports)) return null;
  return {
    reports: entry.value.reports,
    total: Number.isFinite(Number(entry.value.total)) ? Number(entry.value.total) : entry.value.reports.length,
    savedAt: entry.savedAt,
  };
}

/**
 * Keep the report being written.
 *
 * Stored AS GIVEN — this module does not know a draft's fields and must not grow
 * to: the form that owns them is the one that decides what a draft is, and a copy
 * of that shape here would be a second definition to keep in step.
 */
export function saveDraft(userId, reportId, draft) {
  if (draft === undefined) return false;
  return writeSlot(userId, draftSlot(reportId), draft);
}

/** The stored draft, or null. `{ draft, savedAt }`. */
export function readDraft(userId, reportId) {
  const entry = readSlot(userId, draftSlot(reportId));
  if (!entry || !('value' in entry)) return null;
  return { draft: entry.value, savedAt: entry.savedAt };
}

/**
 * Forget one draft — called when the server has it, because from that moment the
 * server's copy is the real one and a stale local copy is a thing that could be
 * restored over it.
 */
export function clearDraft(userId, reportId) {
  return dropSlot(userId, draftSlot(reportId));
}

/**
 * Forget everything held for one account.
 *
 * Called on sign-out. The next officer at this PC must not be able to open the
 * register onto the previous one's reports, and "the tab would have closed
 * anyway" is not a promise this module can make on a browser that restores tabs.
 */
export function clearFor(userId) {
  const id = identity(userId);
  const store = storage();
  if (!id || !store) return false;
  let ok = true;
  for (const key of keysOf(store, id)) {
    try {
      store.removeItem(key);
    } catch {
      ok = false;
    }
  }
  return ok;
}

/**
 * Is there anything to show if the server is unreachable right now?
 *
 * Only DECODABLE entries count, in the shape this build understands: the question
 * this answers is "can this officer reload the page and still see something",
 * and bytes left by an older build are not that. The value is not read.
 */
export function hasAnything(userId) {
  const id = identity(userId);
  const store = storage();
  if (!id || !store) return false;
  return keysOf(store, id).some((key) => decode(rawAt(store, key)) !== null);
}
