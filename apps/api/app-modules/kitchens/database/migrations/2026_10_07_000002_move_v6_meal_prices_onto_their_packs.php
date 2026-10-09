<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Put a v6 meal's B2B and B2C prices on the packs that size them.
 *
 * `2026_10_07_000001` creates a meal's `b2b`/`b2c` packs and moves its prices onto them, but it
 * skips a meal that already has the packs — and a database imported before meals could carry packs
 * can hold exactly that: packs sized 1 kg and 200 g, and the importer's two prices sitting on the
 * item itself, where they resolve as a price with no size. This finishes the job for those rows.
 *
 * Only the importer's own rows move — open, base-tier, item-level, `source_ref` `{ref}/{channel}` —
 * and only onto an active pack of the same code that holds no open base price on that list, so a
 * price a kitchen set since is never overwritten and the one-open-row index is never contended.
 * A fresh database has no rows and this is a no-op; re-running finds nothing left to move.
 */
return new class extends Migration
{
    public function up(): void
    {
        /** @var array{source_system: string, items: list<array<string, mixed>>} $document */
        $document = json_decode(
            (string) file_get_contents(dirname(__DIR__).'/data/v6-catalogue.json'),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        foreach ($document['items'] as $item) {
            if ($item['sheet_item_type'] !== 'meal') {
                continue;
            }

            $mealId = DB::table('catalogue_items')
                ->where('source_system', $document['source_system'])
                ->where('source_ref', $item['source_ref'])
                ->where('item_type', 'meal')
                ->value('id');

            if (! is_string($mealId)) {
                continue;
            }

            foreach (array_keys((array) ($item['prices'] ?? [])) as $channel) {
                $packId = DB::table('catalogue_item_variants')
                    ->where('catalogue_item_id', $mealId)
                    ->where('code', $channel)
                    ->where('status', 'active')
                    ->value('id');

                if (! is_string($packId)) {
                    continue;
                }

                $rows = DB::table('price_list_items')
                    ->where('catalogue_item_id', $mealId)
                    ->where('source_ref', $item['source_ref'].'/'.$channel)
                    ->whereNull('catalogue_item_variant_id')
                    ->whereNull('min_quantity')
                    ->whereNull('effective_to')
                    ->get(['id', 'price_list_id']);

                foreach ($rows as $row) {
                    $packAlreadyPriced = DB::table('price_list_items')
                        ->where('price_list_id', $row->price_list_id)
                        ->where('catalogue_item_variant_id', $packId)
                        ->whereNull('min_quantity')
                        ->whereNull('effective_to')
                        ->exists();

                    if ($packAlreadyPriced) {
                        continue;
                    }

                    DB::table('price_list_items')
                        ->where('id', $row->id)
                        ->update(['catalogue_item_variant_id' => $packId, 'updated_at' => now()]);
                }
            }
        }
    }

    public function down(): void
    {
        // Deliberately one-way, like 2026_10_07_000001: back on the item, a 200 g price reads as
        // the price of the dish.
    }
};
