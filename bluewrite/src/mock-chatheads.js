// BlueWrite — the mock roster: a design preview for the presence rail.
//
// WHY THIS FILE EXISTS. The rail is a live roster of other people, so on a
// development machine it is usually EMPTY: the way to fill it is a second browser
// with a second account, and the way to fill it with nine faces is nine accounts.
// That makes the rail impossible to design against — every question worth asking
// about it ("does a role read next to a badge?", "where does the card land on the
// last circle before the corner?", "what does a second column look like?") needs a
// full one to look at.
//
// So this is a set of invented officers, shown in the rail on request so the design
// can be worked on and argued about without a cast of real accounts behind it.
//
// ON BY DEFAULT IN DEV, OFF IN EVERY BUILD. `Chatheads` only reaches this list when
// `import.meta.env.DEV` is true, and Vite replaces that with `false` at build time —
// so a shipped bundle shows no mock officer whatever the URL says. In dev it is what
// the rail draws unless the URL asks for the real one (`?chatheads=off`), which is
// the only way to check that REAL presence still works.
//
// The default flipped on purpose. This started as an opt-in behind
// `?chatheads=preview`, on the theory that an explicit request is safer than
// something that simply appears — and what that actually produced was invisibility:
// the rail was empty on every dev machine, indistinguishable from a feature that had
// never been built. A design preview you have to remember a query string to see is
// one nobody sees.
//
// THE FACES ARE INVENTED; THE SHAPES ARE NOT. Every entry is drawn from the shapes
// the SERVER can actually send, which is narrower than it looks:
//
//   * `role` is only ever 'Admin', 'Officer' or 'Staff' — those three rows are the
//     whole of the roles table, so a mock titled "Desk Sergeant" would be a design
//     for a state this system cannot produce.
//   * `badge_number` is NOT NULL UNIQUE on users, so every real roster entry has
//     one. The client drops the field when it is falsy (that branch is defensive,
//     not ordinary), and no mock here exercises it, because a preview of a state
//     that cannot occur is a preview that misleads.
//   * `photo_url` is `/api/v1/users/:id/photo?v=…` in reality. THE ONE PHOTOGRAPH
//     HERE IS AN INLINE DATA URI instead, and deliberately: the point is to see a
//     face in a circle without shipping a JPEG, and there is no real account whose
//     picture can stand in. It is an SVG, which the SERVER would refuse as an
//     upload (AvatarPhoto admits three raster formats) — this is a URL the browser
//     is handed, never a file that gets stored, and it lives only in dev.
//
// WHAT THE SET COVERS, ON PURPOSE. Twelve entries, at different ages, so one
// preview answers the questions that come up while designing:
//
//   * a photograph, and initials — the two halves of `Avatar`;
//   * every role, so the card's second line is seen at its longest;
//   * a name long enough to take the card's 232px to two lines;
//   * `idle_seconds` from 4 to 1,900, so "just now" and "31m ago" both appear;
//   * an entry with NO ages at all — the legacy/unreadable row the client keeps on
//     purpose, which draws "Signed in" with no duty line;
//   * twelve circles, which is more than `max-height` holds on most screens, so the
//     preview shows the SECOND COLUMN as well as the stack.

/** Ids are reserved far above anything AUTO_INCREMENT will reach on a station. */
const ID_BASE = 9001;

/**
 * A head-and-shoulders placeholder, URL-encoded SVG rather than base64 so it stays
 * readable in the source. `img-src 'self' data:` is allowed by the deployment's CSP
 * (docs/PHASE4_DASHBOARD.md), so this renders as a photograph does.
 */
const MOCK_PHOTO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E" +
  "%3Crect width='64' height='64' fill='%235C7FB5'/%3E" +
  "%3Ccircle cx='32' cy='24' r='11' fill='%23EDF1F8'/%3E" +
  "%3Cpath d='M9 64c0-13 11-21 23-21s23 8 23 21z' fill='%23EDF1F8'/%3E%3C/svg%3E";

/**
 * The preview roster, in the shape `PresenceController::present()` returns.
 *
 * `username` is carried because the real payload carries it (nothing draws it), and
 * `login_age_seconds` is an AGE rather than a timestamp for the same reason it is on
 * the wire: the client has no clock it is allowed to trust.
 */
export const MOCK_CHATHEADS = [
  {
    id: ID_BASE,
    full_name: 'Maria Santos',
    username: 'm.santos',
    role: 'Officer',
    badge_number: '4417',
    idle_seconds: 4,
    login_age_seconds: 7200,
    photo_url: MOCK_PHOTO,
  },
  {
    id: ID_BASE + 1,
    full_name: 'Juan Dela Cruz',
    username: 'j.delacruz',
    role: 'Officer',
    badge_number: '2208',
    idle_seconds: 65,
    login_age_seconds: 300,
    photo_url: null,
  },
  {
    id: ID_BASE + 2,
    full_name: 'Elena Ramos',
    username: 'e.ramos',
    role: 'Staff',
    badge_number: '3312',
    idle_seconds: 1500,
    login_age_seconds: 28800,
    photo_url: null,
  },
  // Long enough to wrap the card's 232px onto a second line — and to show what the
  // initials rule does with four name parts.
  {
    id: ID_BASE + 3,
    full_name: 'Bartolome Villanueva Santiago',
    username: 'b.villanueva',
    role: 'Admin',
    badge_number: '1002',
    idle_seconds: 900,
    login_age_seconds: 3600,
    photo_url: null,
  },
  // No ages at all: the server sent no `idle_seconds` and no `login_age_seconds`.
  // The rail keeps this entry and the card answers without either line.
  {
    id: ID_BASE + 4,
    full_name: 'Ramon Bautista',
    username: 'r.bautista',
    role: 'Officer',
    badge_number: '5540',
    photo_url: null,
  },
  {
    id: ID_BASE + 5,
    full_name: 'Grace Aquino',
    username: 'g.aquino',
    role: 'Staff',
    badge_number: '6125',
    idle_seconds: 20,
    login_age_seconds: 900,
    photo_url: null,
  },
  {
    id: ID_BASE + 6,
    full_name: 'Nathaniel Evangelista',
    username: 'n.evangelista',
    role: 'Admin',
    badge_number: '1007',
    idle_seconds: 180,
    login_age_seconds: 21600,
    photo_url: null,
  },
  {
    id: ID_BASE + 7,
    full_name: 'Paulo Mendoza',
    username: 'p.mendoza',
    role: 'Officer',
    badge_number: '7781',
    idle_seconds: 420,
    login_age_seconds: 10800,
    photo_url: null,
  },
  {
    id: ID_BASE + 8,
    full_name: 'Kristine Delos Reyes',
    username: 'k.delosreyes',
    role: 'Staff',
    badge_number: '8260',
    idle_seconds: 1900,
    login_age_seconds: 14400,
    photo_url: null,
  },
  {
    id: ID_BASE + 9,
    full_name: 'Fernando Lim',
    username: 'f.lim',
    role: 'Officer',
    badge_number: '4419',
    idle_seconds: 75,
    login_age_seconds: 600,
    photo_url: null,
  },
  {
    id: ID_BASE + 10,
    full_name: 'Andrea Castillo',
    username: 'a.castillo',
    role: 'Staff',
    badge_number: '9084',
    idle_seconds: 30,
    login_age_seconds: 1200,
    photo_url: null,
  },
  {
    id: ID_BASE + 11,
    full_name: 'Miguel Torres',
    username: 'm.torres',
    role: 'Officer',
    badge_number: '3357',
    idle_seconds: 240,
    login_age_seconds: 5400,
    photo_url: null,
  },
];

// ---------------------------------------------------------------------------
// The mock conversation
// ---------------------------------------------------------------------------
//
// WHY A CIRCLE HAS TO LEAD SOMEWHERE. A chathead's whole job is to open a
// conversation, and the mock roster cannot do that honestly: there is no account
// behind an invented officer, so a press would open a thread that fails on its first
// request. The first attempt at this drew the mock faces as plain marks instead —
// not controls at all — and the result was worse than the problem: the primary
// interaction of the whole feature was untestable in the one environment it is most
// often used in (a dev machine with a single account signed in, where the REAL rail
// is empty). "Cannot click the chatheads" is what that costs.
//
// So the preview DOES open a conversation, and every word in it is invented. What
// makes that honest rather than deceptive is that it is composed to the shape the
// controller sends, it is marked as a preview in the panel, and NOTHING IN IT CAN
// REACH THE SERVER — no thread read, no poll, no seen-mark, and a composer that
// cannot be submitted. The panel draws it; the API never hears about it.
//
// COMPOSED RELATIVE TO NOW, like a real conversation, rather than baked with fixed
// ages. A canned `sent_label` of "15:22" next to an age of "3h ago" is a preview that
// contradicts itself the moment somebody looks at both, and the whole point of this
// cast is that the shapes are real even though the people are not. `nowMs` is a
// parameter so a test can pin the clock and read the result.

/**
 * What a conversation is made of. Each entry is an offset into the past, in seconds,
 * and a direction — `mine` false means the colleague said it.
 *
 * The exchange is deliberately the kind of thing two officers actually send: a
 * document handed to evidence, a statement waiting on a signature, a time somebody
 * will come back. It spans TWO DAYS on purpose, because the day heading in a thread
 * appears once per day and a preview with one day in it never shows the thing that
 * is easiest to get wrong.
 */
const EXCHANGE = [
  { age_seconds: 105000, mine: false, body: 'Sarge, the CCTV copy for the San Roque break-in is with evidence — log number 2291.' },
  { age_seconds: 104400, mine: true, body: 'Noted. I will pull it up before the shift briefing.' },
  { age_seconds: 12600, mine: false, body: 'Did the complainant come back to sign her statement?' },
  { age_seconds: 12300, mine: true, body: 'Not until after lunch. I will message you the moment she arrives.' },
];

/** Midnight before `ms` — the boundary the server groups its days by. */
function startOfDay(ms) {
  const d = new Date(ms);

  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The server's own two buckets, from the server's own rule (`dayGroup`): today,
 * yesterday, and everything older is a date.
 *
 * It is recomputed here rather than imported because the PHP is not reachable from the
 * browser; what keeps the two honest is that this is a MOCK of a payload, tested for
 * the same shape, and the panel still takes the day verbatim off whatever the server
 * sends in production.
 */
function dayOf(stamp, nowMs) {
  const today = startOfDay(nowMs);
  if (stamp >= today) return 'today';
  if (stamp >= today - 86400000) return 'yesterday';

  return 'earlier';
}

function dayLabelOf(group, stamp) {
  if (group === 'today') return 'Today';
  if (group === 'yesterday') return 'Yesterday';

  // Spelled out with the year, like the server's `M j, Y`: a thread is a record, and
  // "Sep 20" is two different days in two different years.
  return new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** `HH:MM`, padded, in the reader's own local time — see above on why that is right here. */
function clockOf(stamp) {
  const d = new Date(stamp);

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `YYYY-MM-DD HH:MM:SS`, the format the server timestamps carry into the tooltip. */
function stampOf(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * The conversation with one mock officer, in the shape `MessagesController::thread()`
 * returns, or **null** when the id is not a mock at all.
 *
 * That null is the whole predicate: the panel asks this function whether a peer is a
 * mock, so there is no second id-range rule that could drift out of step with the
 * roster. If it answers, the panel draws it and touches nothing else.
 *
 * `unread` is 0 and `has_more` is false. There is nothing older to fetch and nobody
 * waiting: the rail's unread marks come from the heartbeat, which has nothing to say
 * about a person who does not exist, so a mock that claimed three unread messages
 * would be a mark the rest of the rail could not explain.
 */
export function mockThreadFor(peerId, nowMs = Date.now()) {
  const id = Number(peerId);
  const peer = MOCK_CHATHEADS.find((person) => person.id === id);
  if (!peer) return null;

  const messages = EXCHANGE.map((spec, index) => {
    const stamp = nowMs - spec.age_seconds * 1000;
    const group = dayOf(stamp, nowMs);

    return {
      // Unique, numeric and ascending, so the bubble list has stable keys and the
      // order is the order they were said. Far above any real message id, the way the
      // mock ids are far above any real account's.
      id: id * 100 + index,
      body: spec.body,
      mine: spec.mine,
      age_seconds: spec.age_seconds,
      created_at: stampOf(stamp),
      sent_label: clockOf(stamp),
      day_group: group,
      day_label: dayLabelOf(group, stamp),
    };
  });

  return { peer, messages, has_more: false, unread: 0 };
}
