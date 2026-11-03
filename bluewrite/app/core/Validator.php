<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Minimal input validation for API payloads.
 */
final class Validator
{
    /** @var array<string, string> */
    private array $errors = [];

    public function require(string $field, mixed $value, string $label, int $max = 200): void
    {
        if (!is_string($value) || trim($value) === '') {
            $this->errors[$field] = "{$label} is required.";
            return;
        }
        if (mb_strlen($value) > $max) {
            $this->errors[$field] = "{$label} must be at most {$max} characters.";
        }
    }

    public function optional(string $field, mixed $value, string $label, int $max = 200): void
    {
        if ($value === null) {
            return;
        }
        if (!is_string($value)) {
            $this->errors[$field] = "{$label} must be text.";
            return;
        }
        if (mb_strlen($value) > $max) {
            $this->errors[$field] = "{$label} must be at most {$max} characters.";
        }
    }

    public function in(string $field, mixed $value, array $allowed, string $label): void
    {
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            $allowedList = implode(', ', $allowed);
            $this->errors[$field] = "{$label} must be one of: {$allowedList}.";
        }
    }

    /**
     * Completeness bypass: forget refusals caused by BLANK values on the
     * report's own identity fields, so a write with empty fields is not
     * refused. Anything else stands — a malformed supplied value, and every
     * other field's own rules, refuse exactly as before. Only emptiness is
     * excused, and only where emptiness is the whole complaint.
     */
    public function dropBlankValueErrors(array $body): void
    {
        foreach (['incident_type', 'incident_types', 'incident_datetime', 'location'] as $field) {
            // Absent or null is blank too: the API and older clients omit
            // keys the officer never touched (JSON drops undefined), and a
            // missing value is exactly what must not refuse the write.
            if (!array_key_exists($field, $body) || $body[$field] === null) {
                unset($this->errors[$field]);
                continue;
            }
            $value = $body[$field];
            if (is_string($value) && trim($value) === '') {
                unset($this->errors[$field]);
            }
        }
    }

    public function datetime(string $field, mixed $value, string $label): void
    {
        if (!is_string($value)) {
            $this->errors[$field] = "{$label} is required.";
            return;
        }
        $dt = \DateTime::createFromFormat('Y-m-d H:i:s', $value)
            ?: \DateTime::createFromFormat('Y-m-d\TH:i', $value)
            ?: \DateTime::createFromFormat('Y-m-d\TH:i:s', $value);
        // A date with no recorded time (owner request): the report files a
        // bare YYYY-MM-DD and the time stays unknown rather than refusing
        // the save. Strict shape — trailing prose is not a date.
        if ($dt === false && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1) {
            $dt = \DateTime::createFromFormat('Y-m-d', $value);
        }
        if ($dt === false) {
            $this->errors[$field] = "{$label} must be a valid date and time.";
        }
    }

    /** Date only (`YYYY-MM-DD`) — report, blotter, incident and discovery dates. */
    public function date(string $field, mixed $value, string $label): void
    {
        if (!is_string($value) || trim($value) === '') {
            $this->errors[$field] = "{$label} is required.";
            return;
        }
        $v = trim($value);
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) !== 1 || strtotime($v) === false) {
            $this->errors[$field] = "{$label} must be a valid date.";
        }
    }

    /** Time only (`HH:MM`) — optional; blank means the time is unknown. */
    public function time(string $field, mixed $value, string $label): void
    {
        if ($value === null || $value === '') {
            return;
        }
        if (!is_string($value) || preg_match('/^\d{2}:\d{2}(:\d{2})?$/', trim($value)) !== 1) {
            $this->errors[$field] = "{$label} must look like HH:MM.";
        }
    }

    /**
     * Email address — optional, but must be a plausible address when given.
     * Empty is never an error here: the reporting party's email is optional
     * (spec Panel I), so only a malformed value is rejected.
     */
    public function email(string $field, mixed $value, string $label): void
    {
        if ($value === null || $value === '') {
            return;
        }
        if (!is_string($value) || filter_var(trim($value), FILTER_VALIDATE_EMAIL) === false) {
            $this->errors[$field] = "{$label} must be a valid email address.";
        }
    }

    /** The approximate-time qualifier: accepts true/false and 1/0. */
    public function boolean(string $field, mixed $value, string $label): void
    {
        if (is_bool($value) || $value === 1 || $value === 0 || $value === '1' || $value === '0') {
            return;
        }
        $this->errors[$field] = "{$label} must be true or false.";
    }

    /** Attach a message produced by the rule engine to its field. */
    public function add(string $field, string $message): void
    {
        $this->errors[$field] ??= $message;
    }

    /** @return array<string, string> */
    public function errors(): array
    {
        return $this->errors;
    }

    public function fails(): bool
    {
        return $this->errors !== [];
    }
}
