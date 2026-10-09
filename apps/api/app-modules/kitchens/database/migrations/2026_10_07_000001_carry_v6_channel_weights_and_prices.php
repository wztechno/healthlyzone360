<?php

declare(strict_types=1);

use Healthy360\Kitchens\Import\V6\V6CatalogueWriter;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Bring an already-imported v6 catalogue up to what `kitchen:import-v6` now writes, from the four
 * workbook columns B2B Weight, B2B Price, B2C Weight and B2C Price:
 *
 * - **Meals sold by weight get their packs.** A meal could not carry a pack when these rows were
 *   imported, so Caramelised Onions' 1 kg B2B and 200 g B2C collapsed into two sizeless
 *   item-level prices. Each priced channel now gets its `b2b` / `b2c` pack (B2C the default, as
 *   the importer orders them), and the importer's own price and channel rows for that channel
 *   move onto it. Rows a kitchen added by hand stay where they are.
 * - **The kitchen ingredient states the same prices**, per usage unit, so the ingredient list's
 *   B2B/B2C columns agree with the catalogue instead of reading "—". Only where both are empty,
 *   so a price somebody typed is never overwritten.
 *
 * The refs and figures are read from `v6-catalogue.json` and divided by
 * {@see V6CatalogueWriter::pricePerUsageUnit()}, so an upgraded database and a fresh import agree.
 * A fresh database has no rows yet and this is a no-op; every step checks before it writes, so it
 * is safe to re-run.
 */
return new class extends Migration
{
    /** @var array<string, string> price channel → the sales channel code the importer offers it on */
    private const array SALES_CHANNELS = ['b2c' => 'web-shop', 'b2b' => 'wholesale'];

    public function up(): void
    {
        /** @var array{source_system: string, items: list<array<string, mixed>>} $document */
        $document = json_decode(
            (string) file_get_contents(dirname(__DIR__).'/data/v6-catalogue.json'),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        $kilogram = DB::table('measurement_units')->where('code', 'kg')->value('id');

        foreach ($document['items'] as $item) {
            if (((array) ($item['prices'] ?? [])) === []) {
                continue;
            }

            $this->priceIngredient($document['source_system'], $item);

            if ($item['sheet_item_type'] === 'meal' && is_string($kilogram)) {
                $this->packMeal($document['source_system'], $item, $kilogram);
            }
        }
    }

    public function down(): void
    {
        // Deliberately one-way: once a price quotes a pack, moving it back to the item would
        // restate a 200 g price as the price of the dish.
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function priceIngredient(string $sourceSystem, array $item): void
    {
        $b2b = V6CatalogueWriter::pricePerUsageUnit($item, 'b2b');
        $b2c = V6CatalogueWriter::pricePerUsageUnit($item, 'b2c');

        if ($b2b === null && $b2c === null) {
            return;
        }

        DB::table('ingredients')
            ->whereNotNull('organisation_id')
            ->where('source_system', $sourceSystem)
            ->where('source_ref', $item['source_ref'])
            ->whereNull('b2b_price_amount')
            ->whereNull('b2c_price_amount')
            ->update([
                'b2b_price_amount' => $b2b,
                'b2c_price_amount' => $b2c,
                'price_currency_code' => 'USD',
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => now(),
            ]);
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function packMeal(string $sourceSystem, array $item, string $kilogramId): void
    {
        $meal = DB::table('catalogue_items')
            ->where('source_system', $sourceSystem)
            ->where('source_ref', $item['source_ref'])
            ->where('item_type', 'meal')
            ->first(['id', 'organisation_id']);

        if ($meal === null) {
            return;
        }

        /** @var array<string, mixed> $prices */
        $prices = (array) $item['prices'];

        foreach (self::SALES_CHANNELS as $channel => $salesChannelCode) {
            $weight = is_array($prices[$channel] ?? null) ? ($prices[$channel]['weight_kg'] ?? null) : null;

            if (! is_numeric($weight) || (float) $weight <= 0) {
                continue;
            }

            $alreadyPacked = DB::table('catalogue_item_variants')
                ->where('catalogue_item_id', $meal->id)
                ->where('code', $channel)
                ->exists();

            if ($alreadyPacked) {
                continue;
            }

            $hasDefault = DB::table('catalogue_item_variants')
                ->where('catalogue_item_id', $meal->id)
                ->where('is_default', true)
                ->exists();

            $variantId = (string) Str::uuid7();
            $label = sprintf('%s pack', strtoupper($channel));

            DB::table('catalogue_item_variants')->insert([
                'id' => $variantId,
                'organisation_id' => $meal->organisation_id,
                'catalogue_item_id' => $meal->id,
                'variant_type' => 'pack',
                'code' => $channel,
                'name_en' => $label,
                'name_ar' => $label,
                'is_default' => ! $hasDefault,
                'status' => 'active',
                'lock_version' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('catalogue_item_pack_variants')->insert([
                'catalogue_item_variant_id' => $variantId,
                'organisation_id' => $meal->organisation_id,
                'pack_quantity' => (string) $weight,
                'pack_unit_id' => $kilogramId,
                'net_weight_grams' => (int) round((float) $weight * 1000),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('price_list_items')
                ->where('catalogue_item_id', $meal->id)
                ->where('source_ref', $item['source_ref'].'/'.$channel)
                ->whereNull('catalogue_item_variant_id')
                ->update(['catalogue_item_variant_id' => $variantId, 'updated_at' => now()]);

            DB::table('channel_catalogue_items')
                ->where('catalogue_item_id', $meal->id)
                ->whereNull('catalogue_item_variant_id')
                ->whereIn('sales_channel_id', DB::table('sales_channels')
                    ->where('organisation_id', $meal->organisation_id)
                    ->where('code', $salesChannelCode)
                    ->select('id'))
                ->update(['catalogue_item_variant_id' => $variantId, 'updated_at' => now()]);
        }
    }
};
