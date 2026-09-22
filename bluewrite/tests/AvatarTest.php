<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use PDO;
use RuntimeException;

/**
 * Phase 8 — avatars: the photograph behind an officer's initials.
 *
 * Covers POST /me/photo, DELETE /me/photo and GET /users/:id/photo end to end,
 * against the real API and real files on disk.
 *
 * THE TESTS THAT MATTER HERE ARE ABOUT WHAT IS ACCEPTED AND WHAT IS STORED, because
 * both are invisible in a screenshot and both are security-relevant:
 *
 *   - A FILE THAT IS NOT AN IMAGE must be refused even when it is NAMED .png and
 *     announced as image/png. The temptingly simple implementation — trust
 *     $_FILES['type'], or the extension — is the one that stores a script in a
 *     folder the server can serve, so this test sends text with a PNG's name and
 *     a PNG's declared type.
 *   - WHAT IS STORED IS WHAT WE WROTE, not what was sent: an 800x600 photograph
 *     is centre-cropped and re-encoded to 256x256, which is asserted by decoding
 *     the bytes the API serves back rather than by trusting the upload response.
 *   - THE URL IS A CACHE KEY. The version in it has to change when the photo
 *     does, or an officer who re-uploads keeps seeing yesterday's face wherever
 *     the browser or the LAN proxy cached it.
 */
final class AvatarTest extends BaseApiTestCase
{
    /** The stored edge AvatarPhoto normalises to. */
    private const EDGE = 256;

    /**
     * The stored avatars are FILES, so the per-test database reset does not clean
     * up after them: without this, every run of this file would leave images in
     * storage/avatars/ named by rows that no longer exist.
     */
    protected function tearDown(): void
    {
        $dir = dirname(__DIR__) . '/storage/avatars';
        $names = $this->rootPdo()
            ->query('SELECT photo_path FROM users WHERE photo_path IS NOT NULL')
            ->fetchAll(PDO::FETCH_COLUMN);
        foreach ($names as $name) {
            @unlink($dir . '/' . basename((string) $name));
        }
        parent::tearDown();
    }

    public function testBothPhotoRoutesRequireASignIn(): void
    {
        // Writes are refused by the CSRF gate (419) before the session check can
        // answer 401 — the front controller's order for every state-changing
        // route, not something specific to an avatar. The read is not gated that
        // way, so it is the one that answers 401.
        $this->assertSame(419, $this->request('POST', '/me/photo')['status']);
        $this->assertSame(419, $this->request('DELETE', '/me/photo')['status']);
        $this->assertSame(401, $this->request('GET', '/users/1/photo')['status']);
        $this->assertSame(0, $this->photoCount(), 'nothing may be stored by an anonymous request');
    }

    public function testAnImageIsStoredNormalisedAndServedBack(): void
    {
        [$cookie, $csrf, $me] = $this->login('t.officer');

        // A landscape photograph, twice as wide as it is tall, which is what a
        // webcam or a phone hands you.
        $res = $this->upload('/me/photo', 'photo', 'portrait.jpg', $this->jpegBytes(800, 600), $cookie, $csrf);
        $this->assertSame(200, $res['status'], json_encode($res['body']));
        $this->assertNotNull($res['body']['photo_url']);
        $this->assertStringContainsString('/api/v1/users/' . $me['id'] . '/photo?v=', $res['body']['photo_url']);

        // /me agrees, so a reload shows the same face without a second request.
        $meAfter = $this->request('GET', '/me', null, $cookie);
        $this->assertSame($res['body']['photo_url'], $meAfter['body']['photo_url']);

        // The bytes that come back are a JPEG produced by the server, and a SQUARE
        // — centre-cropped rather than squashed, which is the difference between
        // an avatar that looks deliberate and one that looks broken.
        $served = $this->download($res['body']['photo_url'], $cookie);
        $this->assertSame(200, $served['status']);
        $this->assertSame('image/jpeg', $served['contentType']);
        $this->assertSame("\xFF\xD8", substr($served['bytes'], 0, 2), 'a real JPEG, whatever was uploaded');
        $size = getimagesizefromstring($served['bytes']);
        $this->assertIsArray($size);
        $this->assertSame(self::EDGE, $size[0]);
        $this->assertSame(self::EDGE, $size[1]);

        // The served bytes are NOT the uploaded bytes: this is a re-encode.
        $this->assertNotSame($this->jpegBytes(800, 600), $served['bytes']);
    }

    public function testAFileThatIsNotAnImageIsRefusedAndNothingIsStored(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        // Text, named and announced as a PNG. The name and the declared type are
        // both the client's to lie about; only decoding can answer this.
        $res = $this->upload('/me/photo', 'photo', 'avatar.png', "<?php echo 'pwned'; ?>", $cookie, $csrf, 'image/png');
        $this->assertSame(422, $res['status']);
        $this->assertSame('photo', $res['body']['field']);
        $this->assertSame(0, $this->photoCount(), 'a refused upload must not be recorded');

        // …and an SVG, which IS an image to a browser and is deliberately not one
        // to this endpoint: a served SVG is a document that can carry script.
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';
        $res2 = $this->upload('/me/photo', 'photo', 'avatar.svg', $svg, $cookie, $csrf, 'image/svg+xml');
        $this->assertSame(422, $res2['status']);
        $this->assertSame(0, $this->photoCount());
    }

    public function testAnOversizedUploadIsRefusedWithASentenceAboutItsSize(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');

        $res = $this->upload('/me/photo', 'photo', 'huge.jpg', str_repeat('x', 3 * 1024 * 1024), $cookie, $csrf);
        $this->assertSame(422, $res['status']);
        // The officer must be told what actually went wrong. PHP's own limit
        // reports itself as an error CODE on an otherwise empty $_FILES entry, and
        // reporting that as "choose an image" would be a lie about a file they did
        // choose — see AvatarPhoto::check.
        $this->assertStringContainsString('larger', $res['body']['error']);
        $this->assertSame(0, $this->photoCount());
    }

    public function testRemovingThePhotoGoesBackToInitials(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $uploaded = $this->upload('/me/photo', 'photo', 'me.jpg', $this->jpegBytes(400, 400), $cookie, $csrf);
        $url = (string) $uploaded['body']['photo_url'];
        $this->assertSame(200, $this->download($url, $cookie)['status']);

        $res = $this->request('DELETE', '/me/photo', null, $cookie, $csrf);
        $this->assertSame(200, $res['status']);
        $this->assertNull($res['body']['photo_url']);
        $this->assertSame(0, $this->photoCount());

        $me = $this->request('GET', '/me', null, $cookie);
        $this->assertNull($me['body']['photo_url'], 'the workspace draws initials again');

        // The old URL is a real 404 rather than a stale image: the row no longer
        // names a file, and the file is gone.
        $this->assertSame(404, $this->download($url, $cookie)['status']);

        // Clearing twice is not an error: "there is no photo" is the state the
        // second call asked for.
        $this->assertSame(200, $this->request('DELETE', '/me/photo', null, $cookie, $csrf)['status']);
    }

    public function testAnySignedInRoleCanFetchSomebodyElsesPhoto(): void
    {
        [$offCookie, $offCsrf, $officer] = $this->login('t.officer');
        $this->upload('/me/photo', 'photo', 'me.jpg', $this->jpegBytes(300, 300), $offCookie, $offCsrf);

        // The roster draws every colleague's face, so a Staff account has to be
        // able to fetch one — an avatar only an admin could see would be a circle
        // that works for some of the station.
        [$staffCookie] = $this->login('t.staff');
        $fetched = $this->download('/users/' . $officer['id'] . '/photo', $staffCookie);
        $this->assertSame(200, $fetched['status']);
        $this->assertSame("\xFF\xD8", substr($fetched['bytes'], 0, 2));
    }

    public function testAnAccountWithNoPhotoAnswers404RatherThanAnEmptyImage(): void
    {
        [$cookie] = $this->login('t.admin');
        $res = $this->request('GET', '/users/2/photo', null, $cookie);
        $this->assertSame(404, $res['status']);
        $this->assertArrayHasKey('error', $res['body']);
    }

    public function testThePhotoUrlChangesWhenThePhotoDoes(): void
    {
        [$cookie, $csrf] = $this->login('t.officer');
        $first = $this->upload('/me/photo', 'photo', 'one.jpg', $this->jpegBytes(300, 300), $cookie, $csrf);
        $this->assertSame(200, $first['status']);

        // The version is users.photo_updated_at, which is a DATETIME — whole
        // seconds — so a different photo has to be a second later to be a
        // different key.
        sleep(1);
        $second = $this->upload('/me/photo', 'photo', 'two.jpg', $this->jpegBytes(300, 300), $cookie, $csrf);
        $this->assertSame(200, $second['status']);

        $this->assertNotSame(
            $first['body']['photo_url'],
            $second['body']['photo_url'],
            'a re-upload must be a new URL, or a cached face never changes'
        );
        // …and only ONE file is left behind: the replaced one is deleted once the
        // row has stopped naming it.
        $this->assertSame(1, $this->storedFileCount());
    }

    /** How many accounts in the scratch DB currently have a photo on file. */
    private function photoCount(): int
    {
        return (int) $this->rootPdo()->query('SELECT COUNT(*) FROM users WHERE photo_path IS NOT NULL')->fetchColumn();
    }

    /** How many avatar files are actually on disk. */
    private function storedFileCount(): int
    {
        $files = glob(dirname(__DIR__) . '/storage/avatars/*');

        return $files === false ? 0 : count($files);
    }

    /**
     * A real JPEG of the given size, encoded by GD — the same library the server
     * uses, which is why the suite needs no binary fixtures checked in.
     */
    private function jpegBytes(int $width, int $height): string
    {
        if (!function_exists('imagecreatetruecolor')) {
            throw new RuntimeException('This test needs GD to build a fixture image.');
        }
        $image = imagecreatetruecolor($width, $height);
        // A recognisable pattern rather than a flat fill: a solid colour can
        // survive being squashed, so a resize bug would still look plausible.
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
}
