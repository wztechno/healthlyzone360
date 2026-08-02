<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use RuntimeException;

/**
 * Reads and type-checks the JSON reference-data files a module ships in its
 * own `database/data/` directory. Seed data is validated at read time so a
 * malformed or truncated file fails the seeder loudly rather than writing
 * partial reference data.
 *
 * Other platform-reference modules (allergens, ingredients) read their own
 * files through `rowsIn()`: one validating reader for every committed
 * reference file beats a copy of it per module that can drift.
 */
final class SeedDataFile
{
    /**
     * A file shipped with the reference-data module itself.
     *
     * @return list<array<array-key, mixed>>
     */
    public static function rows(string $name): array
    {
        return self::rowsIn(dirname(__DIR__).'/data', $name);
    }

    /**
     * A file shipped with any module, named by its own data directory —
     * usually `dirname(__DIR__).'/data'` from that module's seeder.
     *
     * @return list<array<array-key, mixed>>
     */
    public static function rowsIn(string $directory, string $name): array
    {
        $path = self::path($directory, $name);
        $decoded = self::decode($path);

        $rows = [];

        foreach ($decoded as $row) {
            if (! is_array($row)) {
                throw new RuntimeException("Reference-data file [{$path}] must contain JSON objects only.");
            }

            $rows[] = $row;
        }

        return $rows;
    }

    /**
     * A file whose top level is a keyed document rather than a list — used
     * where one file carries several related collections that must stay in
     * step (the ingredient master's categories, ingredients and aliases).
     *
     * @return array<array-key, mixed>
     */
    public static function documentIn(string $directory, string $name): array
    {
        return self::decode(self::path($directory, $name));
    }

    private static function path(string $directory, string $name): string
    {
        return rtrim($directory, '/\\').'/'.$name.'.json';
    }

    /**
     * @return array<array-key, mixed>
     */
    private static function decode(string $path): array
    {
        $contents = file_get_contents($path);

        if ($contents === false) {
            throw new RuntimeException("Unable to read reference-data file [{$path}].");
        }

        $decoded = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);

        if (! is_array($decoded)) {
            throw new RuntimeException("Reference-data file [{$path}] must contain a JSON array or object.");
        }

        return $decoded;
    }

    /**
     * @param  array<array-key, mixed>  $row
     */
    public static function string(array $row, string $key): string
    {
        $value = $row[$key] ?? null;

        if (! is_string($value)) {
            throw new RuntimeException("Reference-data row is missing the string key [{$key}].");
        }

        return $value;
    }

    /**
     * The value of $key when present, otherwise the value of $fallbackKey.
     * Used for Arabic names, which are supplied for the launch markets and
     * fall back to the English name elsewhere.
     *
     * @param  array<array-key, mixed>  $row
     */
    public static function stringOr(array $row, string $key, string $fallbackKey): string
    {
        $value = $row[$key] ?? null;

        return is_string($value) ? $value : self::string($row, $fallbackKey);
    }

    /**
     * @param  array<array-key, mixed>  $row
     */
    public static function nullableString(array $row, string $key): ?string
    {
        $value = $row[$key] ?? null;

        if ($value === null) {
            return null;
        }

        if (! is_string($value)) {
            throw new RuntimeException("Reference-data row key [{$key}] must be a string or null.");
        }

        return $value;
    }

    /**
     * @param  array<array-key, mixed>  $row
     */
    public static function integer(array $row, string $key): int
    {
        $value = $row[$key] ?? null;

        if (! is_int($value)) {
            throw new RuntimeException("Reference-data row is missing the integer key [{$key}].");
        }

        return $value;
    }

    /**
     * @param  array<array-key, mixed>  $row
     */
    public static function nullableInteger(array $row, string $key): ?int
    {
        $value = $row[$key] ?? null;

        if ($value === null) {
            return null;
        }

        if (! is_int($value)) {
            throw new RuntimeException("Reference-data row key [{$key}] must be an integer or null.");
        }

        return $value;
    }

    /**
     * @param  array<array-key, mixed>  $row
     */
    public static function boolean(array $row, string $key): bool
    {
        $value = $row[$key] ?? null;

        if (! is_bool($value)) {
            throw new RuntimeException("Reference-data row is missing the boolean key [{$key}].");
        }

        return $value;
    }

    /**
     * @param  array<array-key, mixed>  $row
     * @return list<array<array-key, mixed>>
     */
    public static function rowList(array $row, string $key): array
    {
        $value = $row[$key] ?? [];

        if (! is_array($value)) {
            throw new RuntimeException("Reference-data row key [{$key}] must be an array.");
        }

        $rows = [];

        foreach ($value as $entry) {
            if (! is_array($entry)) {
                throw new RuntimeException("Reference-data row key [{$key}] must contain objects only.");
            }

            $rows[] = $entry;
        }

        return $rows;
    }
}
