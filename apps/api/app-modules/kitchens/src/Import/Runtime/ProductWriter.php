<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\PackFormat;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Recipes\Models\Recipe;
use Illuminate\Support\Str;

/**
 * The 64-row product list: catalogue items, their pack variants, their prices
 * on the two channel tariffs, and the recipes some of them are made by.
 *
 * The interesting decisions are all about what the source does **not** say.
 *
 * - **"Not applicable" is an absence, not a price of nothing.** The channel gets
 *   no pack and no price row, and the item is not offered there. A zero would
 *   have been a lie a checkout could charge.
 * - **A dual pack is two variants.** `0.5 kg/1 kg` at `5.5/10` is two things a
 *   customer can buy at two prices, and one variant carrying "about five and a
 *   half or ten dollars" is not a price.
 * - **A dual pack with one price is priced once, on the pack the price fits.**
 *   Cheese Balls offers `0.5 kg/1 kg` for `12`; the 1 kg pack is priced and the
 *   half-kilo one is not, because halving somebody's price for them is
 *   inventing a commercial decision. Both the item and the report carry the flag.
 * - **"Depends on each day" is market-priced.** `is_market_priced` on the item
 *   and a NULL-amount `market_priced` row on the tariff, which the schema's own
 *   CHECK permits precisely so that "we price this daily" is representable
 *   without a number.
 * - **Pack text in a price cell buys nothing.** The Americain Beef Patty's
 *   wholesale price cell reads "1 bag (10 piece)". No row is written and the
 *   item is flagged; guessing which of the two neighbouring numbers was meant
 *   would be worse than leaving the cell unanswered.
 * - **Typos are recorded, not corrected.** "Supllier", "Diary", "Pesto Saue",
 *   "Americain" all survive verbatim in `data_quality_flags` and in the report.
 *   A merchandiser searching for what the sheet said has to be able to find it.
 * - **An assorted row stays one listing.** "Cucumber, Tomato, Onion, carrot,
 *   White Cabbage, Red Cabbage…(All Kinds)" is how the kitchen sells vegetables,
 *   so it is one `is_assorted` item whose members are expanded into
 *   `catalogue_item_ingredients` — visible, searchable, and not six invented
 *   products.
 *
 * Everything lands `draft`. Publication needs an Arabic name, an active variant
 * and an allergen basis, none of which a product list supplies.
 */
final readonly class ProductWriter
{
    public function __construct(
        private DesignationDictionary $dictionary,
        private DesignationResolver $resolver,
        private string $sourceSystem,
    ) {}

    /**
     * @param  array{rows: list<array<string, mixed>>, findings: list<array{code: string, detail: string, source_ref: string|null}>}  $parsed
     * @param  array<string, SalesChannel>  $channels
     * @param  array<string, PriceList>  $priceLists
     */
    public function write(
        array $parsed,
        string $organisationId,
        Catalogue $catalogue,
        array $channels,
        array $priceLists,
        ImportReport $report,
    ): void {
        $report->findings($parsed['findings'], SourceManifest::PRODUCTS);

        $categories = $this->categoryIds();
        $recipes = $this->recipeIdsByName($organisationId);

        foreach ($parsed['rows'] as $row) {
            $this->writeRow($row, $organisationId, $catalogue, $channels, $priceLists, $categories, $recipes, $report);
        }

        foreach ($this->dictionary->declinedRecipeLinks() as $declined) {
            $report->knownGap(
                'product_recipe_link_declined',
                sprintf('"%s" is not linked to the "%s" sheet. %s', $declined['product'], $declined['candidate'], $declined['reason']),
            );
        }
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, SalesChannel>  $channels
     * @param  array<string, PriceList>  $priceLists
     * @param  array<string, string>  $categories
     * @param  array<string, string>  $recipes
     */
    private function writeRow(
        array $row,
        string $organisationId,
        Catalogue $catalogue,
        array $channels,
        array $priceLists,
        array $categories,
        array $recipes,
        ImportReport $report,
    ): void {
        /** @var string $product */
        $product = $row['product'];
        $sourceRef = SourceManifest::PRODUCTS.'#Sheet1/row-'.$row['row'];

        $existing = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', $this->sourceSystem)
            ->where('source_ref', $sourceRef)
            ->first();

        if ($existing instanceof CatalogueItem) {
            // The item is the unit of idempotency: its variants, packs, member
            // ingredients and channel rows all hang off it and carry no source
            // reference of their own, so the whole subtree is left alone.
            //
            // Its children are counted as skipped anyway. A re-run report that
            // said "1 item skipped" and nothing about the four price rows and
            // three packs underneath it would understate what was protected,
            // and the skipped counts are precisely the evidence that an
            // operator's edits survived.
            $report->skipped('catalogue_item');
            $report->skipped('catalogue_item_variant', CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $existing->getKey())
                ->count());
            $report->skipped('price_list_item', PriceListItem::withoutTenancy()
                ->where('catalogue_item_id', $existing->getKey())
                ->count());

            return;
        }

        $report->created('catalogue_item');

        /** @var list<array{code: string, label: string, quantity: string|null, unit: string|null, piece_count: int|null, format: string|null, net_weight_grams: int|null}> $packs */
        $packs = $row['packs'];
        /** @var list<array{channel: string, pack_code: string|null, amount_minor: int|null, status: string, note: string|null}> $prices */
        $prices = $row['prices'];
        /** @var list<string> $flags */
        $flags = $row['flags'];

        foreach ($flags as $flag) {
            $report->finding('product_'.$flag, sprintf('"%s" (%s) is flagged %s.', $product, $sourceRef, $flag), $sourceRef);
        }

        $item = new CatalogueItem;
        $item->organisation_id = $organisationId;
        $item->catalogue_id = (string) $catalogue->getKey();
        $item->item_type = CatalogueItemType::Product;
        $item->slug = $this->slug($product, $row['row'], $organisationId);
        $item->name_en = $product;

        // English in the Arabic column, deliberately and visibly. The product
        // list is English-only, the publish gate refuses an item whose Arabic
        // name is empty, and an empty column would look like an oversight while
        // a machine translation would look like a decision. This looks like
        // exactly what it is.
        $item->name_ar = $product;
        $item->product_category_id = $categories[(string) ($row['category_code'] ?? '')] ?? null;
        $item->production_mode = $this->productionMode($row);
        $item->recipe_id = $this->recipeIdFor($product, $recipes, $report, $sourceRef);
        $item->purchasing_unit_id = UnitMap::idFor(is_string($row['purchasing_unit'] ?? null) ? $row['purchasing_unit'] : null);
        $item->usage_unit_id = UnitMap::idFor(is_string($row['usage_unit'] ?? null) ? $row['usage_unit'] : null);
        $item->is_market_priced = (bool) $row['is_market_priced'];
        $item->is_assorted = (bool) $row['is_assorted'];
        $item->status = CatalogueItemStatus::Draft;
        $item->data_quality_flags = $this->qualityFlags($row);
        $item->source_system = $this->sourceSystem;
        $item->source_ref = $sourceRef;
        $item->seeded_at = now();
        $item->lock_version = 0;
        $item->save();

        $variants = $this->writeVariants($item, $packs, $organisationId, $report);
        $this->writeMembers($item, $row, $organisationId, $sourceRef, $report);
        $this->writePrices($item, $variants, $prices, $priceLists, $organisationId, $sourceRef, $report);
        $this->writeAvailability($item, $variants, $prices, $channels, $organisationId, $report);
    }

    /**
     * @param  list<array{code: string, label: string, quantity: string|null, unit: string|null, piece_count: int|null, format: string|null, net_weight_grams: int|null}>  $packs
     * @return array<string, CatalogueItemVariant> pack code → variant
     */
    private function writeVariants(CatalogueItem $item, array $packs, string $organisationId, ImportReport $report): array
    {
        $variants = [];

        foreach ($packs as $index => $pack) {
            $variant = new CatalogueItemVariant;
            $variant->organisation_id = $organisationId;
            $variant->catalogue_item_id = (string) $item->getKey();
            $variant->variant_type = VariantType::Pack;
            $variant->code = $pack['code'];
            $variant->name_en = $pack['label'];
            $variant->name_ar = $pack['label'];
            $variant->is_default = $index === 0;
            $variant->status = VariantStatus::Active;
            $variant->lock_version = 0;
            $variant->save();

            $report->created('catalogue_item_variant');

            $unitId = UnitMap::idFor($pack['unit']) ?? UnitMap::idForCode('piece');

            if ($pack['quantity'] !== null && $unitId !== null) {
                $packVariant = new CatalogueItemPackVariant;
                $packVariant->catalogue_item_variant_id = (string) $variant->getKey();
                $packVariant->organisation_id = $organisationId;
                $packVariant->pack_quantity = $pack['quantity'];
                $packVariant->pack_unit_id = $unitId;
                $packVariant->pack_piece_count = $pack['piece_count'];
                $packVariant->pack_format = $pack['format'] === null ? null : PackFormat::tryFrom($pack['format']);
                $packVariant->net_weight_grams = $pack['net_weight_grams'];
                $packVariant->save();

                $report->created('catalogue_item_pack_variant');
            }

            $variants[$pack['code']] = $variant;
        }

        return $variants;
    }

    /**
     * The individual vegetables behind an assorted row.
     *
     * @param  array<string, mixed>  $row
     */
    private function writeMembers(CatalogueItem $item, array $row, string $organisationId, string $sourceRef, ImportReport $report): void
    {
        if (! $row['is_assorted']) {
            return;
        }

        /** @var list<string> $members */
        $members = $row['member_designations'];
        $order = 0;
        $seen = [];

        foreach ($members as $member) {
            $ingredientId = $this->resolver->resolve($member);

            if ($ingredientId === null) {
                $report->failed('catalogue_item_ingredient');
                $report->unresolvedDesignation($member, $sourceRef.' (assorted member)', 'the member is omitted from the listing');

                continue;
            }

            if (in_array($ingredientId, $seen, true)) {
                continue;
            }

            $seen[] = $ingredientId;

            $link = new CatalogueItemIngredient;
            $link->organisation_id = $organisationId;
            $link->catalogue_item_id = (string) $item->getKey();
            $link->ingredient_id = $ingredientId;
            $link->is_representative = true;
            $link->display_order = ++$order;
            $link->save();

            $report->created('catalogue_item_ingredient');
        }
    }

    /**
     * @param  array<string, CatalogueItemVariant>  $variants
     * @param  list<array{channel: string, pack_code: string|null, amount_minor: int|null, status: string, note: string|null}>  $prices
     * @param  array<string, PriceList>  $priceLists
     */
    private function writePrices(
        CatalogueItem $item,
        array $variants,
        array $prices,
        array $priceLists,
        string $organisationId,
        string $sourceRef,
        ImportReport $report,
    ): void {
        foreach ($prices as $index => $price) {
            $listCode = $price['channel'] === 'b2b' ? KitchenWorkbookWorld::PRICE_LIST_B2B : KitchenWorkbookWorld::PRICE_LIST_B2C;
            $list = $priceLists[$listCode] ?? null;

            if (! $list instanceof PriceList) {
                continue;
            }

            $variant = $price['pack_code'] === null ? null : ($variants[$price['pack_code']] ?? null);
            $rowRef = $sourceRef.'/'.$price['channel'].'-'.$index;

            $existing = PriceListItem::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('source_system', $this->sourceSystem)
                ->where('source_ref', $rowRef)
                ->exists();

            if ($existing) {
                $report->skipped('price_list_item');

                continue;
            }

            $entry = new PriceListItem;
            $entry->organisation_id = $organisationId;
            $entry->price_list_id = (string) $list->getKey();
            $entry->catalogue_item_id = (string) $item->getKey();
            $entry->catalogue_item_variant_id = $variant === null ? null : (string) $variant->getKey();
            $entry->min_quantity = null;
            $entry->unit_amount_minor = $price['amount_minor'];
            $entry->price_status = PriceStatus::from($price['status']);

            // Effective from today, open-ended. The workbook carries no dates,
            // and inventing a start in the past would fabricate a price history
            // that could be quoted back at the kitchen.
            $entry->effective_from = now()->startOfDay();
            $entry->effective_to = null;
            $entry->source_system = $this->sourceSystem;
            $entry->source_ref = $rowRef;
            $entry->seeded_at = now();
            $entry->save();

            $report->created('price_list_item');
        }
    }

    /**
     * Which channels offer the item, derived from which channel priced it.
     *
     * @param  array<string, CatalogueItemVariant>  $variants
     * @param  list<array{channel: string, pack_code: string|null, amount_minor: int|null, status: string, note: string|null}>  $prices
     * @param  array<string, SalesChannel>  $channels
     */
    private function writeAvailability(
        CatalogueItem $item,
        array $variants,
        array $prices,
        array $channels,
        string $organisationId,
        ImportReport $report,
    ): void {
        $offered = [];

        foreach ($prices as $price) {
            $channelCode = $price['channel'] === 'b2b' ? KitchenWorkbookWorld::CHANNEL_B2B : KitchenWorkbookWorld::CHANNEL_B2C;
            $variantId = $price['pack_code'] === null
                ? null
                : (isset($variants[$price['pack_code']]) ? (string) $variants[$price['pack_code']]->getKey() : null);

            $offered[$channelCode.'|'.($variantId ?? '')] = [$channelCode, $variantId];
        }

        foreach ($offered as [$channelCode, $variantId]) {
            $channel = $channels[$channelCode] ?? null;

            if (! $channel instanceof SalesChannel) {
                continue;
            }

            $row = new ChannelCatalogueItem;
            $row->organisation_id = $organisationId;
            $row->sales_channel_id = (string) $channel->getKey();
            $row->catalogue_item_id = (string) $item->getKey();
            $row->catalogue_item_variant_id = $variantId;
            $row->is_available = true;
            $row->save();

            $report->created('channel_catalogue_item');
        }
    }

    /**
     * The item's data-quality flags: the parser's machine codes, plus the
     * source's own spellings wherever this import normalised one.
     *
     * A flat list of strings because the column is one (`list<string>|null`),
     * and the verbatim spellings are prefixed rather than nested so that
     * "Supllier" is greppable from the row itself. Recording the typo is the
     * point — a merchandiser searching for what the sheet said has to find it,
     * and a corrected spelling is indistinguishable from a *different* value.
     *
     * @param  array<string, mixed>  $row
     * @return list<string>|null
     */
    private function qualityFlags(array $row): ?array
    {
        /** @var list<string> $flags */
        $flags = $row['flags'];

        $verbatim = [
            'source_kind' => $row['kind_verbatim'] ?? null,
            'source_category' => $row['category_verbatim'] ?? null,
            'source_purchasing_unit' => $row['purchasing_unit'] ?? null,
            'source_usage_unit' => $row['usage_unit'] ?? null,
            'source_comment' => $row['comments'] ?? null,
        ];

        foreach ($verbatim as $key => $value) {
            if (is_string($value) && trim($value) !== '') {
                $flags[] = $key.': '.trim($value);
            }
        }

        return $flags === [] ? null : $flags;
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function productionMode(array $row): ?ProductionMode
    {
        $kind = $row['kind'] ?? null;

        return is_string($kind) ? ProductionMode::tryFrom($kind) : null;
    }

    /**
     * @param  array<string, string>  $recipes
     */
    private function recipeIdFor(string $product, array $recipes, ImportReport $report, string $sourceRef): ?string
    {
        $designation = $this->dictionary->recipeFor($product);

        if ($designation === null) {
            return null;
        }

        $id = $recipes[mb_strtolower($designation)] ?? null;

        if ($id === null) {
            $report->finding(
                'product_recipe_link_unresolved',
                sprintf('"%s" is curated onto the "%s" technical sheet, and no recipe of that name was imported.', $product, $designation),
                $sourceRef,
            );

            return null;
        }

        return $id;
    }

    /**
     * @return array<string, string> lower-cased recipe name → id
     */
    private function recipeIdsByName(string $organisationId): array
    {
        $recipes = [];

        foreach (Recipe::withoutTenancy()->where('organisation_id', $organisationId)->get(['id', 'name_en']) as $recipe) {
            $recipes[mb_strtolower($recipe->name_en)] = (string) $recipe->getKey();
        }

        return $recipes;
    }

    /**
     * @return array<string, string>
     */
    private function categoryIds(): array
    {
        /** @var array<string, string> */
        return ProductCategory::withoutTenancy()->whereNull('organisation_id')->pluck('id', 'code')->all();
    }

    /**
     * A slug that stays unique even when the source repeats a name — the row
     * number is the tie-break, and it is also how an operator finds the row.
     */
    private function slug(string $product, mixed $row, string $organisationId): string
    {
        $slug = mb_substr(Str::slug($product), 0, 120);
        $slug = $slug === '' ? 'product-'.$row : $slug;

        $taken = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('slug', $slug)
            ->exists();

        return $taken ? $slug.'-row-'.$row : $slug;
    }
}
