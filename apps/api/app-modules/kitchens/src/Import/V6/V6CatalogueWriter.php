<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\V6;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\ProductCategory;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Kitchens\Import\Runtime\ImportOptions;
use Healthy360\Kitchens\Import\Runtime\ImportReport;
use Healthy360\Kitchens\Import\Runtime\KitchenWorkbookWorld;
use Healthy360\Kitchens\Import\Runtime\UnitMap;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Writes the committed v6 catalogue into one kitchen organisation.
 *
 * One uniform row shape covers all four families (sauces, dressings, meals,
 * resale products), so this is one writer rather than the per-sheet writers of
 * the original import — the converter already did the per-sheet thinking.
 *
 * The old importer's disciplines are kept exactly:
 *
 * - **One transaction.** A dry run executes the real write path and rolls it
 *   back in a `finally`; a failure anywhere writes nothing.
 * - **Insert-if-absent** on `(organisation, source_system, source_ref)`, the
 *   sheet's own ID column (`SAC-001`, …) as the stable ref. A re-run skips
 *   what exists and never updates it, so an operator's edit survives.
 * - **Everything lands draft.** Publication is `kitchen:publish-ready`,
 *   after tariffs are activated — a separate, human-invoked act.
 *
 * What is deliberately absent:
 *
 * - **No recipes.** The sheets say `Source: Recipe Library`, but after the v6
 *   reset no recipe library exists to link to, and a fabricated empty recipe
 *   is a lie with a foreign key. The reference is preserved verbatim in
 *   `data_quality_flags` (`recipe_library_unlinked` + the source wording) and
 *   counted in the report, so the later recipe phase can find every row that
 *   is waiting for one.
 * - **No fabricated allergen basis.** An `Ingredient? = Yes` row gets a real
 *   org ingredient carrying the sheet's declared allergens, and the catalogue
 *   item's `ingredient_id` link *is* its allergen basis — the same semantics
 *   resale products and order consumption already use. Rows without that
 *   link and without a recipe stay honestly unpublishable.
 */
final readonly class V6CatalogueWriter
{
    public function __construct(
        private KitchenWorkbookWorld $world,
        private TenantContext $context,
        private DatabaseTenantContext $database,
        private AuditRecorder $audit,
    ) {}

    public function run(ImportOptions $options, ImportReport $report, ?string $dataPath = null): ImportReport
    {
        $data = V6CatalogueData::load($dataPath);

        $write = function () use ($data, $options, $report): void {
            $this->write($data, $options, $report);
        };

        $options->writes() ? DB::transaction($write) : $this->rollBackAfter($write);

        $report->finish();

        return $report;
    }

    private function write(V6CatalogueData $data, ImportOptions $options, ImportReport $report): void
    {
        $world = $this->world->establish($options->organisationSlug, $report);
        $organisationId = (string) $world['organisation']->getKey();

        $productCategoryIds = $this->platformProductCategoryIds();
        $ingredientCategoryIds = $this->platformIngredientCategoryIds();

        $recipeLibraryRows = 0;

        foreach ($data->items as $item) {
            /** @var list<string> $flags */
            $flags = array_values(array_map(strval(...), (array) ($item['flags'] ?? [])));

            if (in_array('recipe_library_unlinked', $flags, true)) {
                $recipeLibraryRows++;
            }

            foreach ($flags as $flag) {
                if (str_starts_with($flag, 'allergen_unmapped:')) {
                    $report->allergenReviewItem('allergen_unmapped', sprintf(
                        '%s — the source wording %s maps to no canonical code and was dropped.',
                        (string) $item['source_ref'],
                        substr($flag, strlen('allergen_unmapped:')),
                    ), (string) $item['source_ref']);
                }
            }

            $this->writeItem($item, $flags, $data->sourceSystem, $organisationId, $world, $productCategoryIds, $ingredientCategoryIds, $report);
        }

        if ($recipeLibraryRows > 0) {
            $report->knownGap('recipe_library_unlinked', sprintf(
                '%d rows say "Source: Recipe Library", and no recipe library exists to link them to yet. '
                .'The reference is preserved on each row in data_quality_flags; the recipe phase links them.',
                $recipeLibraryRows,
            ));
        }
    }

    /**
     * @param  array<string, mixed>  $item
     * @param  list<string>  $flags
     * @param  array{organisation: mixed, branch: mixed, channels: array<string, SalesChannel>, price_lists: array<string, PriceList>, catalogue: mixed}  $world
     * @param  array<string, string>  $productCategoryIds
     * @param  array<string, string>  $ingredientCategoryIds
     */
    private function writeItem(
        array $item,
        array $flags,
        string $sourceSystem,
        string $organisationId,
        array $world,
        array $productCategoryIds,
        array $ingredientCategoryIds,
        ImportReport $report,
    ): void {
        $sourceRef = (string) $item['source_ref'];

        $exists = CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', $sourceSystem)
            ->where('source_ref', $sourceRef)
            ->exists();

        if ($exists) {
            // The item is the unit of idempotency: its ingredient, variants,
            // prices and channel rows are skipped as one block.
            $report->skipped('catalogue_item');

            return;
        }

        $ingredientId = ((bool) ($item['is_ingredient'] ?? false))
            ? $this->writeIngredient($item, $sourceSystem, $organisationId, $ingredientCategoryIds, $report)
            : null;

        $usageUnitId = $this->unitId((string) $item['usage_unit_code']);
        $purchaseUnitId = is_string($item['purchase_unit_code'] ?? null)
            ? $this->unitId((string) $item['purchase_unit_code'])
            : null;

        $publishedCategoryCode = $item['published_category_code'] ?? null;

        $catalogueItem = new CatalogueItem;
        $catalogueItem->organisation_id = $organisationId;
        $catalogueItem->catalogue_id = (string) $world['catalogue']->getKey();
        $catalogueItem->item_type = CatalogueItemType::from((string) $item['sheet_item_type']);
        $catalogueItem->slug = (string) $item['slug'];
        $catalogueItem->name_en = (string) $item['name_en'];

        // The sheet is English-only. The English name rather than "" because
        // these rows must be publishable once priced: an untranslated block
        // on all 155 rows would make the import a dead end, and the visible
        // fallback is the convention the original importer already set.
        $catalogueItem->name_ar = (string) $item['name_en'];
        $catalogueItem->product_category_id = is_string($publishedCategoryCode)
            ? ($productCategoryIds[$publishedCategoryCode] ?? null)
            : null;
        $catalogueItem->production_mode = ProductionMode::from((string) $item['production_mode']);
        $catalogueItem->recipe_id = null;
        $catalogueItem->ingredient_id = $ingredientId;
        $catalogueItem->purchasing_unit_id = $purchaseUnitId;
        $catalogueItem->usage_unit_id = $usageUnitId;
        $catalogueItem->composition = $this->trimmedOrNull($item['composition'] ?? null);
        $catalogueItem->kitchen_category = $this->trimmedOrNull($item['kitchen_category'] ?? null);
        $catalogueItem->kitchen_subcategory = $this->trimmedOrNull($item['kitchen_subcategory'] ?? null);
        $catalogueItem->is_market_priced = false;
        $catalogueItem->is_assorted = false;
        $catalogueItem->status = CatalogueItemStatus::Draft;
        $catalogueItem->data_quality_flags = $this->qualityFlags($item, $flags);
        $catalogueItem->source_system = $sourceSystem;
        $catalogueItem->source_ref = $sourceRef;
        $catalogueItem->seeded_at = now();
        $catalogueItem->lock_version = 0;
        $catalogueItem->save();

        $report->created('catalogue_item');

        $variants = $this->writeVariants($catalogueItem, $item, $organisationId, $usageUnitId, $report);
        $this->writePrices($catalogueItem, $item, $variants, $world['price_lists'], $sourceSystem, $organisationId, $sourceRef, $report);
        $this->writeChannels($catalogueItem, $item, $variants, $world['channels'], $organisationId, $report);
    }

    /**
     * The org ingredient an `Ingredient? = Yes` row becomes — a real,
     * kitchen-managed row (unlike derivation's hidden anchors), carrying the
     * sheet's declared allergens as `kitchen_declared` mappings.
     *
     * @param  array<string, mixed>  $item
     * @param  array<string, string>  $ingredientCategoryIds
     */
    private function writeIngredient(
        array $item,
        string $sourceSystem,
        string $organisationId,
        array $ingredientCategoryIds,
        ImportReport $report,
    ): ?string {
        $sourceRef = (string) $item['source_ref'];

        $existing = Ingredient::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('source_system', $sourceSystem)
            ->where('source_ref', $sourceRef)
            ->first();

        if ($existing instanceof Ingredient) {
            $report->skipped('ingredient');

            return (string) $existing->getKey();
        }

        $categoryCode = $item['category_code'] ?? null;
        $subcategoryCode = $item['subcategory_code'] ?? null;

        $ingredient = new Ingredient;
        $ingredient->organisation_id = $organisationId;
        $ingredient->slug = (string) $item['slug'];
        $ingredient->name_en = (string) $item['name_en'];
        $ingredient->name_ar = (string) $item['name_en'];
        $ingredient->ingredient_category_id = is_string($categoryCode) ? ($ingredientCategoryIds[$categoryCode] ?? null) : null;
        $ingredient->ingredient_subcategory_id = is_string($subcategoryCode) ? ($ingredientCategoryIds[$subcategoryCode] ?? null) : null;
        $ingredient->default_unit_id = $this->unitId((string) $item['usage_unit_code']);
        $ingredient->purchase_unit_id = is_string($item['purchase_unit_code'] ?? null)
            ? $this->unitId((string) $item['purchase_unit_code'])
            : null;
        $ingredient->composition = $this->trimmedOrNull($item['composition'] ?? null);
        $ingredient->items_per_unit = is_numeric($item['items_per_unit'] ?? null) ? (string) $item['items_per_unit'] : null;
        $ingredient->yield_factor = '1';
        $ingredient->status = IngredientStatus::Active;
        $ingredient->verification_status = IngredientVerificationStatus::Unverified;
        $ingredient->source_system = $sourceSystem;
        $ingredient->source_ref = $sourceRef;
        $ingredient->seeded_at = now();
        $ingredient->lock_version = 0;
        $ingredient->save();

        $report->created('ingredient');

        foreach ((array) ($item['allergens'] ?? []) as $mapping) {
            if (! is_array($mapping) || ! is_string($mapping['allergen_code'] ?? null)) {
                continue;
            }

            $row = new IngredientAllergen;
            $row->ingredient_id = (string) $ingredient->getKey();
            $row->allergen_code = $mapping['allergen_code'];
            $row->organisation_id = $organisationId;
            $row->containment = AllergenContainment::from((string) ($mapping['containment'] ?? AllergenContainment::Contains->value));
            $row->market_scope = AllergenMarketScope::from((string) ($mapping['market_scope'] ?? AllergenMarketScope::All->value));

            // The kitchen's own workbook is the kitchen's own declaration —
            // not a supplier sheet, not the platform master list.
            $row->source = AllergenMappingSource::KitchenDeclared;
            $row->verification_status = AllergenVerificationStatus::from(
                (string) ($mapping['verification_status'] ?? AllergenVerificationStatus::Unverified->value),
            );
            $row->evidence = $this->trimmedOrNull($mapping['evidence'] ?? ($item['allergen_evidence'] ?? null));
            $row->save();

            $report->created('ingredient_allergen');
        }

        return (string) $ingredient->getKey();
    }

    /**
     * The sellable packs. A row priced per channel gets a `b2b` and/or `b2c`
     * pack variant sized by the sheet's weights; an unpriced row gets one
     * `unit` variant in its usage unit, so the item has something a price can
     * attach to the day somebody prices it.
     *
     * @param  array<string, mixed>  $item
     * @return array<string, CatalogueItemVariant> variant code → variant
     */
    private function writeVariants(
        CatalogueItem $catalogueItem,
        array $item,
        string $organisationId,
        string $usageUnitId,
        ImportReport $report,
    ): array {
        /** @var array<string, array{weight_kg: float|int|null, price_minor: int, currency: string}> $prices */
        $prices = (array) ($item['prices'] ?? []);

        $definitions = [];

        // B2C first: the consumer pack is the default the marketplace shows.
        foreach (['b2c', 'b2b'] as $channel) {
            $price = $prices[$channel] ?? null;

            if (! is_array($price)) {
                continue;
            }

            $weight = $price['weight_kg'] ?? null;

            $definitions[] = [
                'code' => $channel,
                'label' => sprintf('%s pack', strtoupper($channel)),
                'quantity' => is_numeric($weight) ? (string) $weight : null,
                'unit_id' => UnitMap::idForCode('kg'),
                'piece_count' => $this->pieceCount($item, $weight),
                'net_weight_grams' => is_numeric($weight) ? (int) round((float) $weight * 1000) : null,
            ];
        }

        if ($definitions === []) {
            $definitions[] = [
                'code' => 'unit',
                'label' => 'Unit',
                'quantity' => '1',
                'unit_id' => $usageUnitId,
                'piece_count' => $this->pieceCount($item, 1),
                'net_weight_grams' => null,
            ];
        }

        $variants = [];

        foreach ($definitions as $index => $definition) {
            $variant = new CatalogueItemVariant;
            $variant->organisation_id = $organisationId;
            $variant->catalogue_item_id = (string) $catalogueItem->getKey();
            $variant->variant_type = VariantType::Pack;
            $variant->code = $definition['code'];
            $variant->name_en = $definition['label'];
            $variant->name_ar = $definition['label'];
            $variant->is_default = $index === 0;
            $variant->status = VariantStatus::Active;
            $variant->lock_version = 0;
            $variant->save();

            $report->created('catalogue_item_variant');

            if ($definition['quantity'] !== null && is_string($definition['unit_id'])) {
                $pack = new CatalogueItemPackVariant;
                $pack->catalogue_item_variant_id = (string) $variant->getKey();
                $pack->organisation_id = $organisationId;
                $pack->pack_quantity = $definition['quantity'];
                $pack->pack_unit_id = $definition['unit_id'];
                $pack->pack_piece_count = $definition['piece_count'];
                $pack->pack_format = null;
                $pack->net_weight_grams = $definition['net_weight_grams'];
                $pack->save();

                $report->created('catalogue_item_pack_variant');
            }

            $variants[$definition['code']] = $variant;
        }

        return $variants;
    }

    /**
     * Pieces in a pack of this weight, where the sheet knows it. The sheet
     * records pieces per **one** purchase unit, so only a one-unit pack can
     * honestly carry the number.
     *
     * @param  array<string, mixed>  $item
     */
    private function pieceCount(array $item, mixed $weight): ?int
    {
        $perUnit = $item['pieces_per_pack'] ?? $item['items_per_unit'] ?? null;

        if (! is_numeric($perUnit) || ! is_numeric($weight) || (float) $weight !== 1.0) {
            return null;
        }

        $count = (int) round((float) $perUnit);

        return $count > 0 ? $count : null;
    }

    /**
     * Confirmed rows on the B2B/B2C tariffs — only where the sheet carries a
     * number. A blank price cell writes nothing: the marketplace structurally
     * hides unpriced items, which is exactly the "kitchen-visible,
     * customer-hidden" behaviour the source asks for.
     *
     * @param  array<string, mixed>  $item
     * @param  array<string, CatalogueItemVariant>  $variants
     * @param  array<string, PriceList>  $priceLists
     */
    private function writePrices(
        CatalogueItem $catalogueItem,
        array $item,
        array $variants,
        array $priceLists,
        string $sourceSystem,
        string $organisationId,
        string $sourceRef,
        ImportReport $report,
    ): void {
        /** @var array<string, array{weight_kg: float|int|null, price_minor: int, currency: string}> $prices */
        $prices = (array) ($item['prices'] ?? []);

        foreach ($prices as $channel => $price) {
            if (! is_array($price) || ! is_int($price['price_minor'] ?? null)) {
                continue;
            }

            $listCode = $channel === 'b2b' ? KitchenWorkbookWorld::PRICE_LIST_B2B : KitchenWorkbookWorld::PRICE_LIST_B2C;
            $list = $priceLists[$listCode] ?? null;
            $variant = $variants[$channel] ?? null;

            if (! $list instanceof PriceList || ! $variant instanceof CatalogueItemVariant) {
                throw new RuntimeException("The world is missing the {$listCode} tariff or the {$channel} pack for [{$sourceRef}].");
            }

            $entry = new PriceListItem;
            $entry->organisation_id = $organisationId;
            $entry->price_list_id = (string) $list->getKey();
            $entry->catalogue_item_id = (string) $catalogueItem->getKey();
            $entry->catalogue_item_variant_id = (string) $variant->getKey();
            $entry->min_quantity = null;
            $entry->unit_amount_minor = $price['price_minor'];
            $entry->price_status = PriceStatus::Confirmed;

            // Effective from today, open-ended: the sheet carries no dates,
            // and an invented past start would fabricate a price history.
            $entry->effective_from = now()->startOfDay();
            $entry->effective_to = null;
            $entry->source_system = $sourceSystem;
            $entry->source_ref = $sourceRef.'/'.$channel;
            $entry->seeded_at = now();
            $entry->save();

            $report->created('price_list_item');
        }
    }

    /**
     * Which channels offer the item, derived from which channel priced it —
     * the original importer's rule, kept: an unpriced item is offered nowhere
     * and therefore stays invisible to customers even once published.
     *
     * @param  array<string, mixed>  $item
     * @param  array<string, CatalogueItemVariant>  $variants
     * @param  array<string, SalesChannel>  $channels
     */
    private function writeChannels(
        CatalogueItem $catalogueItem,
        array $item,
        array $variants,
        array $channels,
        string $organisationId,
        ImportReport $report,
    ): void {
        /** @var array<string, array{weight_kg: float|int|null, price_minor: int, currency: string}> $prices */
        $prices = (array) ($item['prices'] ?? []);

        foreach ($prices as $channel => $price) {
            if (! is_array($price)) {
                continue;
            }

            $channelCode = $channel === 'b2b' ? KitchenWorkbookWorld::CHANNEL_B2B : KitchenWorkbookWorld::CHANNEL_B2C;
            $salesChannel = $channels[$channelCode] ?? null;
            $variant = $variants[$channel] ?? null;

            if (! $salesChannel instanceof SalesChannel || ! $variant instanceof CatalogueItemVariant) {
                continue;
            }

            $row = new ChannelCatalogueItem;
            $row->organisation_id = $organisationId;
            $row->sales_channel_id = (string) $salesChannel->getKey();
            $row->catalogue_item_id = (string) $catalogueItem->getKey();
            $row->catalogue_item_variant_id = (string) $variant->getKey();
            $row->is_available = true;
            $row->save();

            $report->created('channel_catalogue_item');
        }
    }

    /**
     * The row's machine flags plus the source values that have no column,
     * prefixed so they are greppable from the row itself (the original
     * importer's convention).
     *
     * @param  array<string, mixed>  $item
     * @param  list<string>  $flags
     * @return list<string>|null
     */
    private function qualityFlags(array $item, array $flags): ?array
    {
        $verbatim = [
            'source' => $item['source'] ?? null,
            'source_note' => $item['notes'] ?? null,
        ];

        foreach ($verbatim as $key => $value) {
            if (is_string($value) && trim($value) !== '') {
                $flags[] = $key.': '.trim($value);
            }
        }

        return $flags === [] ? null : array_values(array_unique($flags));
    }

    private function unitId(string $code): string
    {
        $id = UnitMap::idForCode($code);

        if (! is_string($id)) {
            throw new RuntimeException("The measurement unit [{$code}] is not seeded; seed reference data first.");
        }

        return $id;
    }

    /**
     * @return array<string, string> platform product category code → id
     */
    private function platformProductCategoryIds(): array
    {
        /** @var array<string, string> $ids */
        $ids = ProductCategory::withoutTenancy()
            ->whereNull('organisation_id')
            ->pluck('id', 'code')
            ->all();

        return $ids;
    }

    /**
     * @return array<string, string> platform ingredient category code → id
     */
    private function platformIngredientCategoryIds(): array
    {
        /** @var array<string, string> $ids */
        $ids = IngredientCategory::withoutTenancy()
            ->whereNull('organisation_id')
            ->pluck('id', 'code')
            ->all();

        return $ids;
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function rollBackAfter(callable $work): void
    {
        DB::beginTransaction();

        try {
            $work();
        } finally {
            DB::rollBack();

            $this->context->clear();
            $this->database->reset();
        }
    }

    public function auditStart(ImportOptions $options): void
    {
        $this->audit->record(
            'catalogue.v6_import_started',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $options->organisationSlug,
            purposeOfUse: PurposeOfUse::OrganisationAdministration->value,
            metadata: ['mode' => $options->mode()],
        );
    }

    public function auditFinish(ImportOptions $options, ImportReport $report): void
    {
        $created = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($report->countsSnapshot() as $buckets) {
            $created += $buckets['created'] + $buckets['would_create'];
            $skipped += $buckets['skipped_existing'];
            $failed += $buckets['failed'];
        }

        $this->audit->record(
            'catalogue.v6_import_finished',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $options->organisationSlug,
            purposeOfUse: PurposeOfUse::OrganisationAdministration->value,
            metadata: [
                'mode' => $options->mode(),
                'rows_created_or_would_create' => $created,
                'rows_skipped_existing' => $skipped,
                'rows_failed' => $failed,
            ],
        );
    }
}
