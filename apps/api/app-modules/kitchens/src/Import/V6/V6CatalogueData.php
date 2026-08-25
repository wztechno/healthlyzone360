<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\V6;

use RuntimeException;

/**
 * The committed v6 catalogue document, loaded and shape-checked.
 *
 * The document is produced by `scripts/convert-v6-workbook.py`, which repairs
 * every known defect of the source xlsx and asserts its own output — so this
 * loader validates *shape*, not content. A key the writer would read that is
 * absent is a fatal error, loudly, before anything touches the database; a key
 * it does not read is ignored, so the converter may grow the document without
 * breaking an older API build.
 */
final class V6CatalogueData
{
    /**
     * @param  list<array<string, mixed>>  $items
     */
    private function __construct(
        public readonly string $sourceSystem,
        public readonly array $items,
    ) {}

    public static function committedPath(): string
    {
        return dirname(__DIR__, 3).'/database/data/v6-catalogue.json';
    }

    public static function load(?string $path = null): self
    {
        $path ??= self::committedPath();

        if (! is_file($path)) {
            throw new RuntimeException("The v6 catalogue document does not exist at [{$path}].");
        }

        $raw = file_get_contents($path);

        if ($raw === false) {
            throw new RuntimeException("The v6 catalogue document at [{$path}] could not be read.");
        }

        $decoded = json_decode($raw, true);

        if (! is_array($decoded) || ! is_string($decoded['source_system'] ?? null) || ! is_array($decoded['items'] ?? null)) {
            throw new RuntimeException("The v6 catalogue document at [{$path}] is not the expected shape (source_system + items).");
        }

        $items = [];

        foreach ($decoded['items'] as $index => $item) {
            if (! is_array($item)) {
                throw new RuntimeException("Item [{$index}] of the v6 catalogue document is not an object.");
            }

            foreach (['source_ref', 'sheet_item_type', 'name_en', 'slug', 'usage_unit_code'] as $key) {
                if (! is_string($item[$key] ?? null) || trim((string) $item[$key]) === '') {
                    throw new RuntimeException("Item [{$index}] of the v6 catalogue document is missing [{$key}].");
                }
            }

            if (! in_array($item['sheet_item_type'], ['sauce', 'dressing', 'meal', 'product'], true)) {
                throw new RuntimeException(sprintf(
                    'Item [%s] carries the unknown type [%s].',
                    $item['source_ref'],
                    (string) $item['sheet_item_type'],
                ));
            }

            $items[] = $item;
        }

        return new self($decoded['source_system'], $items);
    }
}
