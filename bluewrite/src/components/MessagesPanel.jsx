// BlueWrite — messages: the docked panel officers actually talk in.
//
// A FLOATING WINDOW, NOT A DOCK. It sits in the lower right corner beside the presence
// rail, sized to a reading measure, over whatever screen is open. It began life as a
// third panel pinned to the right edge that made the workspace reserve its width — the
// right shape for the AI narrative and the profile panel, which are surfaces you work
// IN for a while, and the wrong one for a conversation, which is glanced at, answered
// and dismissed. A permanent 24rem stripe out of the register is a lot of desk for
// that. Nothing here publishes a `body` class or reserves space any more; see
// `.dash-dock` in styles.css for where it lives and why.
//
// ONE WINDOW FOR ALL THREE SCREENS. A chathead opens a thread; the top bar opens the
// list; the title bar's `+` opens the picker. There is one component, one piece of
// state (`peer`) for which conversation is open and one flag for whether the picker is
// showing — because two windows over the same correspondence would be two places a
// message could arrive without the other knowing.
//
// AND THE COLLEAGUE YOU ARE TALKING TO IS NOT IN THE RAIL WHILE THIS IS OPEN. That rule
// lives in Chatheads (`openPeerId`): the corner says who you might be looking for, and
// once the box is open on somebody, that face has been found. Close the box and the
// circle comes back.
//
// WHY IT READS THE THREAD AGAIN EVERY EIGHT SECONDS. There is no push on a LAN tool:
// the server is told about a message when somebody asks. The heartbeat carries the
// unread marks, but it is a thirty-second beat and it says nothing about WHICH words
// arrived — so an open thread polls itself, and that is the only reason a reply
// appears while two officers are standing in front of the same screen. The poll stops
// when the tab is hidden, which is the same rule the heartbeat follows and for the
// same reason: a background tab is not somebody reading.
//
// CONTAINER AND VIEWS, SPLIT ON PURPOSE. `MessagesPanel` below owns the state, the
// requests and the clock; the three exported views above it are given everything they
// draw and touch nothing else. This is the same split as Chatheads/ChatheadRail, and
// for the same reason: renderToString never runs an effect, so a component that
// fetches cannot be rendered by a test at all — and a panel that only ever appears in
// a browser is a panel whose crashes are found by an officer. With the drawing
// separated, tests/fixtures/messagesRender.jsx renders the thread, the list and the
// picker for real and reads the markup.
//
// WHAT IT DOES NOT DO. No edits, no deletions, no typing indicators, no read receipts
// the sender can see (the server records `read_at` for the RECIPIENT's own unread
// count, and nothing shows it back to whoever wrote the message). Each of those is a
// feature somebody will ask for, and each is a promise about the other person that a
// station's internal line does not need to make.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isUnreachable } from '../lib/api.js';
import {
  MAX_BODY,
  TYPING_PING_MS,
  atBottom,
  canSend,
  lastSeenLabel,
  mergeThread,
  messageBodyError,
  previewOf,
  receiptLabel,
  receiptOf,
  shouldAnnounceTyping,
  threadPollMs,
  threadRows,
} from '../lib/messages.js';
import Avatar from './Avatar.jsx';

// ---------------------------------------------------------------------------
// The views. Everything they draw arrives as props; nothing here fetches.
// ---------------------------------------------------------------------------

/**
 * The window's title bar — one for all three screens.
 *
 * WHY THE BAR IS THE WINDOW'S AND NOT THE SCREEN'S. A thread used to draw its own head
 * with the peer's face and facts in it, and the list drew a different one. That is two
 * bars with two shapes, which means the close button moves and the box appears to
 * change what it is as you move around inside it. One bar, fixed furniture: the back
 * arrow and the face come and go, the actions stay in the same two slots.
 *
 * It is a VIEW like the other three — props in, no state, no fetching — and that is not
 * tidiness. The bar is the most visible thing about this window and the container it
 * used to live in cannot be rendered by a test at all, because it fetches. Here it can.
 */
export function MessagesBoxHead({
  screen = 'list',
  title = 'Messages',
  subtitle = '',
  peerInfo = null,
  minimized = false,
  onBack,
  onNew,
  onMinimize,
  onClose,
}) {
  return (
    <div className="messages-box-head">
      {screen !== 'list' && (
        <button type="button" className="messages-back" onClick={onBack} aria-label="All messages" title="All messages">
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}

      {/* Only on a thread: on the list and the picker there is no single person the box
          is about, and a face there would answer a question nobody asked. */}
      {screen === 'thread' && (
        <Avatar user={peerInfo ?? { full_name: '' }} className="messages-box-face" />
      )}

      {/* THE NAME AND THE STATUS ARE ONE BLOCK THAT MAY SHRINK, and the two lines
          truncate separately. This station has four-part names, and the failure a wrapped
          one causes is not cosmetic: it makes the bar two lines tall and moves the close
          button out from under the hand that is aiming at it. Truncating a surname is a
          smaller lie than a close button in the wrong place — and the full text is on
          `title`, so the truncated name is still readable by hovering it. */}
      <div className="messages-box-who">
        <p className="messages-box-title" title={title}>{title}</p>
        {subtitle !== '' && (
          <span className="messages-box-sub" title={subtitle}>{subtitle}</span>
        )}
      </div>

      {/* THE ACTIONS ARE A FIXED CLUSTER, which is the other half of that rule: a group
          with `flex: none` cannot be squeezed by a long name, so the three controls sit
          in the same three places whatever is beside them. */}
      <div className="messages-box-actions">
        {/* Starting a new conversation from wherever you are, which is the point of it
            being in the title bar rather than at the foot of a list you may not be looking
            at. Absent on the picker itself, where it would mean "start again". */}
        {screen !== 'picker' && (
          <button
            type="button"
            className="messages-box-action"
            onClick={onNew}
            aria-label="New message"
            title="New message"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}

        {/* PUT AWAY, NOT CLOSED. Minimizing folds the window down to this bar and nothing
            else — the conversation, the list and a half-written reply are all still there
            underneath. Its own control rather than a repeat of the close button, because
            those are two different intentions and only one of them throws away a thread. */}
        <button
          type="button"
          className="messages-box-action"
          onClick={onMinimize}
          aria-label={minimized ? 'Expand chat' : 'Minimize chat'}
          title={minimized ? 'Expand chat' : 'Minimize chat'}
          aria-expanded={!minimized}
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            {minimized ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
          </svg>
        </button>

        <button
          type="button"
          className="messages-box-action"
          onClick={onClose}
          aria-label="Close messages"
          title="Close messages"
        >
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * ONE MESSAGE IN THE TRANSCRIPT: a face for theirs, a bubble for both.
 *
 * A VIEW, exported, for the same reason the others are — and with more at stake than
 * most, because this is where the two things a thread gets wrong live: a receipt drawn
 * on the wrong side of the conversation, and a face drawn against the wrong bubble. Both
 * are properties of the markup, so both are checkable without a browser.
 *
 * THE RECEIPT IS ONLY EVER ON MINE. It answers "did they see it", which is a question
 * only the sender has — see lib/messages.js for receiptOf, which is also where the third
 * state (no receipt at all) is decided.
 */
export function MessageLine({ message = null, peerInfo = null }) {
  const mine = Boolean(message?.mine);
  const receipt = receiptOf(message);

  return (
    <div className={`messages-line${mine ? ' is-mine' : ''}`}>
      {/* The face is on the INCOMING side only: my own initials beside my own sentence
          would be the panel telling me who I am. It is decorative — the name is in the
          bar, and the bubble's side already says which of us is speaking. */}
      {!mine && <Avatar user={peerInfo ?? { full_name: '' }} className="messages-line-face" />}

      <div className="messages-bubble">
        <p className="messages-bubble-body">{message?.body}</p>
        <div className="messages-bubble-foot">
          {/* The time, in the server's clock, on every bubble: a thread is read back,
              and "when" is half of what it says. */}
          <span className="messages-bubble-time" title={message?.created_at}>
            {message?.sent_label}
          </span>
          {receipt && (
            <span
              className={`messages-receipt${receipt === 'read' ? ' is-read' : ''}`}
              role="img"
              aria-label={receiptLabel(message)}
              title={receiptLabel(message)}
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.1" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M1.5 12.5l4.5 4.5L13.5 6.5" />
                <path d="M9.5 17l1.5 1.5L22 6.5" />
              </svg>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Three dots where a reply has not been written yet.
 *
 * The SAME GEOMETRY AS AN INCOMING BUBBLE on purpose: a face beside a bubble, so the
 * thread does not shift sideways and back as the indicator appears and goes. It carries
 * the peer's name in its accessible text, because "three dots" is not a thing to
 * announce — and the dots themselves are `aria-hidden`, since a screen reader has no use
 * for one span per dot.
 */
export function TypingLine({ peerInfo = null }) {
  const name = peerInfo?.full_name || 'A colleague';

  return (
    <div className="messages-line messages-line--typing" data-typing="true">
      <Avatar user={peerInfo ?? { full_name: '' }} className="messages-line-face" />
      <div className="messages-bubble">
        <span className="messages-typing-dots" role="status" aria-label={`${name} is typing`}>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/**
 * One conversation, top to bottom: the messages, and the thing you type them in.
 *
 * It owns two effects and both are about the DOM it renders — scrolling to the newest
 * message, and putting the caret in the box — so they belong here rather than in the
 * container above, which cannot see either element.
 */
export function MessageThreadView({
  peerId,
  peerInfo,
  messages = [],
  loading = false,
  hasMore = false,
  error = null,
  draft = '',
  sending = false,
  peerTyping = false,
  onDraft,
  onSend,
}) {
  const scrollRef = useRef(null);
  const composerRef = useRef(null);
  const rows = useMemo(() => threadRows(messages), [messages]);

  // ---- following the newest message ------------------------------------------
  //
  // A THREAD FOLLOWS THE BOTTOM, WHICH IS THE ONE THING A CHAT HAS TO GET RIGHT — and it
  // stops following the instant somebody scrolls up to read. Those two are the same
  // rule: the newest message is what you want to see unless you have deliberately gone
  // somewhere else, and yanking somebody back to the bottom while they are reading is
  // how a panel becomes unusable for its actual purpose.
  //
  // `followRef` IS A REF AND `paused` IS STATE, and the split is deliberate rather than a
  // leftover. The decision to scroll is taken inside an effect, which sees the render it
  // was called for — reading `paused` there would use the value from BEFORE the scroll
  // that paused it, i.e. follow exactly one message too long. The state is only there to
  // draw the way back down.
  const followRef = useRef(true);
  const countRef = useRef(0);
  const peerRef = useRef(peerId);
  const [paused, setPaused] = useState(false);
  const [missed, setMissed] = useState(0);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return undefined;

    // A DIFFERENT CONVERSATION STARTS AT THE BOTTOM, always — the position of the old
    // thread's scrollbar is not a fact about the new one.
    if (peerRef.current !== peerId) {
      peerRef.current = peerId;
      followRef.current = true;
      countRef.current = 0;
      setPaused(false);
      setMissed(0);
    }

    if (followRef.current) {
      box.scrollTop = box.scrollHeight;
      countRef.current = rows.length;
      setMissed(0);
      return undefined;
    }

    // PAUSED: count what arrived instead of showing it, so the way back down can say how
    // much is waiting. Counting rather than a bare flag because "2 messages" is a reason
    // to scroll down and "there is something" is not.
    const grown = Math.max(0, rows.length - countRef.current);
    countRef.current = rows.length;
    if (grown > 0) setMissed((held) => held + grown);

    return undefined;
  }, [rows.length, peerId]);

  // Read off the SCROLL POSITION rather than off a "did they touch the wheel" flag: drag
  // the bar, press End, flick on a trackpad, and the answer is the same one — are we
  // looking at the bottom of this thread. It also self-corrects: a thread that grows past
  // the viewport while somebody is at the bottom keeps following, because they still are.
  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;

    const at = atBottom({
      scrollTop: box.scrollTop,
      scrollHeight: box.scrollHeight,
      clientHeight: box.clientHeight,
    });
    followRef.current = at;
    setPaused(!at);
    if (at) setMissed(0);
  };

  const jumpToNewest = () => {
    const box = scrollRef.current;
    followRef.current = true;
    setPaused(false);
    setMissed(0);
    if (box) box.scrollTop = box.scrollHeight;
  };

  // SENDING ALWAYS TAKES YOU BACK TO THE BOTTOM. Somebody who has scrolled up to check a
  // report number and then typed a reply is not "reading history" any more — they are
  // writing, and their own message appearing off-screen would be the panel hiding the
  // thing they just did.
  const submit = () => {
    followRef.current = true;
    setPaused(false);
    setMissed(0);
    onSend();
  };

  // The panel was opened to say something, so the caret starts in the box. A step that
  // exists for no reason is a step officers learn to resent.
  useEffect(() => {
    composerRef.current?.focus();
  }, [peerId]);

  const trimmed = draft.trim();
  const bodyError = trimmed === '' ? null : messageBodyError(draft);
  const nearLimit = trimmed.length > MAX_BODY - 120;
  const canSubmit = canSend(draft) && !sending;

  // Enter sends; Shift+Enter is a newline. A message is a sentence, not a paragraph,
  // and the button is there for anybody who would rather press it.
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) submit();
    }
  };

  const peerName = peerInfo?.full_name || 'your colleague';

  return (
    <>
      {/* NO HEAD OF ITS OWN — that belongs to the window. See MessagesBoxHead above.

          IT IS A LOG RATHER THAN A BOX OF TEXT. `role="log"` is the role for exactly
          this: an append-only transcript where new entries arrive at the end, and it is
          what makes a message that lands while somebody is looking elsewhere announced
          without stealing the caret out of whatever they are typing in. The live region
          is the THREAD and not each bubble — a per-bubble region would announce five
          things at once when a thread opens. */}
      <div
        className="messages-thread"
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {loading && <p className="messages-note">Loading the conversation…</p>}
        {!loading && rows.length === 0 && (
          <p className="messages-note">
            No messages yet. Anything you send here is kept until it is read.
          </p>
        )}

        {hasMore && (
          <p className="messages-note messages-note--more">
            Earlier messages are not shown. Everything from here on is.
          </p>
        )}

        {rows.map((row) =>
          row.kind === 'day' ? (
            <p className="messages-day" key={row.key}>{row.label}</p>
          ) : (
            <MessageLine key={row.key} message={row.message} peerInfo={peerInfo} />
          )
        )}

        {peerTyping && <TypingLine peerInfo={peerInfo} />}

        {/* THE WAY BACK DOWN. Auto-follow has paused because somebody scrolled up, and
            messages have arrived since — so the panel owes them both a notice and a
            one-press route to it. Without this, pausing would mean silently withholding
            a colleague's words, which is worse than the jumpiness it was fixing. */}
        {paused && missed > 0 && (
          <button type="button" className="messages-jump" onClick={jumpToNewest}>
            {missed === 1 ? '1 new message' : `${missed} new messages`}
            {/* An escape, in a JS string, because a bare `\u2193` in JSX text is SIX
                LITERAL CHARACTERS rather than an arrow — the one place this file's own
                tests would not have caught it, since the count of the pill is what is
                asserted and the arrow is what is read. */}
            {'\u2193'}
          </button>
        )}
      </div>

      <form
        className="messages-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSend();
        }}
      >
        <label className="messages-visually-hidden" htmlFor="messages-draft">
          Message {peerName}
        </label>
        <div className="messages-composer-row">
          <textarea
            id="messages-draft"
            ref={composerRef}
            className="messages-draft"
            rows={1}
            value={draft}
            placeholder={`Message ${peerName}…`}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_BODY * 2}
          />
          {/* A ROUND PAPER PLANE, and its name is on the element rather than in it: the
              word "Send" is one every eye has to read on every message, and the icon is
              one the hand learns once. Disabled while there is nothing to send — the
              button's own state says what the composer's rule is, which is a better
              answer than a refusal after the press. */}
          <button
            type="submit"
            className="messages-send"
            disabled={!canSubmit}
            aria-label={sending ? 'Sending message' : 'Send message'}
            title={sending ? 'Sending…' : 'Send'}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12l16-8-6 16-3.5-6.5L4 12z" />
            </svg>
          </button>
        </div>
        <div className="messages-composer-foot">
          {/* The counter appears only near the limit — a character count on every
              message is noise about a rule nobody is close to breaking. */}
          <span className={`messages-count${nearLimit ? ' is-near' : ''}`}>
            {nearLimit ? `${trimmed.length}/${MAX_BODY}` : ''}
          </span>
        </div>
      </form>

      {/* ONE LINE, and only when there is something to say: the server's own sentence
          for a refusal, or the failure of the request itself. */}
      {(error || bodyError) && (
        <p className="messages-error" role="status">{error || bodyError}</p>
      )}
    </>
  );
}

/** Every conversation, newest first, with the mark that says which are waiting. */
export function ConversationListView({ conversations = [], loading = false, error = false, onOpen, onNew }) {
  return (
    <div className="messages-list">
      <button type="button" className="messages-new" onClick={onNew}>
        New message
      </button>

      {loading && <p className="messages-note">Loading messages…</p>}

      {!loading && conversations.length === 0 && (
        <p className="messages-note">
          {error
            ? 'Messages could not be read just now.'
            : 'No messages yet. Start one with any colleague — the rail shows who is around.'}
        </p>
      )}

      <ul className="messages-rows">
        {conversations.map((conversation) => (
          <li key={conversation.peer.id}>
            <button
              type="button"
              className={`messages-row${conversation.unread > 0 ? ' has-unread' : ''}`}
              onClick={() => onOpen(conversation.peer.id, conversation.peer)}
            >
              <Avatar user={conversation.peer} className="messages-row-face" />
              <span className="messages-row-text">
                <span className="messages-row-name">
                  {conversation.peer.full_name}
                  {conversation.unread > 0 && (
                    <span className="messages-row-count">{conversation.unread}</span>
                  )}
                </span>
                <span className="messages-row-preview">
                  {/* "You:" on your own last words, so a row with no mark on it still
                      reads as a conversation rather than as a statement somebody made
                      at you. */}
                  {conversation.last.mine && <span className="messages-row-you">You: </span>}
                  {previewOf(conversation.last.body)}
                </span>
              </span>
              <span className="messages-row-time">{lastSeenLabel(conversation.last)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Everybody who can be messaged, filtered by name, badge or role. */
export function ContactPickerView({ contacts = [], filter = '', loading = false, onFilter, onPick }) {
  const needle = filter.trim().toLowerCase();
  const shown = needle === ''
    ? contacts
    : contacts.filter((contact) =>
        `${contact.full_name} ${contact.badge_number} ${contact.role}`.toLowerCase().includes(needle)
      );

  return (
    <div className="messages-picker">
      <input
        type="text"
        className="messages-filter"
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        placeholder="Search by name or badge…"
        aria-label="Search colleagues"
        autoFocus
      />
      {loading && <p className="messages-note">Loading colleagues…</p>}
      {!loading && shown.length === 0 && (
        <p className="messages-note">
          {contacts.length === 0
            ? 'There is nobody else on the station to message.'
            : 'Nobody on the station matches that.'}
        </p>
      )}
      <ul className="messages-contacts">
        {shown.map((contact) => (
          <li key={contact.id}>
            <button type="button" className="messages-contact" onClick={() => onPick(contact)}>
              <Avatar user={contact} className="messages-contact-face" />
              <span className="messages-contact-text">
                <span className="messages-contact-name">{contact.full_name}</span>
                <span className="messages-contact-meta">
                  {contact.role}
                  {contact.badge_number ? ` · Badge ${contact.badge_number}` : ''}
                </span>
              </span>
              {/* Who is at a desk, from the same two-minute window the rail uses — so
                  the panel and the corner cannot disagree about who is around. */}
              {contact.online && <span className="messages-contact-online">Online</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The container: state, requests, and the dock.
// ---------------------------------------------------------------------------

/**
 * The panel.
 *
 * `peer` is an ID or null: the panel resolves the colleague from whatever the server
 * last said about them (the thread's own `peer`), falling back to the object it was
 * handed while the first load is in flight — so a thread opened from a chathead draws
 * that person's face immediately rather than after a round trip.
 *
 * EVERY THREAD COMES FROM THE SERVER. There is one path here — the read, the poll and
 * the seen-mark — and no second one for a conversation drawn from invented data. See
 * the note at the top of this file on what that rules out.
 */
export default function MessagesPanel({
  peer = null,
  peerHint = null,
  onOpenPeer,
  onClose,
  onUnreadChange,
  onConnError,
}) {
  // null means "not read yet"; [] means "read, and empty". The difference is the whole
  // of the panel's loading state, and collapsing the two would make a fresh account
  // flash an empty box before its (also empty) list arrived.
  const [conversations, setConversations] = useState(null);
  const [thread, setThread] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [picker, setPicker] = useState(false);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  // Whether THEY are writing to me, from the thread read. Nothing here is inferred or
  // cached: it is the server's answer to a question the server alone can answer, and it
  // goes out with the conversation it belongs to.
  const [peerTyping, setPeerTyping] = useState(false);
  // Folding the window down to its title bar. Kept here rather than in Shell because it
  // is a property of the window, not of which conversation is open — and because Shell
  // mounting and unmounting this component is what "closed" already means.
  const [minimized, setMinimized] = useState(false);
  // Kept apart from `conversations === []`, because an empty list and a list that
  // could not be read are two different sentences to an officer — the first needs a
  // colleague to message, the second needs the LAN.
  const [listError, setListError] = useState(false);

  // WHICH COLLEAGUE, narrowed to one number once and declared above every effect that
  // depends on it. This is not tidiness: a hook's dependency array is evaluated during
  // the render that calls it, so an effect placed above this line would read `peerId`
  // in its own temporal dead zone and throw on the first paint.
  const peerId = peer === null || peer === undefined ? null : Number(peer);

  const peerInfo = thread?.peer ?? (Number(peerHint?.id) === peerId ? peerHint : null);

  // THE POLL'S RATE, HELD IN A REF SO THAT CHANGING IT DOES NOT RESTART THE THREAD. The
  // effect that owns the conversation reads this on every turn; if the rate were a
  // dependency of that effect instead, every keystroke in the composer would tear the
  // thread down and re-read it from the server — which is the exact opposite of what a
  // faster poll is for. Declared above that effect so the first turn already has the
  // right value: an idle, freshly-opened thread hangs at the resting rate.
  const pollMsRef = useRef(threadPollMs());
  useEffect(() => {
    pollMsRef.current = threadPollMs({ peerTyping, draft });
  }, [peerTyping, draft]);

  // IT PUBLISHES NOTHING AND RESERVES NOTHING. This used to be a docked panel: it set
  // `body.messages-panel-open` and the workspace gave up its width with a margin-right.
  // It is a floating window in the corner now — the rail's neighbour, not a stripe out
  // of the register — so there is no body class, no width to announce, and no reflow to
  // keep in step. The only thing that decides where it sits is `.dash-dock` in Shell.

  // ESCAPE CLOSES. A PRESS OUTSIDE DOES NOT, and that is inherited from the dock it
  // used to be, where the reason was that this panel is WRITTEN IN: an officer reads
  // the report a message is about and types a reply while looking at both, so a box
  // that shut on the next click in the workspace would close every time they went to
  // check a detail. It matters more now, not less — the box floats over the workspace,
  // so the press that would dismiss it is a press on the work underneath.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ---- which screen the box is showing ---------------------------------------
  //
  // ONE WINDOW, THREE SCREENS, and the title bar is the window's rather than the
  // screen's. `peer` is the only thing that decides: null is the list (or the picker,
  // which is a mode of the list), an id is that conversation.
  const screen = peerId !== null ? 'thread' : picker ? 'picker' : 'list';
  const title = screen === 'thread'
    ? (peerInfo?.full_name || 'Colleague')
    : screen === 'picker' ? 'New message' : 'Messages';
  // The thread's second line is the peer's role and badge. On the other two screens
  // there is nothing to say: "Messages" is its own explanation, and the picker's search
  // box below is the other half of "New message".
  const subtitle = screen === 'thread'
    ? [peerInfo?.role, peerInfo?.badge_number ? `Badge ${peerInfo.badge_number}` : null]
        .filter(Boolean)
        .join(' · ')
    : '';

  // Back always returns to the LIST, from either screen that has one behind it —
  // a thread opened from a chathead included. It is where the next somebody is.
  const goBack = () => {
    setPicker(false);
    onOpenPeer(null);
  };

  // ---- the conversation list -------------------------------------------------
  const loadList = useCallback(async () => {
    try {
      const data = await api('/messages');
      setConversations(Array.isArray(data?.conversations) ? data.conversations : []);
      setListError(false);
      onUnreadChange?.(Number(data?.unread_total) || 0);
    } catch (err) {
      setConversations([]);
      setListError(true);
      // A failure here is the workspace's problem rather than this panel's: the banner
      // Shell already shows says what to do about a LAN that has gone away, and a
      // second complaint inside a panel would be the same sentence twice.
      if (isUnreachable(err)) onConnError?.(err);
    }
  }, [onConnError, onUnreadChange]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ---- the thread ------------------------------------------------------------
  useEffect(() => {
    // No open conversation: there is nothing to read, and the thread from the one that
    // was open is dropped rather than left to reappear behind the list.
    if (peerId === null) {
      setThread(null);
      setPeerTyping(false);
      return undefined;
    }

    let alive = true;
    setThread(null);
    setError(null);
    // AND THE DOTS GO WITH IT. Switching conversations must not carry the last one's
    // "they are typing" across — the stamp belongs to a pair of accounts, and the pair
    // has just changed. The next read of the new thread states the truth either way.
    setPeerTyping(false);

    const load = async () => {
      try {
        const data = await api(`/messages/${peerId}`);
        if (!alive) return null;
        setThread((held) => ({
          ...data,
          // A poll must not throw away a message the sender just appended: the two
          // reads overlap by a second or so, and merging by id is what stops a
          // sentence appearing twice or vanishing.
          messages: mergeThread(held?.peer?.id === data?.peer?.id ? held.messages : [], data?.messages),
        }));
        setPeerTyping(Boolean(data?.peer_typing));
        return data;
      } catch (err) {
        if (!alive) return null;
        if (isUnreachable(err)) onConnError?.(err);
        setError(err?.message || 'That conversation could not be opened.');
        return null;
      }
    };

    // THE FIRST LOAD IS ALSO WHAT MARKS THE THREAD READ, and it says WHICH messages it
    // is marking: the newest id it just put on screen. Not "now" — a message that
    // arrives during this request must not be marked seen without ever having been
    // drawn, which is the same rule the notification bell's watermark follows.
    load().then((data) => {
      if (!alive || !data) return;
      const newest = Math.max(0, ...(data.messages ?? []).map((m) => Number(m.id)));
      if (Number(data.unread) > 0 && newest > 0) {
        api(`/messages/${peerId}/seen`, { method: 'POST', body: { up_to: newest } })
          .then((res) => onUnreadChange?.(Number(res?.unread_total) || 0))
          .catch(() => {
            // Best-effort: the mark will be made on the next visit. Failing to clear a
            // count is not worth a sentence over somebody's conversation.
          });
      }
    });

    // THE POLL: only while the tab is being looked at, and only the thread that is open.
    //
    // A CHAIN OF TIMEOUTS RATHER THAN AN INTERVAL, and the rate is read from a ref on
    // every turn. Both halves are load-bearing. An interval fires on a schedule that does
    // not know whether the last request came back, so a station PC having a slow moment
    // quietly stacks up overlapping reads of the same thread; this one cannot overlap,
    // because the next turn is only scheduled once the previous has finished. And because
    // the delay is read fresh each time, the rate can follow the conversation — see
    // threadPollMs — without tearing down and rebuilding the effect that owns the thread,
    // which would reload it on every keystroke.
    let timer = null;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) await load();
        if (alive) schedule();
      }, pollMsRef.current);
    };
    schedule();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [peerId, onConnError, onUnreadChange]);

  // ---- telling the other end that somebody is writing -------------------------
  //
  // KEYSTROKES ARE THE CLOCK, and there is no interval here on purpose. A ping sent on a
  // timer would keep saying "still typing" for as long as a draft sat in the box — so a
  // half-written reply left on screen over lunch would show three dots to a colleague all
  // afternoon. A ping sent when characters ARRIVE stops the moment they stop, which is
  // the only moment the claim becomes false, and the server's window retires it a few
  // seconds later.
  //
  // The throttle is then a matter of arithmetic rather than of scheduling: each keystroke
  // re-runs this effect, and it writes at most once per TYPING_PING_MS. A steady typist
  // re-stamps about every two and a half seconds; a single character followed by silence
  // announces itself once and expires.
  //
  // IT IS BEST-EFFORT AND SILENT. A typing signal that failed to send is not a fact
  // anybody needs told — the message itself is the thing that matters, it is sent by a
  // different request, and the only consequence of a lost ping is that a colleague does
  // not see three dots. Reporting that as an error would put a fault message in a thread
  // about nothing.
  const lastPingRef = useRef(0);
  useEffect(() => {
    lastPingRef.current = 0;
  }, [peerId]);

  useEffect(() => {
    if (peerId === null) return undefined;
    if (!shouldAnnounceTyping({ draft, sending })) return undefined;

    const now = Date.now();
    if (now - lastPingRef.current < TYPING_PING_MS) return undefined;
    lastPingRef.current = now;

    api(`/messages/${peerId}/typing`, { method: 'POST' }).catch(() => {});

    return undefined;
  }, [draft, sending, peerId]);

  // ---- the contacts picker ---------------------------------------------------
  useEffect(() => {
    if (!picker || contacts !== null) return undefined;
    let alive = true;

    api('/messages/contacts')
      .then((data) => {
        if (alive) setContacts(Array.isArray(data?.contacts) ? data.contacts : []);
      })
      .catch((err) => {
        if (!alive) return;
        setContacts([]);
        if (isUnreachable(err)) onConnError?.(err);
      });

    return () => {
      alive = false;
    };
  }, [picker, contacts, onConnError]);

  const send = useCallback(async () => {
    if (!canSend(draft) || sending || peerId === null) return;

    setSending(true);
    setError(null);
    try {
      const data = await api('/messages', {
        method: 'POST',
        body: { recipient_id: peerId, body: draft.trim() },
      });
      // What the SERVER stored — id, clock and all — rather than a local guess that
      // would then have to be reconciled with the next poll.
      setThread((held) => (held ? { ...held, messages: mergeThread(held.messages, data?.message) } : held));
      setDraft('');
      loadList();
    } catch (err) {
      if (isUnreachable(err)) onConnError?.(err);
      setError(err?.message || 'That message could not be sent.');
    } finally {
      setSending(false);
    }
  }, [draft, sending, peerId, onConnError, loadList]);

  return (
    <aside
      className={`messages-box${minimized ? ' is-minimized' : ''}`}
      role="complementary"
      aria-label={title}
    >
      <MessagesBoxHead
        screen={screen}
        title={title}
        subtitle={subtitle}
        peerInfo={peerInfo}
        minimized={minimized}
        onBack={goBack}
        onNew={() => setPicker(true)}
        onMinimize={() => setMinimized((held) => !held)}
        onClose={onClose}
      />

      {peerId !== null ? (
        <MessageThreadView
          peerId={peerId}
          peerInfo={peerInfo}
          messages={thread?.messages ?? []}
          loading={thread === null}
          hasMore={Boolean(thread?.has_more)}
          error={error}
          draft={draft}
          sending={sending}
          peerTyping={peerTyping}
          onDraft={setDraft}
          onSend={send}
        />
      ) : picker ? (
        <ContactPickerView
          contacts={contacts ?? []}
          filter={filter}
          loading={contacts === null}
          onFilter={setFilter}
          onPick={(contact) => {
            setPicker(false);
            onOpenPeer(contact.id, contact);
          }}
        />
      ) : (
        <ConversationListView
          conversations={conversations ?? []}
          loading={conversations === null}
          error={listError}
          onOpen={onOpenPeer}
          onNew={() => setPicker(true)}
        />
      )}
    </aside>
  );
}
