<?php

declare(strict_types=1);

namespace Healthy360\Verification\Services;

use Healthy360\ReferenceData\Models\Language;

/**
 * Which way a message's text runs.
 *
 * Read from `languages.direction` rather than from a hard-coded list of
 * right-to-left codes. The platform already holds the fact — it is a column on
 * the reference table, seeded with the language — and a second list in the
 * mail layer would be a second answer to the same question, wrong the first
 * time somebody adds Hebrew or Farsi.
 *
 * Cached per request because a passcode mail asks once per send and the
 * reference table changes roughly never.
 */
final class LocaleDirection
{
    /** @var array<string, string> */
    private static array $cache = [];

    public static function for(string $locale): string
    {
        $code = mb_substr($locale, 0, 2);

        if (isset(self::$cache[$code])) {
            return self::$cache[$code];
        }

        $direction = Language::query()->whereKey($code)->value('direction');

        return self::$cache[$code] = is_string($direction) && $direction !== '' ? $direction : 'ltr';
    }

    /**
     * Test seam: the cache is static, so a suite that seeds a language after
     * a lookup would otherwise keep the first answer.
     */
    public static function forget(): void
    {
        self::$cache = [];
    }
}
