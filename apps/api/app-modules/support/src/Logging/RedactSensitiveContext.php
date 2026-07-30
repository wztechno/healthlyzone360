<?php

declare(strict_types=1);

namespace Healthy360\Support\Logging;

use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;
use SensitiveParameterValue;
use Stringable;
use Throwable;
use UnitEnum;

/**
 * The central log-redaction processor (plan §12, 06-security-privacy-and-audit
 * §2). Applied to every channel through config/logging.php, so redaction is a
 * property of the logging pipeline rather than a discipline expected of each
 * call site.
 *
 * Two independent passes, because neither catches what the other does:
 *
 *  * a key deny-list, matched as a case-insensitive substring so
 *    `two_factor_secret`, `access_token` and `X-Authorization` are all caught
 *    without enumerating every spelling;
 *  * value scrubbers, for secrets that arrive inside otherwise innocent
 *    strings — a bearer token pasted into an exception message, an email
 *    address in a validation error.
 *
 * Traversal is depth-capped: log context is arbitrary user-influenced data and
 * a processor must not become a way to hang the logger. Anything below the cap
 * is replaced wholesale rather than emitted unredacted.
 */
final class RedactSensitiveContext implements ProcessorInterface
{
    public const string PLACEHOLDER = '[redacted]';

    private const int MAX_DEPTH = 8;

    /**
     * Keys whose value never survives, matched case-insensitively as a
     * substring of the key.
     *
     * @var list<string>
     */
    private const array DENIED_KEYS = [
        'password',
        'password_confirmation',
        'token',
        'access_token',
        'secret',
        'authorization',
        'cookie',
        'two_factor_secret',
        'two_factor_recovery_codes',
        'recovery_code',
    ];

    /**
     * Value scrubbers applied to every surviving string, in order.
     *
     * The bearer pattern deliberately also matches a bare high-entropy
     * `id|plaintext` Sanctum token, which is what a leaked personal access
     * token looks like when it is not preceded by the word "Bearer".
     *
     * @var array<string, string>
     */
    private const array VALUE_PATTERNS = [
        '/\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+\/=]{8,}/i' => self::PLACEHOLDER,
        '/\b\d+\|[A-Za-z0-9]{32,}\b/' => self::PLACEHOLDER,
        '/\beyJ[A-Za-z0-9\-_]{8,}\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/' => self::PLACEHOLDER,
        '/([A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]*@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/' => '$1***@$2',
    ];

    public function __invoke(LogRecord $record): LogRecord
    {
        return $record->with(
            message: $this->scrub($record->message),
            context: $this->redact($record->context, 0),
            extra: $this->redact($record->extra, 0),
        );
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return array<array-key, mixed>
     */
    private function redact(array $values, int $depth): array
    {
        if ($depth >= self::MAX_DEPTH) {
            return [self::PLACEHOLDER];
        }

        $redacted = [];

        foreach ($values as $key => $value) {
            $redacted[$key] = $this->isDenied($key)
                ? self::PLACEHOLDER
                : $this->redactValue($value, $depth + 1);
        }

        return $redacted;
    }

    private function redactValue(mixed $value, int $depth): mixed
    {
        if (is_array($value)) {
            return $this->redact($value, $depth);
        }

        if (is_string($value)) {
            return $this->scrub($value);
        }

        // An exception in the context is the single most common way a secret
        // reaches a log file: the message quotes the offending input.
        if ($value instanceof Throwable) {
            return [
                'class' => $value::class,
                'message' => $this->scrub($value->getMessage()),
                'file' => $value->getFile(),
                'line' => $value->getLine(),
            ];
        }

        // PHP marks these parameters sensitive precisely so they are not
        // printed; honouring that here costs nothing.
        if ($value instanceof SensitiveParameterValue) {
            return self::PLACEHOLDER;
        }

        if ($value instanceof UnitEnum) {
            return $value;
        }

        if ($value instanceof Stringable) {
            return $this->scrub((string) $value);
        }

        if (is_object($value)) {
            return $this->redact(get_object_vars($value), $depth);
        }

        return $value;
    }

    private function scrub(string $value): string
    {
        foreach (self::VALUE_PATTERNS as $pattern => $replacement) {
            $value = (string) preg_replace($pattern, $replacement, $value);
        }

        return $value;
    }

    private function isDenied(int|string $key): bool
    {
        if (! is_string($key)) {
            return false;
        }

        $lower = strtolower($key);

        foreach (self::DENIED_KEYS as $denied) {
            if (str_contains($lower, $denied)) {
                return true;
            }
        }

        return false;
    }
}
