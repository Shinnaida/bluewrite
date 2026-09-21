// BlueWrite — the top bar's notification bell.
//
// WHAT IT IS FOR. The reports an officer writes are worked on by OTHER people:
// a second officer reviews a translation and verifies or disputes it, an admin
// finalizes, archives or restores a record. Until now the only way to find out
// was to go and look. The bell is the place that news arrives.
//
// WHAT IT IS NOT. It is not a message system, and nothing is pushed, mailed or
// announced anywhere else: the feed is a READ of records the features already
// keep (report_verifications, report_history — see the server controller), and
// the badge is a count of those records newer than this ACCOUNT's read
// watermark. There is no per-item read state, so there are no per-item
// "mark as unread" or "archive" actions either: a feed of acts performed on
// your own reports is not a mailbox, and inventing those controls would mean
// inventing the state behind them.
//
// ---- The row, and why it is shaped this way -------------------------------
//
// A feed like this is SCANNED, not read: an officer opens it to answer one
// question, "is any of this mine to act on?", and leaves. So every row has a
// strict hierarchy, and the parts are always in the same order:
//
//   [dot] [glyph]  Headline                  2h
//                  BW-0042 · Theft
//                  | the reviewer's own words
//
//   the glyph     says WHAT HAPPENED before a word is read (check, alert, box)
//   the headline  names the act and the person: it has to stand on its own
//   the meta line the report it is about, and its type
//   the detail    the one thing the row has to add: a dispute's own note
//   the time      relative while that is meaningful, absolute once it is not
//
// UNREAD IS SAID ONCE, in two halves: a dot in the gutter and a heavier
// headline. Not a dot plus a tint plus bold plus a left border, which is four
// ways of saying one thing and the most common way a feed starts to look
// broken. Read rows are a step quieter rather than greyed out: the read state
// is most of the feed and it has to look deliberate.
//
// THE READ WATERMARK IS MOVED WHEN THE PANEL CLOSES, NOT WHEN IT OPENS, and the
// Unread filter is the reason. Marking read on open would erase the unread dots
// — and empty the Unread view — in the same click that revealed them, which
// makes the filter theatre. So the panel opens with the dots still on, and
// dismissing it is what says "I have seen these". Two consequences worth
// stating: a panel left open keeps the badge lit on the bar, and what is marked
// is the newest act the officer was SHOWN — a filter that hid rows does not
// mark them read.
//
// FAILURE IS QUIET, WITH ONE EXCEPTION. This is chrome: a feed that cannot be
// read shows no badge and raises no workspace-wide notice, because reporting a
// connection problem belongs to the banner the screens holding real work
// already show. But a panel that is EMPTY because the request failed must not
// look like a panel that is empty because nothing happened — that is the one
// case that gets a sentence and a retry.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
// TEMPORARY MOCK — delete this import with src/mock-notifications.js. See that
// file's header for the whole removal, which is three lines here and no more.
import { MOCK_FEED_ENABLED, mockFeed, mockMarkSeen } from '../mock-notifications.js';
import {
  FILTERS,
  badgeLabel,
  bellLabel,
  documentTitle,
  filterEmpty,
  filterNotifications,
  groupItemsByDay,
  isOpenable,
  isUnread,
  newestItem,
  notificationDetail,
  notificationHeadline,
  notificationKind,
  relativeAge,
  supersededNote,
} from '../lib/notifications.js';

// How often the feed is re-read while the tab is visible. The officer's own
// work is not blocked by this: it is one small GET, and nothing about it is
// urgent enough to poll faster. A hidden tab does not poll at all.
const POLL_MS = 60000;

/**
 * The leading glyph, per act. Drawn by hand in this app's one icon style
 * (24-unit box, 1.8 stroke, no fill) because the app carries no icon library
 * and does not intend to: eight small marks do not justify a dependency, and a
 * borrowed family would be the only one in the product.
 */
const GLYPHS = {
  verified: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.4 2.4 2.4 4.6-5" />
    </>
  ),
  disputed: (
    <>
      <path d="M12 3.8 21 19.5H3z" />
      <path d="M12 9.8v4M12 16.6h.01" />
    </>
  ),
  reviewed: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  finalized: (
    <>
      <path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12z" />
      <path d="M14 3.5V8h4.5" />
      <path d="m9.3 13.6 2 2 3.6-3.9" />
    </>
  ),
  archived: (
    <>
      <path d="M3.5 7.5h17v12h-17z" />
      <path d="M2.5 4h19v3.5h-19zM9.5 12.5h5" />
    </>
  ),
  restored: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 3.8V8h4.2" />
    </>
  ),
  activity: (
    <>
      <path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
};

/** The leading mark of a row, coloured by act and never by emphasis. */
function RowGlyph({ kind }) {
  return (
    <span className={`ir-bell-glyph is-${kind}`} aria-hidden="true">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[kind] ?? GLYPHS.activity}
      </svg>
    </span>
  );
}

export default function NotificationBell({ onOpenReport }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  // The account's watermark as the SERVER reports it. Unread styling is a
  // string comparison against each item's `happened_at` — both are the same
  // `YYYY-MM-DD HH:MM:SS` form from the same clock, which orders correctly as
  // text and needs no date parsing (and so no timezone guess) at all.
  const [seenAt, setSeenAt] = useState(null);
  const [open, setOpen] = useState(false);
  // The visible filter. Reset to `all` every time the panel opens (see toggle),
  // so it can never be reopened onto a feed that is quietly hiding things.
  const [filter, setFilter] = useState('all');
  // First paint only: later polls keep the last known feed on screen rather
  // than dropping the list back to skeletons every minute.
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // When the feed was last read, so an open panel keeps counting its relative
  // ages without re-asking the server.
  const [fetchedAt, setFetchedAt] = useState(0);
  const [tick, setTick] = useState(0);
  const wrapRef = useRef(null);
  const aliveRef = useRef(true);
  // The tab title as it was before this component ever touched it, captured
  // once so the count can be added and taken away without nesting prefixes.
  const baseTitleRef = useRef(null);

  const load = useCallback(async () => {
    try {
      // TEMPORARY MOCK: sample items instead of the real feed.
      const data = MOCK_FEED_ENABLED ? await mockFeed() : await api('/notifications');
      if (!aliveRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnread(Number(data.unread) || 0);
      setSeenAt(data.seen_at ?? null);
      setFetchedAt(Date.now());
      setFailed(false);
    } catch {
      // The badge simply stays as it was. Only a panel with nothing to show
      // admits it — see the header.
      if (aliveRef.current) setFailed(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  // Polling, and the two moments a poll would be too late: when the tab comes
  // back to the foreground and when the window is focused. An officer who has
  // been away is exactly the one with news waiting.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  // The relative ages only need to move while somebody is reading them.
  useEffect(() => {
    if (!open) return undefined;
    const iv = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(iv);
  }, [open]);

  // The unread count in the browser TAB, which is the bell's other surface: an
  // officer working in another tab, or with the window behind something else,
  // is exactly who a badge inside the page cannot reach.
  //
  // It lives HERE rather than in Shell because the count is already polled here
  // — a second reader for the title would double the requests to say the same
  // thing. Captured and restored rather than hardcoded, because the title
  // belongs to index.html: signing out unmounts this component and the
  // sign-in screen gets its own title back.
  useEffect(() => {
    baseTitleRef.current = document.title;
    return () => {
      if (baseTitleRef.current !== null) document.title = baseTitleRef.current;
    };
  }, []);

  useEffect(() => {
    if (baseTitleRef.current === null) return;
    document.title = documentTitle(baseTitleRef.current, unread);
  }, [unread]);

  // Close on outside click or Escape, the same contract as the profile menu.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // `tick` is a real dependency: it is what re-reads the clock while the panel
  // sits open, so "just now" turns into "2m ago" without asking the server.
  const elapsedSeconds = useMemo(() => {
    if (!fetchedAt) return 0;
    return Math.max(0, (Date.now() - fetchedAt) / 1000);
  }, [fetchedAt, tick]);

  // What the filter is letting through, then that split into day sections.
  const visible = useMemo(
    () => filterNotifications(items, filter, seenAt),
    [items, filter, seenAt],
  );
  const sections = useMemo(() => groupItemsByDay(visible), [visible]);
  const empty = filterEmpty(filter);

  /**
   * Advance the watermark to the newest act that was on screen.
   *
   * Called when the panel closes. The feed is re-read afterwards rather than
   * the badge being adjusted locally, because `unread` is counted by the server
   * over the WHOLE feed and the panel only holds one page of it (see the
   * controller) — a local subtraction would drift from the badge on the bar.
   */
  const markVisibleSeen = useCallback(async () => {
    const newest = newestItem(visible);
    // Nothing was on screen (an empty filter, or a failed load): there is no
    // "read up to" to advance, and moving the watermark to "now" here would
    // mark read events the officer never saw.
    if (!newest) return;
    try {
      // TEMPORARY MOCK: same call, answered in memory. The real rule it keeps is
      // the one that matters here — the newest event SHOWN is what is marked,
      // not "now".
      const res = MOCK_FEED_ENABLED
        ? await mockMarkSeen(newest.happened_at)
        : await api('/notifications/seen', {
            method: 'POST',
            body: { seen_through: newest.happened_at },
          });
      if (!aliveRef.current) return;
      setSeenAt(res.seen_at ?? newest.happened_at);
      load();
    } catch {
      // The badge stays as it was. Nothing about reading the feed may fail
      // loudly into a screen where somebody is working.
    }
  }, [visible, load]);

  /** Open the panel, or close it and mark what was shown as read. */
  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      await markVisibleSeen();
      return;
    }
    setFilter('all');
    setOpen(true);
  }, [open, markVisibleSeen]);

  const openReport = useCallback(
    (item) => {
      setOpen(false);
      // Clicking through is also a dismissal: the row is being read in the
      // editor now, and leaving the badge lit behind it would be a lie.
      markVisibleSeen();
      onOpenReport?.(item.report_id);
    },
    [markVisibleSeen, onOpenReport],
  );

  const badge = badgeLabel(unread);
  const showFailure = failed && items.length === 0;

  return (
    <div className="ir-bell-wrap" ref={wrapRef}>
      {open && (
        <div className="ir-bell-panel" role="dialog" aria-label="Notifications">
          <div className="ir-bell-head">
            <div className="ir-bell-head-top">
              <span className="ir-bell-title">Notifications</span>
              {unread > 0 && <span className="ir-bell-count">{unread} new</span>}
              {/* The app's other segmented control (Profile ▸ Form format)
                  carries the same roles, so this is one pattern used twice
                  rather than a second invention. */}
              <div className="ir-bell-filters" role="radiogroup" aria-label="Filter notifications">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={filter === f.id}
                    className={`ir-bell-filter${filter === f.id ? ' on' : ''}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <span className="ir-bell-scope">Activity on the reports you recorded</span>
          </div>

          {loading && items.length === 0 && (
            // Shaped like the rows it replaces, so the panel does not jump when
            // the feed lands. Three is enough to fill the first screenful.
            <ul className="ir-bell-skeletons" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <li className="ir-bell-skeleton" key={i}>
                  <span className="ir-bell-skeleton-bar is-w1" />
                  <span className="ir-bell-skeleton-bar is-w2" />
                </li>
              ))}
            </ul>
          )}

          {!loading && showFailure && (
            <div className="ir-bell-empty" role="status">
              <p className="ir-bell-empty-lead">Couldn’t load notifications.</p>
              <p className="ir-bell-empty-note">
                The station server did not answer. Everything else still works.
              </p>
              <button
                type="button"
                className="ir-bell-action"
                onClick={() => {
                  setLoading(true);
                  load();
                }}
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !showFailure && visible.length === 0 && (
            <div className="ir-bell-empty">
              <p className="ir-bell-empty-lead">{empty.lead}</p>
              <p className="ir-bell-empty-note">{empty.note}</p>
              {/* The way back. A filtered view that came up empty must not
                  leave the officer wondering where the feed went. */}
              {filter !== 'all' && (
                <button type="button" className="ir-bell-action" onClick={() => setFilter('all')}>
                  Show all
                </button>
              )}
            </div>
          )}

          {sections.map((section) => (
            <section className="ir-bell-day" key={section.group}>
              <h3 className="ir-bell-day-label">{section.label}</h3>
              <ul className="ir-bell-list">
                {section.items.map((item) => {
                  const kind = notificationKind(item);
                  const headline = notificationHeadline(item) || 'Activity on your report';
                  const detail = notificationDetail(item);
                  const superseded = supersededNote(item);
                  const age = relativeAge(item.age_seconds, elapsedSeconds);
                  const unreadItem = isUnread(item, seenAt);
                  const openable = isOpenable(item);

                  // An archived report cannot be opened by anyone but an admin
                  // (every read path filters deleted_at), so its item is a
                  // statement. The archive event itself is still reported — see
                  // the server controller on why that one is not suppressed.
                  const Row = openable ? 'button' : 'div';
                  return (
                    <li key={`${item.kind}-${item.event_id}`}>
                      <Row
                        {...(openable
                          ? {
                              type: 'button',
                              className: `ir-bell-item${unreadItem ? ' is-unread' : ''}`,
                              onClick: () => openReport(item),
                              title: 'Open this report',
                            }
                          : {
                              className: `ir-bell-item is-static${unreadItem ? ' is-unread' : ''}`,
                            })}
                      >
                        <span className="ir-bell-marker" aria-hidden="true">
                          {unreadItem && <span className="ir-bell-dot" />}
                        </span>
                        <RowGlyph kind={kind} />
                        <span className="ir-bell-main">
                          <span className="ir-bell-act">{headline}</span>
                          <span className="ir-bell-meta">
                            <span className="ir-bell-no">{item.report_number}</span>
                            {item.incident_type ? ` · ${item.incident_type}` : ''}
                          </span>
                          {detail !== '' && <span className="ir-bell-detail">{detail}</span>}
                          {superseded !== '' && (
                            <span className="ir-bell-superseded">{superseded}</span>
                          )}
                        </span>
                        {/* Relative while that means something, the server's own
                            formatted date once it does not — never a raw
                            `YYYY-MM-DD HH:MM:SS`, which is a database value and
                            reads like one. The exact timestamp stays in the
                            tooltip. */}
                        <span className="ir-bell-time" title={item.happened_at}>
                          {age ?? item.happened_label}
                        </span>
                      </Row>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <button
        type="button"
        className="ir-bell-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={bellLabel(unread)}
        title={bellLabel(unread)}
        onClick={toggle}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {GLYPHS.activity}
        </svg>
        {badge !== '' && (
          <span className="ir-bell-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
