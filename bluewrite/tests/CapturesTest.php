<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

/**
 * Blotter-capture photos filed against a report (migration 025).
 *
 * The contract: a photo plus its officer-reviewed text lands on a report the
 * account may write to, the bytes are readable back through the API, and the
 * report reads carry the inventory for the draft sheet. Either credential
 * works (cookie session or device token); visibility is the report's own.
 */
final class CapturesTest extends BaseApiTestCase
{
    private function bearer(string $token): string
    {
        return 'Authorization: Bearer ' . $token;
    }

    private function deviceToken(string $user = 't.officer'): string
    {
        [$cookie, $csrf] = $this->login($user);
        $res = $this->request('POST', '/devices/issue', ['device_name' => 'Test Phone'], $cookie, $csrf);
        $this->assertSame(201, $res['status']);
        return (string) $res['body']['token'];
    }

    /** A real JPEG, encoded by GD — the same fixture trick as AvatarTest. */
    private function jpegBytes(int $width = 64, int $height = 48): string
    {
        if (!function_exists('imagecreatetruecolor')) {
            $this->markTestSkipped('This test needs GD to build a fixture image.');
        }
        $image = imagecreatetruecolor($width, $height);
        for ($x = 0; $x < $width; $x += 8) {
            $shade = imagecolorallocate($image, ($x * 7) % 256, 40, 120);
            imagefilledrectangle($image, $x, 0, $x + 3, $height, $shade);
        }
        ob_start();
        imagejpeg($image, null, 90);
        $bytes = (string) ob_get_clean();
        imagedestroy($image);
        return $bytes;
    }

    public function testFilePhotoWithReviewedText(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);

        $res = $this->uploadCapture($report['id'], $cookie, $csrf, 'Entry No. 1234, theft at the market.');
        $this->assertSame(201, $res['status'], 'capture store failed: ' . json_encode($res['body']));
        $capture = $res['body']['capture'];
        $this->assertSame('Entry No. 1234, theft at the market.', $capture['ocr_text']);
        $this->assertSame('gemini', $capture['engine']);
        $this->assertSame('/api/v1/reports/' . $report['id'] . '/captures/' . $capture['id'] . '/photo', $capture['photo_url']);

        // The bytes live on disk outside the web root, like the avatars.
        $this->assertNotEmpty(glob(dirname(__DIR__) . '/storage/report_captures/*'));
    }

    public function testPhoneFilesViaBearer(): void
    {
        $token = $this->deviceToken('t.officer');
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);

        // Multipart WITH a bearer and WITHOUT a CSRF token — the phone's path.
        $tmp = tempnam(sys_get_temp_dir(), 'bwcap');
        file_put_contents($tmp, $this->jpegBytes());
        $ch = curl_init('http://127.0.0.1:8098/api/v1/reports/' . $report['id'] . '/captures');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_HTTPHEADER => [$this->bearer($token)],
            CURLOPT_POSTFIELDS => [
                'photo' => new \CURLFile($tmp, 'image/jpeg', 'blotter.jpg'),
                'ocr_text' => 'Reviewed on the phone.',
                'engine' => 'imagetotext',
            ],
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        @unlink($tmp);
        $this->assertSame(201, $status, 'bearer capture failed: ' . substr((string) $raw, -400));
    }

    public function testCannotFileOnAnothersDraft(): void
    {
        [$cookie, $csrf] = $this->login('t.officer2');
        $report = $this->createReport($cookie, $csrf);

        [$officerCookie, $officerCsrf] = $this->login('t.officer');
        $res = $this->uploadCapture($report['id'], $officerCookie, $officerCsrf, 'Not mine.');
        $this->assertSame(403, $res['status']);
    }

    public function testFinalizedIsLockedForOfficerButOpenToAdmin(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);
        $final = $this->request('PATCH', "/reports/{$report['id']}", ['status' => 'finalized'], $cookie, $csrf);
        $this->assertSame(200, $final['status']);

        $officer = $this->uploadCapture($report['id'], $cookie, $csrf, 'Too late.');
        $this->assertSame(403, $officer['status']);

        [$adminCookie, $adminCsrf] = $this->login('t.admin');
        $admin = $this->uploadCapture($report['id'], $adminCookie, $adminCsrf, 'Admin supplement.');
        $this->assertSame(201, $admin['status'], 'admin capture failed: ' . json_encode($admin['body']));
    }

    public function testNonPhotoIsRefused(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);

        $tmp = tempnam(sys_get_temp_dir(), 'bwcap');
        file_put_contents($tmp, 'this is not an image at all');
        $ch = curl_init('http://127.0.0.1:8098/api/v1/reports/' . $report['id'] . '/captures');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_HTTPHEADER => ["X-CSRF-Token: $csrf"],
            CURLOPT_COOKIE => $cookie,
            CURLOPT_POSTFIELDS => ['photo' => new \CURLFile($tmp, 'text/plain', 'notes.txt')],
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        @unlink($tmp);
        $this->assertSame(422, $status, 'non-photo accepted: ' . substr((string) $raw, -300));
    }

    public function testListAndPhotoRoundTrip(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);
        $stored = $this->uploadCapture($report['id'], $cookie, $csrf, 'Round trip text.');
        $captureId = (int) $stored['body']['capture']['id'];

        $list = $this->request('GET', "/reports/{$report['id']}/captures", null, $cookie, null);
        $this->assertSame(200, $list['status']);
        $this->assertCount(1, $list['body']['captures']);
        $this->assertSame('Round trip text.', $list['body']['captures'][0]['ocr_text']);

        $photo = $this->download("/reports/{$report['id']}/captures/{$captureId}/photo", $cookie);
        $this->assertSame(200, $photo['status']);
        $this->assertStringStartsWith('image/', $photo['contentType']);
        $this->assertNotEmpty($photo['bytes']);

        // The register is station-wide: another officer READS the same photo
        // (visibility is the report's own — Officers view every report, and
        // only edits are owner-gated, as RbacTest holds).
        [$cookie2] = $this->login('t.officer2');
        $shared = $this->download("/reports/{$report['id']}/captures/{$captureId}/photo", $cookie2);
        $this->assertSame(200, $shared['status']);
    }

    public function testReportReadsCarryTheInventory(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $report = $this->createReport($cookie, $csrf);
        $this->uploadCapture($report['id'], $cookie, $csrf, 'Shown on the sheet.');

        // The sheet reads a report through /print (plain GET /reports/:id has
        // no route — show() is dead code), and the captures ride along for the
        // draft sheet's photo strip.
        $print = $this->request('GET', "/reports/{$report['id']}/print", null, $cookie, null);
        $this->assertSame(200, $print['status']);
        $this->assertCount(1, $print['body']['captures'] ?? []);
    }

    /** POST a capture the way the avatar tests POST an avatar. */
    private function uploadCapture(int $reportId, ?string $cookie, ?string $csrf, string $text): array
    {
        $tmp = tempnam(sys_get_temp_dir(), 'bwcap');
        file_put_contents($tmp, $this->jpegBytes());
        $ch = curl_init('http://127.0.0.1:8098/api/v1/reports/' . $reportId . '/captures');
        $headers = [];
        if ($csrf !== null) {
            $headers[] = "X-CSRF-Token: $csrf";
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => 'POST',
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_COOKIE => $cookie ?? '',
            CURLOPT_TIMEOUT => 10,
            CURLOPT_POSTFIELDS => [
                'photo' => new \CURLFile($tmp, 'image/jpeg', 'blotter.jpg'),
                'ocr_text' => $text,
                'engine' => 'gemini',
            ],
        ]);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        curl_close($ch);
        @unlink($tmp);
        $decoded = json_decode(substr((string) $raw, $headerSize), true);
        return ['status' => $status, 'body' => is_array($decoded) ? $decoded : []];
    }
}
