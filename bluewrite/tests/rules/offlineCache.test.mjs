// BlueWrite — what the workspace keeps on this computer when the server goes away.
//
// WHY THIS FILE EXISTS. Every rule in src/lib/offlineCache.js fails QUIETLY, and
// that is on purpose: the module exists so that a dropped connection does not take
// the screen with it, so nothing it does may itself break the screen. Which means
// the only way to know it still keeps its promises is to try each failure on it —
// an entry corrupted by the very quota error that filled the storage, a browser
// that refuses to write at all, an account that is not signed in, a list that
// belongs to a different question — and watch that the answer is a quiet null
// rather than an exception on the register.
//
// AND TWO PROMISES ARE ABOUT PRIVACY RATHER THAN ABOUT PIXELS:
//
//   * sessionStorage, never localStorage. This runs on station workstations that
//     are shared; reports must not outlive the tab they were read in, or the next
//     officer at that PC inherits the last one's register.
//   * an account that cannot be named is not stored under a made-up one, for the
//     same reason.
//
// Both are asserted here rather than trusted, because neither shows up as a
// symptom until it shows up as somebody else's data.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../../src/lib/offlineCache.js', import.meta.url), 'utf8');

/**
 * The module's CODE, with its comments removed.
 *
 * The source-level checks below look for the storage the module reaches for, and
 * its header comment says the word "localStorage" out loud — to explain why it is
 * not used. Reading the prose as if it were code would fail the file for keeping
 * its own reasoning, which is the opposite of what is being asserted.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** A sessionStorage stand-in: same API, inspectable, and it can be sabotaged. */
class FakeStorage {
  constructor({ failWrites = false } = {}) {
    this.map = new Map();
    this.failWrites = failWrites;
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  /** The key as it was stored, for the assertions that are about the key itself. */
  keys() {
    return [...this.map.keys()];
  }
}

function install(store) {
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true, writable: true });
  } catch {
    globalThis.sessionStorage = store;
  }
}

/**
 * A browser with the storage taken away entirely — every touch throws.
 *
 * If the runtime will not let the global be redefined, the module sees no storage
 * at all, which is the other half of the same rule and exercises the same quiet
 * answers: either way nothing is stored and nothing is thrown.
 */
function installThrowing() {
  try {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('storage denied by the browser');
      },
    });
  } catch {
    /* see the note above */
  }
}

const store = new FakeStorage();
install(store);
const cache = await import('../../src/lib/offlineCache.js');

const LIST = { reports: [{ id: 19, incident_type: 'Theft', status: 'draft' }], total: 1 };

const bigText = (n) => 'x'.repeat(n);
const bigList = (n) => ({ reports: [{ id: 1, note: bigText(n) }], total: 1 });

beforeEach(() => {
  install(new FakeStorage());
});

test('a list comes back after a reload, under the account and version that wrote it', () => {
  assert.equal(cache.saveReports(7, 'sort=status', LIST), true);
  const back = cache.readReports(7, 'sort=status');
  assert.deepEqual(back.reports, LIST.reports);
  assert.equal(back.total, 1);
  // Stamped, so the screen can say how old what it is showing is.
  assert.match(back.savedAt, /^\d{4}-\d{2}-\d{2}T/, 'the stored list carries no time it was stored');
  assert.equal(cache.hasAnything(7), true);

  // The key says whose register it is and which shape wrote it — the two facts
  // `clearFor` and the version check both read back.
  const keys = globalThis.sessionStorage.keys();
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^bw\.offline\.v1\.u7\.list$/);
});

test('a stored list answers only the question it was stored for', () => {
  cache.saveReports(7, cache.reportListKey({ q: 'theft' }), LIST);
  assert.equal(cache.readReports(7, cache.reportListKey({ q: 'theft' })).total, 1, 'the same question lost its list');
  // A different search, a different page, the archive: a different list. Showing
  // the stored one here would be the register answering a question nobody asked.
  for (const other of [{ q: 'robbery' }, { q: 'theft', page: 2 }, { q: 'theft', archived: true }]) {
    assert.equal(cache.readReports(7, cache.reportListKey(other)), null, `${JSON.stringify(other)} read the other list`);
  }
});

test('the query signature ignores everything the question ignores', () => {
  const key = cache.reportListKey;
  // Absent and empty are the same question, in every spelling the register uses.
  assert.equal(key({ sort: 'status' }), key({ sort: 'status', q: '', type: null, page: undefined }));
  // So are false and absent, for the flags.
  assert.equal(key({ archived: false }), key({}));
  assert.equal(key({ q: 'theft' }), key({ q: ' theft ' }));
  // Order and type are the object's business, not the question's.
  assert.equal(key({ q: 'theft', page: 1 }), key({ page: '1', q: 'theft' }));
  // …and a real difference is still a difference.
  assert.notEqual(key({ archived: true }), key({}));
  assert.notEqual(key({ status: 'draft' }), key({ status: 'finalized' }));
  // A field this build does not name cannot split one list into two caches.
  assert.equal(key({ q: 'theft' }), key({ q: 'theft', tab: 'shelf-2' }));

  // The property the wiring depends on: the signature written and the signature
  // read are computed from two different renders of the same query object.
  cache.saveReports(7, key({ q: 'theft', page: 1 }), LIST);
  assert.equal(cache.readReports(7, key({ page: '1', q: 'theft', dir: '' })).total, 1);
});

test('one officer’s register is not the next one’s', () => {
  cache.saveReports(7, 'k', LIST);
  cache.saveDraft(7, 19, { narrative: 'officer seven' });

  assert.equal(cache.readReports(8, 'k'), null, 'another account read the first one’s list');
  assert.equal(cache.readDraft(8, 19), null, 'another account read the first one’s draft');
  assert.equal(cache.hasAnything(8), false);

  cache.saveReports(8, 'k', { reports: [{ id: 42 }], total: 1 });
  cache.clearFor(7);
  assert.equal(cache.hasAnything(7), false, 'signing out left something behind');
  assert.equal(cache.readReports(8, 'k').reports[0].id, 42, 'signing out took the other account’s list with it');
});

test('an entry that cannot be read is nothing stored — never an empty one', () => {
  cache.saveDraft(7, 19, { narrative: 'half written' });
  const [key] = globalThis.sessionStorage.keys();

  // Corrupted, as a half-written quota error leaves it.
  globalThis.sessionStorage.setItem(key, '{"v":1,"savedAt":"2026-10-08T00:00:00.000Z","value"');
  assert.equal(cache.readDraft(7, 19), null);
  assert.equal(cache.hasAnything(7), false);

  // A shape from another build: ignored rather than rendered as a draft full of
  // blanks, which an officer could then save over the real one.
  globalThis.sessionStorage.setItem(key, JSON.stringify({ v: 99, savedAt: 'x', value: { narrative: 'old' } }));
  assert.equal(cache.readDraft(7, 19), null);
  assert.equal(cache.hasAnything(7), false);

  // JSON of the right version but not of this shape.
  globalThis.sessionStorage.setItem(key, JSON.stringify({ v: 1, savedAt: 'x' }));
  assert.equal(cache.readDraft(7, 19), null);
});

test('a storage that refuses to write leaves the register working', () => {
  install(new FakeStorage({ failWrites: true }));
  assert.equal(cache.saveReports(7, 'k', LIST), false, 'a refused write was reported as a success');
  assert.equal(cache.saveDraft(7, 19, { narrative: 'x' }), false);
  assert.equal(cache.readReports(7, 'k'), null);
  assert.equal(cache.hasAnything(7), false);
  assert.equal(cache.clearFor(7), true, 'clearing an empty storage is not a failure');
});

test('a browser with the storage taken away answers quietly', () => {
  installThrowing();
  assert.equal(cache.saveReports(7, 'k', LIST), false);
  assert.equal(cache.saveDraft(7, 19, { narrative: 'x' }), false);
  assert.equal(cache.readReports(7, 'k'), null);
  assert.equal(cache.readDraft(7, 19), null);
  assert.equal(cache.hasAnything(7), false);
  assert.equal(cache.clearFor(7), false);
  assert.equal(cache.clearDraft(7, 19), false);
});

test('an account that cannot be named is not stored at all', () => {
  for (const nobody of [null, undefined, '', '   ', 'null', 'undefined']) {
    assert.equal(cache.saveReports(nobody, 'k', LIST), false, `stored a list for ${JSON.stringify(nobody)}`);
    assert.equal(cache.saveDraft(nobody, 19, { narrative: 'x' }), false);
    assert.equal(cache.readReports(nobody, 'k'), null);
    assert.equal(cache.hasAnything(nobody), false);
  }
  assert.equal(globalThis.sessionStorage.length, 0, 'a nameless account left something on this computer');
});

test('a value that does not fit is not stored half-written, and the drafts give way first', () => {
  const list = bigList(300_000); // ≈ 600 KB of UTF-16
  const draft = { narrative: bigText(300_000) };

  assert.equal(cache.saveReports(7, 'k', list), true);
  assert.equal(cache.saveDraft(7, 11, draft), true);
  // A second draft of the same size cannot fit beside the list and the first one.
  assert.equal(cache.saveDraft(7, 12, draft), true, 'a draft that fits after eviction was refused');
  assert.equal(cache.readReports(7, 'k')?.reports[0].id, 1, 'the LIST gave way to a draft');
  assert.equal(cache.readDraft(7, 12) !== null, true, 'the newest draft is not the one kept');
  assert.equal(cache.readDraft(7, 11), null, 'the oldest draft was kept instead of being dropped');

  // Too big for the whole budget even on its own: nothing is written, and what was
  // already held is left whole rather than emptied to make room for it.
  assert.equal(cache.saveReports(7, 'k', bigList(1_000_000)), false);
  assert.equal(cache.readReports(7, 'k')?.reports[0].id, 1);
  assert.equal(cache.readDraft(7, 12) !== null, true);
});

test('this is held for the session, never on the disk', () => {
  // The rule is the whole reason the module exists in the storage it chose: a
  // shared workstation's next officer must not be able to open the register onto
  // the previous one's reports, and a tab that closes must be the end of them.
  assert.match(CODE, /sessionStorage/, 'the cache no longer uses session storage');
  assert.doesNotMatch(CODE, /localStorage/, 'the cache would outlive the tab and the sign-out');
  assert.doesNotMatch(CODE, /document\.cookie|indexedDB/, 'the cache found another place to leave reports behind');
});
