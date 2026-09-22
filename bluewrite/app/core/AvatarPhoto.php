<?php
declare(strict_types=1);

namespace App\Core;

/**
 * The photograph behind an officer's initials.
 *
 * WHY THIS IS A CLASS AND NOT SIX LINES IN A CONTROLLER. Everything difficult
 * about an avatar is a rule that is invisible in a screenshot and wrong in a way
 * nobody notices until it matters:
 *
 *   WHAT IS ACCEPTED. The type is decided by DECODING the upload, never by the
 *     two things the client controls — the filename and the `type` it put in the
 *     multipart body. A file called `me.png` that is really a PHP script, or a
 *     PNG whose header says `image/gif`, is refused here rather than stored and
 *     served back.
 *
 *   WHAT IS STORED. A re-encode, not the uploaded bytes. Even a real JPEG can
 *     carry a second payload in a comment segment, so an avatar is DECODED and
 *     written back out as a plain 256px JPEG: what lands in the folder is
 *     something this class produced, not something a client sent. The one
 *     exception is a deployment whose GD cannot decode the format (see
 *     store()) — and that exception is named rather than silent.
 *
 *   THE SQUARE. Every face in this app is drawn in a circle, so a 4:3 or 16:9
 *     photograph is centre-cropped to a square rather than squashed into one.
 *     Stretching is the thing that makes an avatar look broken.
 *
 *   TRANSPARENCY. A PNG with alpha is composited onto WHITE, because JPEG has no
 *     alpha channel: without this a transparent logo comes out as a black square.
 *
 * NO ROTATION. The `exif` extension is not installed on this deployment, so a
 * photograph straight off a phone would be stored at whatever rotation its
 * pixels are in, ignoring the orientation tag. The client re-encodes through a
 * canvas before uploading (see src/lib/avatar.js), and a browser decodes a JPEG
 * WITH its orientation applied — so the ordinary path arrives upright. A raw
 * curl upload of a portrait phone photo would not, which is the honest limitation
 * of this class rather than something it pretends to handle.
 *
 * THE FILES LIVE OUTSIDE THE WEB ROOT. storage/avatars/, not public/ — public/ is
 * Vite's build output and is emptied on every build, so a photograph kept there
 * would vanish at the next deploy. Being outside the web root also means an
 * avatar is only ever readable through the API, under a session, like every other
 * byte this system serves.
 */
final class AvatarPhoto
{
    /** Upload ceiling. PHP's own upload_max_filesize is 2M on this deployment. */
    public const MAX_BYTES = 2097152;

    /** The stored edge, in pixels, in both directions. */
    public const EDGE = 256;

    private const JPEG_QUALITY = 82;

    /**
     * Detected type => extension. Deliberately short: the three formats a phone
     * or a webcam produces.
     */
    private const TYPES = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    /** Where avatars are kept: <project>/storage/avatars, outside the web root. */
    public static function directory(): string
    {
        return dirname(__DIR__, 2) . '/storage/avatars';
    }

    /**
     * The message to show for an upload that cannot be accepted, or null when it
     * is fine. The caller turns this into a 422 with the field name attached.
     *
     * THE UPLOAD'S OWN ERROR COMES FIRST, because it is the only way to tell an
     * officer something useful about a failure that never reached us: PHP's size
     * limit produces an empty $_FILES entry with a code, not an exception, and
     * reporting that as "choose an image" would be a lie about a photograph the
     * officer did choose.
     */
    public static function check(array $file): ?string
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            return match ($error) {
                UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'That image is larger than this server accepts (2 MB). Choose a smaller one.',
                UPLOAD_ERR_PARTIAL => 'That upload did not finish. Check the connection and try again.',
                UPLOAD_ERR_NO_FILE => 'Choose an image to upload.',
                default => 'That image could not be uploaded. Try again.',
            };
        }

        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            return 'That upload could not be read. Try again.';
        }

        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > self::MAX_BYTES) {
            return 'That image is larger than this server accepts (2 MB). Choose a smaller one.';
        }

        if (self::detect($tmp) === null) {
            return 'That file is not an image this system can read. Use a JPEG, PNG or WebP.';
        }

        return null;
    }

    /**
     * The type of an image, DECODED from its bytes, or null if it is not one.
     *
     * getimagesize() reads the header rather than trusting the filename — which
     * is the whole point — and returns false for anything that is not an image
     * it recognises. Formats outside TYPES (a BMP, a TIFF, an SVG) are refused
     * here rather than at the render step: an SVG in particular is a document
     * that can carry script, and it has no business being served from our origin.
     */
    public static function detect(string $path): ?string
    {
        $info = @getimagesize($path);
        if (!is_array($info) || empty($info['mime'])) {
            return null;
        }
        $mime = strtolower((string) $info['mime']);

        return isset(self::TYPES[$mime]) ? $mime : null;
    }

    /**
     * Store an uploaded image for an account and return the filename to record in
     * users.photo_path.
     *
     * The name is `u<id>-<unix seconds>.<ext>`: it identifies whose it is and when
     * it was taken without a lookup, and a re-upload inside the same second
     * overwrites in place, which is the same photograph either way. The previous
     * file is deleted by the caller AFTER the row is updated (see
     * AuthController::setPhoto), so a failure in between leaves a photo that is
     * still on disk rather than a row pointing at nothing.
     */
    public static function store(int $userId, string $tmpPath, string $mime): string
    {
        $dir = self::directory();
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create the avatar folder: ' . $dir);
        }

        $ext = self::TYPES[$mime] ?? 'jpg';
        $name = sprintf('u%d-%d.%s', $userId, time(), $ext);
        $dest = $dir . '/' . $name;

        // Re-encode when GD can decode the format…
        if (self::normalise($tmpPath, $dest)) {
            // …and the name must then say .jpg, because it is one now.
            if ($ext !== 'jpg') {
                @unlink($dest);
                $name = sprintf('u%d-%d.jpg', $userId, time());
                $dest = $dir . '/' . $name;
                if (!self::normalise($tmpPath, $dest)) {
                    throw new \RuntimeException('Avatar re-encode failed for ' . $mime);
                }
            }

            return $name;
        }

        // …otherwise keep the bytes as uploaded. This is the deployment without
        // GD (or without this format in it): the file is a real image of a type
        // detected from its own header, and it is served with an explicit
        // Content-Type under X-Content-Type-Options: nosniff, so it cannot be
        // interpreted as anything else.
        if (!@move_uploaded_file($tmpPath, $dest) && !@copy($tmpPath, $dest)) {
            throw new \RuntimeException('Could not write the avatar file: ' . $dest);
        }
        @chmod($dest, 0644);

        return $name;
    }

    /**
     * Decode, centre-crop to a square and write a 256px JPEG. False when GD is
     * absent or cannot read the format — never a partial file: the destination is
     * written only by imagejpeg(), which creates it itself.
     */
    private static function normalise(string $src, string $dest): bool
    {
        if (!function_exists('imagecreatefromstring')) {
            return false;
        }

        $bytes = @file_get_contents($src);
        if ($bytes === false) {
            return false;
        }

        // Suppressed: a malformed image warns on the way to returning false, and
        // callers of this class treat "cannot decode" as a normal outcome.
        $image = @imagecreatefromstring($bytes);
        if ($image === false) {
            return false;
        }

        $w = imagesx($image);
        $h = imagesy($image);
        if ($w < 1 || $h < 1) {
            imagedestroy($image);
            return false;
        }

        // Centre-crop the largest square, then scale that square to EDGE.
        $edge = min($w, $h);
        $sx = (int) (($w - $edge) / 2);
        $sy = (int) (($h - $edge) / 2);

        $square = imagecreatetruecolor(self::EDGE, self::EDGE);
        $white = imagecolorallocate($square, 255, 255, 255);
        imagefilledrectangle($square, 0, 0, self::EDGE, self::EDGE, $white);
        imagecopyresampled($square, $image, 0, 0, $sx, $sy, self::EDGE, self::EDGE, $edge, $edge);

        $ok = imagejpeg($square, $dest, self::JPEG_QUALITY);

        imagedestroy($square);
        imagedestroy($image);

        if ($ok) {
            @chmod($dest, 0644);
        }

        return (bool) $ok;
    }

    /** The absolute path of a stored avatar, or null when there is none or it is gone. */
    public static function path(?string $name): ?string
    {
        if ($name === null || $name === '') {
            return null;
        }
        // The stored name comes from our own column, but a name is a path
        // component: anything with a slash or a parent reference in it is refused
        // rather than resolved, so a corrupted row can never read outside the
        // folder. basename() alone would silently "fix" such a value; this says no.
        if (preg_match('~^[A-Za-z0-9._-]+$~', $name) !== 1) {
            return null;
        }
        $path = self::directory() . '/' . $name;

        return is_file($path) ? $path : null;
    }

    /**
     * The URL the browser should ask for, or null when this account has no photo
     * (and the initials are drawn in its place).
     *
     * THE ONE PLACE THIS URL IS BUILT. It is assembled on the server — in /me for
     * the session's own account and in the presence roster for everybody else —
     * because the `v=` cache key comes from users.photo_updated_at: a client that
     * composed the URL itself would have to be handed the version separately, and
     * the copy that goes stale is the one showing a colleague's old photograph.
     */
    public static function url(int $userId, ?string $name, ?string $stamp): ?string
    {
        if ($name === null || $name === '') {
            return null;
        }
        $version = self::version($stamp);

        return '/api/v1/users/' . $userId . '/photo' . ($version === null ? '' : '?v=' . $version);
    }

    /** The Content-Type for a stored avatar, from its own extension. */
    public static function mimeFor(string $name): string
    {
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));

        return match ($ext) {
            'png' => 'image/png',
            'webp' => 'image/webp',
            default => 'image/jpeg',
        };
    }

    /** Remove a stored avatar. A missing file is not an error: the row is the truth. */
    public static function delete(?string $name): void
    {
        $path = self::path($name);
        if ($path !== null) {
            @unlink($path);
        }
    }

    /**
     * The cache-busting value for a photo URL, from users.photo_updated_at.
     *
     * A DATETIME rather than a hash of the file: it is already in the row, it
     * changes exactly when the photo does, and no request has to touch the disk
     * to compute it. `v=` in the URL is therefore a fact about the record.
     */
    public static function version(?string $stamp): ?int
    {
        if ($stamp === null || $stamp === '') {
            return null;
        }
        $at = strtotime($stamp);

        return $at === false ? null : $at;
    }
}
