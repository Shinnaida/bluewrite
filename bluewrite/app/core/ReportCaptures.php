<?php
declare(strict_types=1);

namespace App\Core;

/**
 * A blotter-capture photo filed against a report (migration 025).
 *
 * WHAT THIS IS AND IS NOT. Unlike an avatar (AvatarPhoto), a capture is
 * EVIDENCE of what the blotter page showed: the ORIGINAL bytes are stored,
 * never a re-encode, so what the officer checks in the draft sheet is the
 * photograph the phone took. The type is still decided by DECODING the
 * upload — getimagesize on the bytes, never the filename or the multipart
 * claim — because a stored file that is not an image is a stored surprise.
 *
 * WHERE THEY LIVE. storage/report_captures/, outside the web root like the
 * avatars: public/ is Vite's build output and is swept on every build, so a
 * photograph kept there would vanish at the next deploy. Readable only
 * through the API under a session or device token.
 */
final class ReportCaptures
{
    /** A phone photo downscaled to ~1600px is well under this; 8MB is the OCR ceiling. */
    public const MAX_BYTES = 8 * 1024 * 1024;

    private const TYPES = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    public static function directory(): string
    {
        return dirname(__DIR__, 2) . '/storage/report_captures';
    }

    /**
     * The message to show for an upload that cannot be accepted, or null.
     * Same shape as AvatarPhoto::check, because the caller turns it into a
     * 422 with the field name attached.
     */
    public static function check(array $file): ?string
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            return match ($error) {
                UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'That photo is larger than this server accepts (8 MB). Move closer or lower the camera resolution and try again.',
                UPLOAD_ERR_PARTIAL => 'That upload did not finish. Check the connection and try again.',
                UPLOAD_ERR_NO_FILE => 'Choose a photo to attach.',
                default => 'That photo could not be uploaded. Try again.',
            };
        }

        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            return 'That upload could not be read. Try again.';
        }

        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > self::MAX_BYTES) {
            return 'That photo is larger than this server accepts (8 MB). Move closer or lower the camera resolution and try again.';
        }

        if (self::detect($tmp) === null) {
            return 'That file is not a photo this system can keep. Use a JPEG, PNG or WebP.';
        }

        return null;
    }

    /** The type of an image, DECODED from its bytes — see AvatarPhoto::detect. */
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
     * Store an uploaded capture for a report. Returns the filename to record
     * in report_captures.file_path.
     *
     * The name is `r<report>-<unix seconds>-<random>.<ext>`: whose report it
     * belongs to and when it was filed, without a lookup — and the random
     * tail, because two captures of one report inside the same second are the
     * ordinary case, not a collision to overwrite.
     */
    public static function store(int $reportId, string $tmpPath, string $mime): string
    {
        $dir = self::directory();
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create the capture folder: ' . $dir);
        }

        $ext = self::TYPES[$mime] ?? 'jpg';
        $name = sprintf('r%d-%d-%s.%s', $reportId, time(), bin2hex(random_bytes(4)), $ext);
        $dest = $dir . '/' . $name;

        // The ORIGINAL bytes, deliberately: a capture is evidence, and a
        // re-encode would trade the photograph for something this class made.
        if (!@move_uploaded_file($tmpPath, $dest) && !@copy($tmpPath, $dest)) {
            throw new \RuntimeException('Could not write the capture file: ' . $dest);
        }
        @chmod($dest, 0644);

        return $name;
    }

    /** The absolute path of a stored capture, or null when it is gone. */
    public static function path(?string $name): ?string
    {
        if ($name === null || $name === '') {
            return null;
        }
        // A name is a path component: anything outside the plain-file shape is
        // refused rather than resolved, so a corrupted row can never read
        // outside the folder (see AvatarPhoto::path).
        if (preg_match('~^[A-Za-z0-9._-]+$~', $name) !== 1) {
            return null;
        }
        $path = self::directory() . '/' . $name;

        return is_file($path) ? $path : null;
    }

    /** The URL the draft sheet asks for — same shape as the avatar URL. */
    public static function url(int $reportId, int $captureId): string
    {
        return '/api/v1/reports/' . $reportId . '/captures/' . $captureId . '/photo';
    }
}
