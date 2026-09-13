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

    public function datetime(string $field, mixed $value, string $label): void
    {
        if (!is_string($value)) {
            $this->errors[$field] = "{$label} is required.";
            return;
        }
        $dt = \DateTime::createFromFormat('Y-m-d H:i:s', $value)
            ?: \DateTime::createFromFormat('Y-m-d\TH:i', $value)
            ?: \DateTime::createFromFormat('Y-m-d\TH:i:s', $value);
        if ($dt === false) {
            $this->errors[$field] = "{$label} must be a valid date and time.";
        }
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
