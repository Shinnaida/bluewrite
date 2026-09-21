<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Core\EmailOtp;
use App\Core\Mailer;
use App\Core\Station;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

// No autoloader in this project: the pure tests require what they use.
require_once __DIR__ . '/../app/core/Config.php';
require_once __DIR__ . '/../app/core/Station.php';
require_once __DIR__ . '/../app/core/MailUnavailableException.php';
require_once __DIR__ . '/../app/core/Mailer.php';
require_once __DIR__ . '/../app/core/EmailOtp.php';

/**
 * The sign-in message as MAIL rather than as a flow.
 *
 * EmailOtpTest covers whether a code signs somebody in; this covers the thing
 * that carries it, which no HTTP test can see the shape of. Two contracts are
 * asserted here and both are easy to break by accident:
 *
 * 1. THE PLAIN PART IS UNCHANGED IN THE ONE PLACE THAT MATTERS. The suite reads
 *    every sign-in code out of the mail log with a regex for `code is:` followed
 *    by six digits (BaseApiTestCase::lastEmailedCode). A redesign of the message
 *    that reworded or re-spaced that sentence would fail forty sign-in tests with
 *    a message about the mail log, which reads as a mail configuration problem
 *    and is not one. That sentence is therefore pinned here as a contract.
 *
 * 2. THE TWO PARTS CANNOT DISAGREE. The lifetime is asserted in both, so the day
 *    somebody edits the HTML and forgets the text, this fails rather than an
 *    officer being told two different expiry times by the same message.
 *
 * The HTML is also checked for the things it must NOT contain — a link, a remote
 * image, unescaped text from the database — because every one of those is a
 * regression that looks fine in a browser and is wrong in a mail client.
 */
final class LoginMessageTest extends TestCase
{
    /** A message for a fixture officer, from the real builder. */
    private function message(string $name = 'Maria Santos', string $to = 'm.santos@example.test'): array
    {
        return EmailOtp::loginMessage(['id' => 1, 'full_name' => $name], '482913', $to);
    }

    /** The assembled DATA payload, via the private builder the transport uses. */
    private function payload(string $body, ?string $html): string
    {
        $build = new ReflectionMethod(Mailer::class, 'message');
        $build->setAccessible(true);

        return $build->invoke(null, 'station.sender@gmail.com', 'BlueWrite', 'm.santos@example.test', 'Subject', $body, $html);
    }

    // --- both parts, always -----------------------------------------------------

    public function testTheMessageIsThreePartsAndEachOneIsPopulated(): void
    {
        $message = $this->message();

        $this->assertArrayHasKey('subject', $message);
        $this->assertArrayHasKey('body', $message);
        $this->assertArrayHasKey('html', $message, 'the HTML part must be produced unconditionally');
        $this->assertNotSame('', $message['body']);
        $this->assertNotSame('', $message['html']);
    }

    public function testTheCodeIsInTheSubjectBecauseANotificationShowsOnlyThat(): void
    {
        $this->assertStringContainsString('482913', $this->message()['subject']);
    }

    // --- the plain part is the contract the harness depends on ------------------

    public function testThePlainPartKeepsTheSentenceTheTestHarnessParses(): void
    {
        $body = $this->message()['body'];

        $this->assertSame(
            1,
            preg_match('/code is:\s*(\d{6})/i', $body, $m),
            'BaseApiTestCase::lastEmailedCode reads the code out of this sentence'
        );
        $this->assertSame('482913', $m[1]);
    }

    // --- the two parts agree with each other and with the constant --------------

    public function testBothPartsStateTheSameLifetimeTakenFromTheConstant(): void
    {
        // Not a hardcoded ten: the number in both bodies has to be the one the
        // server enforces expiry with, so the two cannot drift apart.
        $minutes = (int) (EmailOtp::TTL_SECONDS / 60);
        $message = $this->message();

        $this->assertSame(10, $minutes, 'TTL_SECONDS is the ten minutes the screen promises');
        $this->assertStringContainsString((string) $minutes, $message['body']);
        $this->assertStringContainsString((string) $minutes, $message['html']);
    }

    public function testBothPartsCarryTheCodeAndTheWarningsAnOfficerMustActOn(): void
    {
        $message = $this->message();

        foreach (['body', 'html'] as $part) {
            $this->assertStringContainsString('482913', $message[$part], $part . ' carries the code');
            $this->assertStringContainsString('administrator', $message[$part], $part . ' says what to do');
        }
    }

    // --- what the HTML must not contain --------------------------------------

    public function testTheHtmlEscapesTextThatCameFromTheDatabase(): void
    {
        // An officer's full name is administrator-supplied text, and it reaches
        // this string. Markup in it has to render as that name.
        $html = $this->message('J. Cruz <script>alert(1)</script>')['html'];

        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringContainsString('&lt;script&gt;', $html);
    }

    public function testTheHtmlHasNoLinkButtonOrRemoteImage(): void
    {
        // Deliberate, and each for its own reason: base_url is a LAN address that
        // Gmail's image proxy could never fetch, and a code mail that teaches
        // officers to click through to a sign-in page is a phishing lesson taught
        // by the system itself.
        $html = $this->message()['html'];

        $this->assertDoesNotMatchRegularExpression('/<(a|img|iframe|form)\b/i', $html);
        $this->assertStringNotContainsString('src=', $html);
    }

    public function testTheHtmlNamesTheStationItWasSentFrom(): void
    {
        // The letterhead comes from station_settings (the row the printed sheets
        // use), falling back to the system name when the install has no row yet.
        $html = $this->message()['html'];
        $station = trim((string) (Station::header()['station_name'] ?? ''));

        $this->assertNotSame('', $station);
        $this->assertStringContainsString(
            htmlspecialchars($station, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
            $html
        );
    }

    public function testTheRecipientIsNamedOnlyWhenItIsKnown(): void
    {
        // sendCode passes the address it is about to send to; a caller that does
        // not have one must not leave an empty "Sent to ." behind.
        $this->assertStringContainsString('m.santos@example.test', $this->message()['html']);
        $this->assertStringNotContainsString('Sent to .', $this->message('Maria Santos', '')['html']);
    }

    // --- the payload Mailer builds ---------------------------------------------

    public function testWithoutHtmlTheMessageIsStillASingleTextPlainPart(): void
    {
        // The shape everything had before the HTML part existed, and the shape a
        // caller that passes no HTML still gets.
        $raw = $this->payload("Hello,\r\n\r\ncode is: 482913\r\n", null);

        $this->assertStringContainsString('Content-Type: text/plain; charset=UTF-8', $raw);
        $this->assertStringNotContainsString('multipart/alternative', $raw);
        $this->assertStringEndsWith("\r\n.\r\n", $raw);
    }

    public function testWithHtmlTheMessageIsMultipartAlternativeWithTheTextFirst(): void
    {
        $html = $this->message()['html'];
        $raw = $this->payload("Hello,\r\n\r\ncode is: 482913\r\n", $html);

        $this->assertSame(
            1,
            preg_match('/Content-Type: multipart\/alternative; boundary="([^"]+)"/', $raw, $m),
            'the Content-Type must declare the boundary the parts use'
        );
        $boundary = $m[1];

        // Order is the point: a client keeps the LAST type it understands, so
        // plain-first is what makes an HTML client render the designed part.
        $this->assertLessThan(
            strpos($raw, 'text/html'),
            strpos($raw, 'text/plain'),
            'text/plain must come before text/html'
        );

        $parts = explode('--' . $boundary, $raw);
        $this->assertCount(4, $parts, 'opening delimiter, two parts, closing delimiter');
        $this->assertStringStartsWith('--', $parts[3], 'the payload ends with the closing delimiter');
        $this->assertStringEndsWith("\r\n.\r\n", $raw);

        // The HTML arrives base64 and must decode back to exactly what was passed.
        $block = substr($parts[2], strpos($parts[2], "\r\n\r\n") + 4);
        $decoded = base64_decode(str_replace(["\r\n", "\n"], '', $block), true);
        $this->assertSame($html, $decoded);
    }

    public function testThePayloadIsSmtpSafeWhateverTheHtmlContains(): void
    {
        // base64 is why the HTML cannot break the protocol: no bare LF, no line
        // over the 998-byte limit however long the inline styles get, and no line
        // beginning with a full stop (which would end the message early).
        $html = str_repeat("<p style=\"color:#14213D;\">.line</p>", 200);
        $raw = $this->payload("Hello,\r\n\r\n.leading dot\r\n", $html);

        $this->assertSame(0, preg_match('/(?<!\r)\n/', $raw), 'no bare LF');
        foreach (explode("\r\n", $raw) as $line) {
            $this->assertLessThanOrEqual(998, strlen($line), 'SMTP line-length limit');
        }
        $this->assertStringContainsString("\r\n..leading dot", $raw, 'dot-stuffing still protects the plain part');
    }
}
