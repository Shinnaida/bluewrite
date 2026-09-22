<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

// The controller is required rather than reached for through the API, because the two
// numbers these tests assert against — how long a typing stamp stays fresh, and how long
// the client is asked to wait between stamps — are constants on it. A test that typed
// `6` in here would agree with the code only until the code changed.
require_once __DIR__ . '/../app/controllers/MessagesController.php';

use App\Controllers\MessagesController;

/**
 * Phase 8 — messages between officers.
 *
 * Covers the whole contract: any signed-in role may write to any active account (on
 * shift or not), a thread is readable by its two participants and nobody else, unread
 * counts follow the recipient, and marking read can only ever touch the caller's own
 * inbox.
 *
 * THE TESTS THAT MATTER MOST are the three about what a messaging feature gets wrong
 * quietly:
 *
 *   - A THREAD IS NOT A TABLE SCAN. `GET /messages/:id` must return the rows between
 *     the two accounts, in both directions, and must not leak a conversation between
 *     two OTHER officers into it. The permission here is a WHERE clause, so it is
 *     tested from a third account rather than by reading the code.
 *   - MARKING READ CANNOT BE FORGED. POST /messages/:id/seen sets `read_at` where
 *     `recipient_id = me`; an account that marks a thread it never received must
 *     change nothing. A read receipt anyone can write is a read receipt that means
 *     nothing.
 *   - THE BODY DOES NOT REACH THE AUDIT TRAIL. That log is an administrator's screen,
 *     and this system deliberately keeps private messages out of it — which is a claim
 *     about a table, so it is asserted against that table.
 *
 * THE TWO THAT CAME LATER, and both are about the other person on the line rather than
 * about the message:
 *
 *   - TYPING IS ADDRESSED, NOT BROADCAST. A stamp must be readable by the one colleague
 *     it was aimed at, invisible to everybody else — including its author — and
 *     meaningless once it is old. A typing indicator that leaks who is drafting what to
 *     an administrator would be the worst possible version of this feature.
 *   - A RECEIPT CANNOT BE FORGED. The sender may SEE that their message was read; they
 *     must not be able to CAUSE it. That is the same `WHERE recipient_id = :me` clause
 *     the unread count already rests on, asserted from the sender's own session.
 */
final class MessagesTest extends BaseApiTestCase
{
    /** The seeded accounts, by id in the test database. */
    private const ADMIN = 1;
    private const OFFICER = 2;
    private const STAFF = 3;
    private const INACTIVE = 4;

    public function testAMessageGoesBothWaysAndTheWriterIsTheSession(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');

        $sent = $this->request('POST', '/messages', [
            'recipient_id' => self::OFFICER,
            'body' => 'Bringing the blotter up, five minutes.',
        ], $staffCookie, $staffCsrf);

        $this->assertSame(201, $sent['status'], json_encode($sent['body']));
        $message = $sent['body']['message'];

        // The row as the SERVER stored it: the clock, the id, and which side of the
        // thread it is on. The client appends this rather than a guess of its own.
        $this->assertSame('Bringing the blotter up, five minutes.', $message['body']);
        $this->assertTrue($message['mine']);
        $this->assertNull($message['read_at'], 'unread until the recipient sees it');
        $this->assertIsInt($message['age_seconds']);
        $this->assertMatchesRegularExpression('/^\d{2}:\d{2}$/', $message['sent_label']);
        $this->assertSame('Today', $message['day_label']);

        // The sender cannot be chosen by the caller: it comes from the session, and no
        // field in the request can contradict it.
        $row = $this->rootPdo()->query('SELECT sender_id, recipient_id FROM messages ORDER BY id DESC LIMIT 1')->fetch();
        $this->assertSame(self::STAFF, (int) $row['sender_id']);
        $this->assertSame(self::OFFICER, (int) $row['recipient_id']);

        // Read from the other end, the same row is on the other side of the thread.
        [$offCookie] = $this->login('t.officer');
        $thread = $this->request('GET', '/messages/' . self::STAFF, null, $offCookie);

        $this->assertSame(200, $thread['status'], json_encode($thread['body']));
        $this->assertCount(1, $thread['body']['messages']);
        $this->assertFalse($thread['body']['messages'][0]['mine'], 'received, not sent');
        $this->assertFalse($thread['body']['has_more']);
        // The counterpart comes with the thread: the panel draws their face and name at
        // the top, and for somebody who has since gone offline this is the only place
        // that name can come from.
        $this->assertSame('Test Staff', $thread['body']['peer']['full_name']);
        $this->assertSame('Staff', $thread['body']['peer']['role']);
        $this->assertArrayHasKey('photo_url', $thread['body']['peer']);
        $this->assertSame(1, $thread['body']['unread']);
    }

    public function testAThreadHoldsTwoAccountsAndNobodyElse(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'For the officer.'], $staffCookie, $staffCsrf);
        $this->request('POST', '/messages', ['recipient_id' => self::ADMIN, 'body' => 'For the admin.'], $staffCookie, $staffCsrf);

        // Each participant sees only their own conversation with the same colleague.
        [$offCookie] = $this->login('t.officer');
        $withOfficer = $this->request('GET', '/messages/' . self::STAFF, null, $offCookie);
        $this->assertSame(
            ['For the officer.'],
            array_column($withOfficer['body']['messages'], 'body'),
            'a third account must not appear in a thread it is not part of'
        );

        [$adminCookie] = $this->login('t.admin');
        $withAdmin = $this->request('GET', '/messages/' . self::STAFF, null, $adminCookie);
        $this->assertSame(['For the admin.'], array_column($withAdmin['body']['messages'], 'body'));

        // …and two colleagues who have never spoken have an empty thread, not an error.
        $never = $this->request('GET', '/messages/' . self::OFFICER, null, $adminCookie);
        $this->assertSame(200, $never['status']);
        $this->assertSame([], array_column($never['body']['messages'], 'body'));
    }

    public function testSendingRequiresASessionAndAValidRecipient(): void
    {
        // The front controller's CSRF gate answers an anonymous POST (419) before any
        // controller runs — the same note as PresenceTest. What matters either way is
        // the second assertion: nothing was written.
        $anon = $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'Hello.']);
        $this->assertSame(419, $anon['status']);
        $this->assertSame(0, (int) $this->rootPdo()->query('SELECT COUNT(*) FROM messages')->fetchColumn());

        [$cookie, $csrf] = $this->login('t.staff');

        // An empty message is not a message. Whitespace-only is the same failure: the
        // body is trimmed before it is stored, so " " would otherwise be a row that
        // draws as a blank bubble.
        foreach (['', '   ', "\n\t"] as $empty) {
            $res = $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => $empty], $cookie, $csrf);
            $this->assertSame(422, $res['status'], json_encode($res['body']));
            $this->assertSame('Write a message first.', $res['body']['error']);
        }

        // The column holds 1000 characters; one more is refused with the number in it.
        $res = $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => str_repeat('a', 1001)], $cookie, $csrf);
        $this->assertSame(422, $res['status']);
        $this->assertStringContainsString('1000', (string) $res['body']['error']);
        // …and 1000 exactly is accepted, which is the boundary the sentence names.
        $this->assertSame(201, $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => str_repeat('b', 1000)], $cookie, $csrf)['status']);

        // Yourself is not a correspondent.
        $self = $this->request('POST', '/messages', ['recipient_id' => self::STAFF, 'body' => 'Note to self.'], $cookie, $csrf);
        $this->assertSame(422, $self['status']);
        $this->assertStringContainsString('yourself', (string) $self['body']['error']);
        $this->assertSame(0, (int) $this->rootPdo()->query("SELECT COUNT(*) FROM messages WHERE body = 'Note to self.'")->fetchColumn());
    }

    public function testAnAccountThatCannotReadAMessageCannotBeWrittenTo(): void
    {
        [$cookie, $csrf] = $this->login('t.staff');

        // Nobody with that id.
        $missing = $this->request('POST', '/messages', ['recipient_id' => 9999, 'body' => 'Hello?'], $cookie, $csrf);
        $this->assertSame(404, $missing['status'], json_encode($missing['body']));

        // A deactivated account cannot sign in, so a message to one would sit in a table
        // nobody can read. It is refused with the SAME sentence as a missing id on
        // purpose: two different answers would make this route a way to enumerate which
        // accounts exist.
        $inactive = $this->request('POST', '/messages', ['recipient_id' => self::INACTIVE, 'body' => 'Hello?'], $cookie, $csrf);
        $this->assertSame(404, $inactive['status']);
        $this->assertSame($missing['body']['error'], $inactive['body']['error']);

        // …and the same for reading a thread with either of them.
        $this->assertSame(404, $this->request('GET', '/messages/9999', null, $cookie)['status']);
        $this->assertSame(404, $this->request('GET', '/messages/' . self::INACTIVE, null, $cookie)['status']);
        // An account messaging itself is nobody, from this side too.
        $this->assertSame(404, $this->request('GET', '/messages/' . self::STAFF, null, $cookie)['status']);
    }

    public function testUnreadFollowsTheRecipientAndTheHeartbeatCarriesIt(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'One.'], $staffCookie, $staffCsrf);
        $second = $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'Two.'], $staffCookie, $staffCsrf);
        $newestId = (int) $second['body']['message']['id'];

        // THE SENDER HAS NOTHING UNREAD: their own words are not news to them.
        $this->assertSame(0, $this->beat($staffCookie, $staffCsrf)['message_unread_total']);

        // The recipient's beat carries the marks the rail draws, per sender — a LIST of
        // {sender_id, count}, so the client never has to guess whether an id-keyed map
        // arrived as an object or as a list.
        [$offCookie, $offCsrf] = $this->login('t.officer');
        $beat = $this->beat($offCookie, $offCsrf);
        $this->assertSame(2, $beat['message_unread_total']);
        $this->assertSame(
            [['sender_id' => self::STAFF, 'count' => 2]],
            $beat['message_unread'],
            'the count is per sender, so it can be drawn on that colleague\'s chathead'
        );
        // The roster and the marks arrive in ONE payload, which is the reason they cannot
        // disagree about who is on screen.
        $this->assertNotEmpty($beat['online']);

        // SEEN, UP TO THE ID THAT WAS ACTUALLY ON SCREEN. One of the two is marked, so
        // one remains — and the message that arrived after the page was read is still
        // unread, which is the whole point of naming an id instead of saying "now".
        $seen = $this->request('POST', '/messages/' . self::STAFF . '/seen', ['up_to' => $newestId - 1], $offCookie, $offCsrf);
        $this->assertSame(200, $seen['status'], json_encode($seen['body']));
        $this->assertSame(1, $seen['body']['unread']);
        $this->assertSame(1, $seen['body']['unread_total']);

        // Without `up_to`, everything from that counterpart is read — which is what a
        // panel that has just loaded a whole thread can honestly claim.
        $all = $this->request('POST', '/messages/' . self::STAFF . '/seen', null, $offCookie, $offCsrf);
        $this->assertSame(0, $all['body']['unread']);
        $this->assertSame(0, $all['body']['unread_total']);
        $this->assertSame(2, (int) $this->rootPdo()->query('SELECT COUNT(*) FROM messages WHERE read_at IS NOT NULL')->fetchColumn());

        // And the thread agrees: every message now carries when it was read.
        $thread = $this->request('GET', '/messages/' . self::STAFF, null, $offCookie);
        foreach ($thread['body']['messages'] as $message) {
            $this->assertNotNull($message['read_at'], 'read is a timestamp, not a flag');
        }
    }

    public function testMarkingReadCanOnlyTouchYourOwnInbox(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'Unread on purpose.'], $staffCookie, $staffCsrf);

        // The ADMIN marks the thread between the staff account and the officer. It is
        // not their inbox, so nothing may change — this is the one write in the feature
        // that names other people's rows, and it is fenced by `recipient_id = me`.
        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $marked = $this->request('POST', '/messages/' . self::STAFF . '/seen', null, $adminCookie, $adminCsrf);
        $this->assertSame(200, $marked['status']);
        $this->assertSame(
            1,
            (int) $this->rootPdo()->query('SELECT COUNT(*) FROM messages WHERE read_at IS NULL')->fetchColumn(),
            'the officer\'s unread message is still unread'
        );
        $this->assertSame(0, $marked['body']['unread_total'], 'the admin has nothing unread');

        // The recipient's own mark is the one that counts.
        [$offCookie, $offCsrf] = $this->login('t.officer');
        $this->request('POST', '/messages/' . self::STAFF . '/seen', null, $offCookie, $offCsrf);
        $this->assertSame(0, (int) $this->rootPdo()->query('SELECT COUNT(*) FROM messages WHERE read_at IS NULL')->fetchColumn());
    }

    public function testTheConversationListIsNewestFirstWithItsUnreadCounts(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        [$offCookie, $offCsrf] = $this->login('t.officer');

        // Four messages in two conversations, arranged so the newest conversation is the
        // one written to LAST rather than the one with the most in it.
        $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'One.'], $staffCookie, $staffCsrf);
        $this->request('POST', '/messages', ['recipient_id' => self::ADMIN, 'body' => 'Two.'], $staffCookie, $staffCsrf);
        $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'Three.'], $staffCookie, $staffCsrf);
        $this->request('POST', '/messages', ['recipient_id' => self::STAFF, 'body' => 'Four, from the officer.'], $offCookie, $offCsrf);

        $list = $this->request('GET', '/messages', null, $staffCookie);
        $this->assertSame(200, $list['status'], json_encode($list['body']));

        $this->assertSame(
            ['Test Officer', 'Test Admin'],
            array_column(array_column($list['body']['conversations'], 'peer'), 'full_name'),
            'the conversation written to last is first, even though the other has more in it'
        );

        $byPeer = [];
        foreach ($list['body']['conversations'] as $conversation) {
            $byPeer[$conversation['peer']['full_name']] = $conversation;
        }

        // The last message of each, with the fields the panel's list draws: what it says,
        // who said it, and how long ago — the server's clock, not the browser's.
        $this->assertSame('Four, from the officer.', $byPeer['Test Officer']['last']['body']);
        $this->assertFalse($byPeer['Test Officer']['last']['mine'], 'it came from the officer');
        $this->assertSame('Two.', $byPeer['Test Admin']['last']['body']);
        $this->assertTrue($byPeer['Test Admin']['last']['mine']);
        $this->assertIsInt($byPeer['Test Admin']['last']['age_seconds']);

        // Unread is counted per conversation FROM THE READER'S SIDE: the staff account
        // sent three of these four, so only the officer's reply is waiting for them.
        $this->assertSame(1, $byPeer['Test Officer']['unread']);
        $this->assertSame(0, $byPeer['Test Admin']['unread']);
        $this->assertSame(1, $list['body']['unread_total']);
    }

    public function testAnAccountWithNoCorrespondenceHasAnEmptyList(): void
    {
        // The state every officer starts in, and the one the panel has to draw as an
        // invitation rather than as an error or an empty box.
        [$cookie] = $this->login('t.admin');
        $list = $this->request('GET', '/messages', null, $cookie);

        $this->assertSame(200, $list['status']);
        $this->assertSame([], $list['body']['conversations']);
        $this->assertSame(0, $list['body']['unread_total']);
    }

    public function testAThreadWalksBackwardsInPages(): void
    {
        $pdo = $this->rootPdo();
        // The interval is written as a LITERAL rather than bound: MySQL does not accept
        // a placeholder inside `INTERVAL ? SECOND` (see PresenceController's note about
        // the same thing), and the value here is an int this test computed.
        for ($i = 1; $i <= 60; $i++) {
            $ago = 6000 - ($i * 60);
            $pdo->exec("INSERT INTO messages (sender_id, recipient_id, body, created_at)
                        VALUES (" . self::STAFF . ', ' . self::OFFICER . ", 'Message {$i}.', NOW() - INTERVAL {$ago} SECOND)");
        }

        [$cookie] = $this->login('t.officer');
        $page1 = $this->request('GET', '/messages/' . self::STAFF, null, $cookie);

        // A page is THREAD_PAGE messages — the newest ones, oldest-last within the page,
        // which is the order the panel draws. One extra row is read to answer "is there
        // anything older", and that row belongs to the next page rather than to this one.
        $this->assertCount(50, $page1['body']['messages']);
        $this->assertTrue($page1['body']['has_more']);
        $this->assertSame('Message 11.', $page1['body']['messages'][0]['body']);
        $this->assertSame('Message 60.', $page1['body']['messages'][49]['body']);

        // `before` is an id, not an offset: a message arriving while somebody reads must
        // not shift the page under them.
        $oldest = (int) $page1['body']['messages'][0]['id'];
        $page2 = $this->request('GET', '/messages/' . self::STAFF . '?before=' . $oldest, null, $cookie);
        $this->assertCount(10, $page2['body']['messages']);
        $this->assertFalse($page2['body']['has_more'], 'the oldest page does not claim another');
        $this->assertSame('Message 1.', $page2['body']['messages'][0]['body']);
        $this->assertSame('Message 10.', $page2['body']['messages'][9]['body']);
    }

    public function testEveryRoleCanWriteAndReadItsOwnMessages(): void
    {
        // Messaging is not a privilege — a staff account may address a colleague, and the
        // contacts list is the shortest thing that makes that possible rather than the
        // user administration view (which stays admin-only: tests/RbacTest.php).
        foreach (['t.admin' => self::STAFF, 't.officer' => self::STAFF, 't.staff' => self::OFFICER] as $username => $to) {
            [$cookie, $csrf, $user] = $this->login($username);

            $sent = $this->request('POST', '/messages', ['recipient_id' => $to, 'body' => "Hello from {$username}."], $cookie, $csrf);
            $this->assertSame(201, $sent['status'], "{$username} must be able to send: " . json_encode($sent['body']));

            $mine = $this->request('GET', '/messages', null, $cookie);
            $this->assertSame(200, $mine['status']);
            $this->assertContains(
                $to,
                array_column(array_column($mine['body']['conversations'], 'peer'), 'id'),
                'every role reads its own conversation list'
            );

            $thread = $this->request('GET', '/messages/' . $to, null, $cookie);
            $this->assertSame(200, $thread['status']);
            // The LAST message in the thread is the one just sent. (Not the first: two
            // of these roles have already written to each other earlier in this loop,
            // so the thread is not one message long by the time we get here.)
            $bodies = array_column($thread['body']['messages'], 'body');
            $this->assertContains("Hello from {$username}.", $bodies);
            $this->assertSame("Hello from {$username}.", end($bodies));
            $this->assertTrue($thread['body']['messages'][count($bodies) - 1]['mine'], 'their own message reads as sent');
            // The counterpart travels with the thread, named and pictured — which is the
            // only place an offline colleague's face can come from.
            $this->assertSame((int) $to, $thread['body']['peer']['id']);
            $this->assertNotSame('', (string) $thread['body']['peer']['full_name']);

            // The contacts list is readable by every role, and it is NOT the user
            // administration view: nobody else's address, status or sign-in state is in
            // it. This is the assertion that keeps the two from drifting together.
            $contacts = $this->request('GET', '/messages/contacts', null, $cookie);
            $this->assertSame(200, $contacts['status']);
            $this->assertNotEmpty($contacts['body']['contacts']);

            foreach ($contacts['body']['contacts'] as $contact) {
                foreach (['email', 'status', 'password_hash', 'failed_attempts', 'locked_until', 'mfa', 'languages_read', 'last_seen_at'] as $secret) {
                    $this->assertArrayNotHasKey($secret, $contact, "{$username} must not read {$secret} from contacts");
                }
                // …and the caller is not in their own address book.
                $this->assertNotSame((int) ($user['id'] ?? 0), $contact['id']);
                // An inactive account is not addressable, so it is not offered.
                $this->assertNotSame('Inactive Officer', $contact['full_name']);
                $this->assertIsBool($contact['online']);
            }
        }
    }

    public function testContactsSayWhoIsAtADeskUsingThePresenceWindow(): void
    {
        // The window is PresenceController's, read from that class rather than typed out
        // again: two copies of "two minutes" would be two answers to one question.
        $this->rootPdo()->exec("UPDATE users SET last_seen_at = NOW() - INTERVAL 10 SECOND WHERE username = 't.officer'");
        $this->rootPdo()->exec("UPDATE users SET last_seen_at = NOW() - INTERVAL 600 SECOND WHERE username = 't.admin'");

        [$cookie] = $this->login('t.staff');
        $contacts = $this->request('GET', '/messages/contacts', null, $cookie)['body']['contacts'];

        $byName = [];
        foreach ($contacts as $contact) {
            $byName[$contact['full_name']] = $contact;
        }

        $this->assertTrue($byName['Test Officer']['online'], 'seen ten seconds ago: at a desk');
        $this->assertFalse($byName['Test Admin']['online'], 'seen ten minutes ago: not');
    }

    public function testAMessageBodyNeverReachesTheAuditTrail(): void
    {
        // The audit log is an administrator's screen. A private sentence between two
        // officers must not be copied into it — the message row is the record, and that
        // is a claim about a table rather than a comment, so it is checked here.
        $secret = 'meeting the informant behind the market at seven';
        [$cookie, $csrf] = $this->login('t.staff');
        $this->assertSame(201, $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => $secret], $cookie, $csrf)['status']);

        $leaks = (int) $this->rootPdo()
            ->query("SELECT COUNT(*) FROM audit_logs WHERE detail LIKE '%informant%' OR action LIKE '%message%'")
            ->fetchColumn();

        $this->assertSame(0, $leaks, 'sending a message must not write its contents — or even an event — to the audit trail');
    }

    public function testTypingIsAddressedToOneColleagueAndStopsBeingTrueOnItsOwn(): void
    {
        $window = MessagesController::TYPING_WINDOW;
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        [$offCookie] = $this->login('t.officer');
        [$adminCookie] = $this->login('t.admin');

        // NOTHING HAS SAID IT, SO IT IS NOT TRUE. A pair with no stamp reads as "not
        // typing" rather than as unknown — there is no third answer a panel could draw.
        $quiet = $this->request('GET', '/messages/' . self::STAFF, null, $offCookie);
        $this->assertFalse($quiet['body']['peer_typing']);

        $ping = $this->request('POST', '/messages/' . self::OFFICER . '/typing', null, $staffCookie, $staffCsrf);
        $this->assertSame(200, $ping['status'], json_encode($ping['body']));

        // THE ONE COLLEAGUE IT WAS AIMED AT SEES IT…
        $aimed = $this->request('GET', '/messages/' . self::STAFF, null, $offCookie);
        $this->assertTrue($aimed['body']['peer_typing'], 'the officer is the one being written to');

        // …THE WRITER DOES NOT, because a draft is not a fact about its author…
        $theirs = $this->request('GET', '/messages/' . self::OFFICER, null, $staffCookie);
        $this->assertFalse($theirs['body']['peer_typing'], 'a draft is not visible to the person drafting it');

        // …AND A THIRD ACCOUNT SEES NOTHING AT ALL. This is the assertion that matters
        // most in this test: an administrator must not be able to tell who is writing to
        // whom, and the only thing stopping them is the direction of the WHERE clause.
        $third = $this->request('GET', '/messages/' . self::STAFF, null, $adminCookie);
        $this->assertFalse($third['body']['peer_typing'], 'a stamp aimed at one colleague is invisible to another');

        // A LATCH, NOT A LOG: the second ping rewrites the first stamp.
        $this->request('POST', '/messages/' . self::OFFICER . '/typing', null, $staffCookie, $staffCsrf);
        $rows = (int) $this->rootPdo()->query('SELECT COUNT(*) FROM message_typing')->fetchColumn();
        $this->assertSame(1, $rows, 'a second ping replaces the stamp rather than adding a row');

        // IT EXPIRES WITH NOBODY CLEANING UP. A session that died mid-sentence — or a
        // laptop that went into a bag — leaves a stamp that stops claiming anything.
        $this->rootPdo()->exec('UPDATE message_typing SET updated_at = NOW() - INTERVAL ' . ($window + 1) . ' SECOND');
        $stale = $this->request('GET', '/messages/' . self::STAFF, null, $offCookie);
        $this->assertFalse($stale['body']['peer_typing'], 'a stamp older than the window is not a claim about now');

        // AND THE MESSAGE ITSELF CLEARS IT. Three dots must not keep pulsing underneath
        // the sentence they were announcing.
        $this->request('POST', '/messages/' . self::OFFICER . '/typing', null, $staffCookie, $staffCsrf);
        $this->assertTrue(
            $this->request('GET', '/messages/' . self::STAFF, null, $offCookie)['body']['peer_typing'],
            'the fresh stamp is live again'
        );
        $this->assertSame(
            201,
            $this->request('POST', '/messages', ['recipient_id' => self::OFFICER, 'body' => 'Here.'], $staffCookie, $staffCsrf)['status']
        );
        $this->assertFalse(
            $this->request('GET', '/messages/' . self::STAFF, null, $offCookie)['body']['peer_typing'],
            'arriving is proof that the typing stopped'
        );

        // The gate is the same one sending uses: a session, a real account at the other
        // end, and not yourself.
        $anonymous = $this->request('POST', '/messages/' . self::OFFICER . '/typing');
        $this->assertContains($anonymous['status'], [401, 419], 'typing is not an anonymous act');
        $this->assertSame(404, $this->request('POST', '/messages/' . self::INACTIVE . '/typing', null, $staffCookie, $staffCsrf)['status']);
        $this->assertSame(422, $this->request('POST', '/messages/' . self::STAFF . '/typing', null, $staffCookie, $staffCsrf)['status']);
    }

    public function testTheSenderCanSeeAReadReceiptAndCannotForgeOne(): void
    {
        [$staffCookie, $staffCsrf] = $this->login('t.staff');
        [$offCookie, $offCsrf] = $this->login('t.officer');

        $sent = $this->request('POST', '/messages', [
            'recipient_id' => self::OFFICER,
            'body' => 'The statement is on your desk.',
        ], $staffCookie, $staffCsrf);
        $this->assertNull($sent['body']['message']['read_at'], 'not read the instant it is sent');

        // A SENDER CANNOT MARK THEIR OWN SENTENCE READ. `seen()` only ever touches rows
        // whose recipient is the caller, so this request clears the OTHER person's inbox
        // and must leave the sender's own message untouched — the receipt is worth
        // nothing if the person who wants it can write it.
        $this->request('POST', '/messages/' . self::OFFICER . '/seen', ['up_to' => 99], $staffCookie, $staffCsrf);
        $this->assertNull(
            $this->request('GET', '/messages/' . self::OFFICER, null, $staffCookie)['body']['messages'][0]['read_at'],
            'the sender cannot forge their own receipt'
        );

        // THE RECIPIENT READS IT, and the sender's next look at the thread says so.
        $this->assertSame(200, $this->request('POST', '/messages/' . self::STAFF . '/seen', null, $offCookie, $offCsrf)['status']);
        $thread = $this->request('GET', '/messages/' . self::OFFICER, null, $staffCookie);
        $mine = $thread['body']['messages'][0];

        $this->assertTrue($mine['mine'], 'it is the sender\u2019s own message');
        $this->assertNotNull($mine['read_at'], 'and the sender can now see that it was read');
        $this->assertSame(0, $thread['body']['unread']);
    }

    /** The heartbeat body, with the response's own success asserted first. */
    private function beat(?string $cookie, ?string $csrf): array
    {
        $res = $this->request('POST', '/presence/heartbeat', null, $cookie, $csrf);
        $this->assertSame(200, $res['status'], json_encode($res['body']));

        return $res['body'];
    }
}
