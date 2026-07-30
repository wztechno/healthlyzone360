<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Database\Seeders;

use RuntimeException;

/**
 * Reads and type-checks the JSON reference-data files shipped with this
 * module (`database/data/*.json`). Seed data is validated at read time so a
 * malformed or truncated file fails the seeder loudly rather than writing
 * partial reference data.
 */
final class SeedDataFile
{
    /**
     * @return list<array<array-key, mixed>>
     */
    public static function rows(string $name): array
    {
        $path = dirname(__DIR__).'/data/'.$name.'.json';
        $contents = file_get_contents($path);

        if ($contents === false) {
            throw new RuntimeException("Unable to read reference-data file [{$path}].");
        }

        $decoded = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);

        if (! is_array($decoded)) {
            throw new RuntimeException("Reference-data file [{$path}] must contain a JSON array.");
        }

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
}
