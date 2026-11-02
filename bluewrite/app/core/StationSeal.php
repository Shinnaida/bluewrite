<?php
declare(strict_types=1);

namespace App\Core;

/**
 * BlueWrite — the station's two seal files (migration 027).
 *
 * The letterhead's left badge (the PNP seal) and right badge (the station
 * seal), as uploaded by an Admin. Same discipline as the avatars
 * (AvatarPhoto): the type is decided by DECODING the bytes, never by the
 * filename; SVG is refused outright (a document that can carry script has no
 * business being served from our origin); the bytes live in storage/seals,
 * outside the web root, and are served with an explicit Content-Type under
 * X-Content-Type-Options: nosniff.
 *
 * Two differences from the avatars, both deliberate. The bytes are kept
 * AS UPLOADED rather than re-encoded to a square: a seal is office artwork,
 * not a face, and a centre-crop would cut a wide badge into a square one.
 * And the stored name carries the side (`seal-left-<time>.<ext>`), so the two
 * files can never be confused by a reader of the folder.
 */
final class StationSeal
{
    /** Upload ceiling. PHP's own upload_max_filesize is 2M on this deployment. */
    public const MAX_BYTES = 2097152;

    public const SIDES = ['left', 'right'];

    /**
     * Detected type => extension. Deliberately short: the formats a badge
     * file comes in.
     */
    private const TYPES = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    /** Where seals are kept: <project>/storage/seals, outside the web root. */
    public static function directory(): string
    {
        return dirname(__DIR__, 2) . '/storage/seals';
    }

    /**
     * The message to show for an upload that cannot be accepted, or null when
     * it is fine. Same shape as AvatarPhoto::check, because the caller turns
     * it into a 422 with the field name attached.
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
     * getimagesize() reads the header rather than trusting the filename, and
     * formats outside TYPES (a BMP, a TIFF, an SVG) are refused here.
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
     * Store an uploaded seal and return the filename to record in
     * station_settings.seal_<side>_path.
     *
     * The previous file is deleted by the caller AFTER the row is updated,
     * so a failure in between leaves a seal that is still on disk rather
     * than a row pointing at nothing.
     */
    public static function store(string $side, string $tmpPath, string $mime): string
    {
        $dir = self::directory();
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create the seal folder: ' . $dir);
        }

        $ext = self::TYPES[$mime] ?? 'jpg';
        $name = sprintf('seal-%s-%d.%s', $side, time(), $ext);
        $dest = $dir . '/' . $name;
        if (!@move_uploaded_file($tmpPath, $dest) && !@copy($tmpPath, $dest)) {
            throw new \RuntimeException('Could not write the seal file: ' . $dest);
        }
        @chmod($dest, 0644);

        return $name;
    }

    /** The absolute path of a stored seal, or null when there is none or it is gone. */
    public static function path(?string $name): ?string
    {
        if ($name === null || $name === '') {
            return null;
        }
        // A name is a path component: anything with a slash or a parent
        // reference in it is refused rather than resolved.
        if (preg_match('~^[A-Za-z0-9._-]+$~', $name) !== 1) {
            return null;
        }
        $path = self::directory() . '/' . $name;

        return is_file($path) ? $path : null;
    }

    /**
     * The URL the browser should ask for, or null when the bundled artwork
     * is in force. THE ONE PLACE THIS URL IS BUILT: the `v=` cache key is the
     * file's own mtime, so a re-uploaded seal cannot hide behind a cached one.
     */
    public static function url(string $side, ?string $name): ?string
    {
        $path = self::path($name);
        if ($path === null) {
            return null;
        }
        $mtime = @filemtime($path);

        return '/api/v1/station/seal/' . $side . ($mtime === false ? '' : '?v=' . $mtime);
    }

    /** The Content-Type for a stored seal, from its own extension. */
    public static function mimeFor(string $name): string
    {
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));

        return match ($ext) {
            'png' => 'image/png',
            'webp' => 'image/webp',
            default => 'image/jpeg',
        };
    }

    /** Remove a stored seal. A missing file is not an error: the row is the truth. */
    public static function delete(?string $name): void
    {
        $path = self::path($name);
        if ($path !== null) {
            @unlink($path);
        }
    }
}
