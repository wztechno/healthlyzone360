<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\ReferenceData\Models\MeasurementUnit;

/**
 * The workbook's unit spellings, mapped onto the platform's measurement units.
 *
 * Six spellings appear across the technical sheets for three units — `kg`,
 * `Kg`, `k`, `kg.`, `L` and `Piece` — and the product list adds `Ltr`, `Bag`,
 * `Can`, `Gallon` and `Bunch`. None of them is ambiguous to a reader and all of
 * them are ambiguous to a database, so the table is explicit and closed: a
 * spelling not listed here resolves to nothing and is reported, rather than
 * being guessed at by prefix.
 *
 * Case folding alone would not do it. `k` is not a prefix of `kg` by accident —
 * it is a typo — and `L` and `l` are the same unit while `Piece` and `Bag` are
 * not each other's plural.
 */
final class UnitMap
{
    /** @var array<string, string> workbook spelling (lower-cased) → platform unit code */
    private const array UNITS = [
        'kg' => 'kg',
        'kg.' => 'kg',
        'k' => 'kg',
        'kgs' => 'kg',
        'g' => 'g',
        'gr' => 'g',
        'l' => 'l',
        'lt' => 'l',
        'ltr' => 'l',
        'litre' => 'l',
        'ml' => 'ml',
        'piece' => 'piece',
        'pieces' => 'piece',
        'pc' => 'piece',
        'bag' => 'bag',
        'can' => 'can',
        'bottle' => 'bottle',
        'bunch' => 'bunch',
        'gallon' => 'gallon',
        'gal' => 'gallon',
        'pack' => 'pack',
    ];

    /** @var array<string, string>|null unit code → id */
    private static ?array $ids = null;

    /**
     * The platform unit code a workbook spelling means, or null.
     */
    public static function codeFor(?string $spelling): ?string
    {
        if ($spelling === null) {
            return null;
        }

        $key = mb_strtolower(trim($spelling));

        return self::UNITS[$key] ?? null;
    }

    /**
     * Whether a spelling is one the workbook writes oddly — recorded as a
     * finding so a reviewer sees that `k` was read as kilograms rather than
     * discovering it in a diff.
     */
    public static function isVariantSpelling(?string $spelling): bool
    {
        if ($spelling === null) {
            return false;
        }

        $code = self::codeFor($spelling);

        return $code !== null && $code !== trim($spelling);
    }

    public static function idFor(?string $spelling): ?string
    {
        $code = self::codeFor($spelling);

        return $code === null ? null : (self::ids()[$code] ?? null);
    }

    public static function idForCode(string $code): ?string
    {
        return self::ids()[$code] ?? null;
    }

    /**
     * @return array<string, string>
     */
    public static function ids(): array
    {
        /** @var array<string, string> */
        return self::$ids ??= MeasurementUnit::query()->pluck('id', 'code')->all();
    }

    /**
     * Forget the cached identifiers. Only tests need this — a run is one
     * process against one database.
     */
    public static function forget(): void
    {
        self::$ids = null;
    }
}
