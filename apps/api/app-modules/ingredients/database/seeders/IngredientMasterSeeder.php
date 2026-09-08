<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Database\Seeders;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\ReferenceData\Database\Seeders\SeedDataFile;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * The platform ingredient library, transcribed from the v6 workbook
 * (`Ingredients_Sauces_Dressings_v6.xlsx` via scripts/convert-v6-workbook.py):
 * 306 ingredients (ING-001..306) plus sheet 6's 31 packaging rows, a two-level
 * taxonomy and the allergen baseline that goes with them.
 *
 * **Sheet 6's packaging rows are back, and the objection to them is answered
 * rather than forgotten.** They were pulled once because the only visible
 * effect was cutlery in every ingredient picker — a real complaint about a
 * picker, not about the data. The recipe editor now asks for its two halves
 * separately: the raw-material picker excludes `packaging-disposables`, and
 * the Packaging tab requests that category by name through
 * `IngredientAdminFilter::categoryCode`. With the pickers disjoint, a bottle
 * and a cap have to exist as records for a recipe to cost its packaging at
 * all, which is what sheet 6 is for.
 *
 * They still carry no allergen, no nutrition and no yield, and procurement
 * still receives them without an ingredient behind them
 * (`ReceiptLineCosting`); none of that changed, and none of it required them
 * to be absent.
 *
 * **Committed and production-safe.** This is mechanism (a) of the three in
 * the data register (D-046): a public list of ingredient names, categories,
 * units, coarse "Made From" transcriptions and regulated allergen classes.
 * It contains no quantified formulation, no cost, no supplier and no yield.
 *
 * **What the source does not say, this seeder does not invent:**
 *
 * - *Units.* v6 records a usage unit and a purchase pack per row; where a row
 *   has neither (most produce), the converter defaulted `kg` and flagged it.
 *   Rows still fall back to `g` here only if a row somehow carries no code.
 * - *Arabic names.* The source is English-only, so `name_ar` falls back to
 *   `name_en` (the `SeedDataFile::stringOr` pattern). A machine translation
 *   of a food name that ends up on an allergen label is not an improvement
 *   on an honest fallback.
 * - *Availability tier.* No such column in the source; left NULL.
 * - *Prices.* Sheet 1's `Price` column is empty in all 306 rows, so
 *   `b2b_price_amount` and `b2c_price_amount` are left NULL for an operator
 *   to fill. The B2B/B2C figures the workbook does carry belong to the
 *   sellable sheets, and land on `catalogue_items` rather than here.
 * - *Status.* Two v6 rows carry no Status; the converter recorded them
 *   `inactive` — visible but greyed and unusable until a human decides.
 *
 * The v1 workbook's burghul/pita "None" contradiction is resolved in the v6
 * source itself (both rows now declare Cereals/Gluten), but the escalation
 * path stays: any row the source marks `requires_review` is seeded exactly
 * as recorded and printed as a contradiction warning.
 *
 * **Insert-if-absent, not upsert.** A second run creates what is missing and
 * leaves everything that exists alone, so a platform operator's curation of a
 * seeded row survives the next deployment (risk R8). Category names, which
 * carry no operator decision, are reconciled.
 */
class IngredientMasterSeeder extends Seeder
{
    public const string SOURCE_SYSTEM = 'healthy360_platform';

    /**
     * The unit a row falls back to when it somehow carries no code. The v6
     * converter defaults blank rows itself, so this is a belt for a document
     * edited by hand, not the normal path.
     */
    private const string DEFAULT_UNIT_CODE = 'g';

    public function run(): void
    {
        $data = SeedDataFile::documentIn(dirname(__DIR__).'/data', 'platform-ingredients');
        $unitIds = $this->unitIds();

        $categoryIds = $this->seedCategories(SeedDataFile::rowList($data, 'categories'));
        $report = $this->seedIngredients(SeedDataFile::rowList($data, 'ingredients'), $categoryIds, $unitIds);
        $this->seedAliases(SeedDataFile::rowList($data, 'aliases'));

        $this->report($report);
    }

    /**
     * @param  list<array<array-key, mixed>>  $rows
     * @return array<string, string> category code → id
     */
    private function seedCategories(array $rows): array
    {
        /** @var array<string, string> $ids */
        $ids = IngredientCategory::withoutTenancy()
            ->whereNull('organisation_id')
            ->pluck('id', 'code')
            ->all();

        // Two passes: parents exist before children reference them.
        foreach ([true, false] as $topLevel) {
            $pending = [];

            foreach ($rows as $row) {
                $parentCode = SeedDataFile::nullableString($row, 'parent_code');

                if (($parentCode === null) !== $topLevel) {
                    continue;
                }

                $code = SeedDataFile::string($row, 'code');

                if (isset($ids[$code])) {
                    continue;
                }

                $id = $this->newId();
                $ids[$code] = $id;

                $pending[] = [
                    'id' => $id,
                    'organisation_id' => null,
                    'parent_id' => $parentCode === null ? null : ($ids[$parentCode] ?? null),
                    'code' => $code,
                    'name_en' => SeedDataFile::string($row, 'name_en'),
                    'name_ar' => SeedDataFile::stringOr($row, 'name_ar', 'name_en'),
                    'display_order' => SeedDataFile::integer($row, 'display_order'),
                    'is_active' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            if ($pending !== []) {
                IngredientCategory::withoutTenancy()->insert($pending);
            }
        }

        return $ids;
    }

    /**
     * Written with bulk inserts and preloaded lookups rather than one
     * `firstOrNew` per row: 213 ingredients with 61 mappings is a few hundred
     * round trips otherwise, and this seeder runs before every test that needs
     * the platform library. Identifiers still come from the central UUIDv7
     * service, so nothing about the key contract changes.
     *
     * @param  list<array<array-key, mixed>>  $rows
     * @param  array<string, string>  $categoryIds
     * @param  array<string, string>  $unitIds  unit code → id
     * @return array{created: int, existing: int, arabic_fallbacks: int, inactive: int, mappings_created: int, contradictions: list<string>}
     */
    private function seedIngredients(array $rows, array $categoryIds, array $unitIds): array
    {
        /** @var array<string, string> $existingIds */
        $existingIds = Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('source_system', self::SOURCE_SYSTEM)
            ->pluck('id', 'source_ref')
            ->all();

        $created = 0;
        $arabicFallbacks = 0;
        $inactive = 0;
        $contradictions = [];
        $pending = [];
        $mappingRows = [];
        $now = now();

        foreach ($rows as $row) {
            $sourceRef = SeedDataFile::string($row, 'source_ref');
            $nameEn = SeedDataFile::string($row, 'name_en');
            $nameAr = SeedDataFile::stringOr($row, 'name_ar', 'name_en');
            $verification = SeedDataFile::nullableString($row, 'verification_status')
                ?? IngredientVerificationStatus::Unverified->value;

            if ($nameAr === $nameEn) {
                $arabicFallbacks++;
            }

            if ($verification === IngredientVerificationStatus::RequiresReview->value) {
                $contradictions[] = sprintf('%s — %s', $sourceRef, $nameEn);
            }

            $status = SeedDataFile::nullableString($row, 'status') ?? IngredientStatus::Active->value;

            if ($status === IngredientStatus::Inactive->value) {
                $inactive++;
            }

            $purchaseUnitCode = SeedDataFile::nullableString($row, 'purchase_unit_code');
            $itemsPerUnit = $row['items_per_unit'] ?? null;

            /*
             * The three fields only packaging carries, absent on every food row.
             *
             * They arrive on the same document because packaging shares this table: the rows are
             * filed under `packaging-disposables` and are otherwise ordinary ingredients. The
             * figures are curated rather than transcribed — the workbook's packaging sheet has no
             * cost column — and the document records that provenance in `packaging_price_note`.
             */
            $purchasePrice = $row['purchase_price_amount'] ?? null;
            $wastePercent = $row['waste_percent'] ?? null;
            $capacityQuantity = $row['capacity_quantity'] ?? null;
            $capacityUnitCode = SeedDataFile::nullableString($row, 'capacity_unit_code');

            $id = $existingIds[$sourceRef] ?? null;

            if ($id === null) {
                $id = $this->newId();
                $existingIds[$sourceRef] = $id;

                $pending[] = [
                    'id' => $id,
                    'organisation_id' => null,
                    'slug' => SeedDataFile::string($row, 'slug'),
                    'name_en' => $nameEn,
                    'name_ar' => $nameAr,
                    'ingredient_category_id' => $categoryIds[SeedDataFile::string($row, 'category_code')] ?? null,
                    'ingredient_subcategory_id' => $categoryIds[SeedDataFile::string($row, 'subcategory_code')] ?? null,
                    'default_unit_id' => $this->unitIdFor($unitIds, SeedDataFile::nullableString($row, 'default_unit_code')),
                    'purchase_unit_id' => $purchaseUnitCode === null ? null : $this->unitIdFor($unitIds, $purchaseUnitCode),
                    'composition' => SeedDataFile::nullableString($row, 'composition'),
                    'items_per_unit' => is_numeric($itemsPerUnit) ? (string) $itemsPerUnit : null,
                    'purchase_price_amount' => is_numeric($purchasePrice) ? (string) $purchasePrice : null,
                    // Both halves or neither, which the column's own CHECK also enforces.
                    'purchase_price_currency' => is_numeric($purchasePrice)
                        ? (SeedDataFile::nullableString($row, 'purchase_price_currency') ?? 'USD')
                        : null,
                    'waste_percent' => is_numeric($wastePercent) ? (string) $wastePercent : null,
                    'capacity_quantity' => is_numeric($capacityQuantity) && $capacityUnitCode !== null
                        ? (string) $capacityQuantity
                        : null,
                    'capacity_unit_id' => is_numeric($capacityQuantity) && $capacityUnitCode !== null
                        ? $this->unitIdFor($unitIds, $capacityUnitCode)
                        : null,
                    'nutrition_per_100g' => null,
                    'yield_factor' => 1,
                    'forked_from_ingredient_id' => null,
                    'availability_tier' => null,
                    'status' => $status,
                    'verification_status' => $verification,
                    'notes' => SeedDataFile::nullableString($row, 'notes'),
                    'source_system' => self::SOURCE_SYSTEM,
                    'source_ref' => $sourceRef,
                    'seeded_at' => $now,
                    'lock_version' => 0,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];

                $created++;
            }

            foreach (SeedDataFile::rowList($row, 'allergens') as $mapping) {
                $scope = SeedDataFile::nullableString($mapping, 'market_scope') ?? AllergenMarketScope::All->value;

                $mappingRows[] = [
                    'id' => $this->newId(),
                    'ingredient_id' => $id,
                    'allergen_code' => SeedDataFile::string($mapping, 'allergen_code'),
                    'organisation_id' => null,
                    'containment' => SeedDataFile::nullableString($mapping, 'containment') ?? AllergenContainment::Contains->value,
                    'market_scope' => $scope,
                    'source' => AllergenMappingSource::MasterList->value,
                    'verification_status' => SeedDataFile::nullableString($mapping, 'verification_status')
                        ?? AllergenVerificationStatus::Unverified->value,
                    'evidence' => SeedDataFile::nullableString($mapping, 'evidence'),
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        foreach (array_chunk($pending, 200) as $chunk) {
            Ingredient::withoutTenancy()->insert($chunk);
        }

        return [
            'created' => $created,
            'existing' => count($rows) - $created,
            'arabic_fallbacks' => $arabicFallbacks,
            'inactive' => $inactive,
            'mappings_created' => $this->seedMappings($mappingRows),
            'contradictions' => $contradictions,
        ];
    }

    /**
     * Insert-if-absent, decided against one preloaded set rather than one
     * query per mapping.
     *
     * @param  list<array<string, mixed>>  $rows
     */
    private function seedMappings(array $rows): int
    {
        $existing = IngredientAllergen::withoutTenancy()
            ->whereNull('organisation_id')
            ->get(['ingredient_id', 'allergen_code', 'market_scope'])
            ->map(fn (IngredientAllergen $row): string => $row->ingredient_id.'|'.$row->allergen_code.'|'.$row->market_scope->value)
            ->flip()
            ->all();

        $pending = [];

        foreach ($rows as $row) {
            $key = $row['ingredient_id'].'|'.$row['allergen_code'].'|'.$row['market_scope'];

            if (array_key_exists($key, $existing)) {
                continue;
            }

            $existing[$key] = true;
            $pending[] = $row;
        }

        foreach (array_chunk($pending, 200) as $chunk) {
            IngredientAllergen::withoutTenancy()->insert($chunk);
        }

        return count($pending);
    }

    /**
     * The two workbook rows that duplicate an earlier ingredient (IG-161 →
     * IG-073 Garlic, IG-162 → IG-121 Onions). They become aliases rather than
     * disappearing, so a later import that quotes IG-161 still resolves.
     *
     * @param  list<array<array-key, mixed>>  $rows
     */
    private function seedAliases(array $rows): void
    {
        /** @var array<string, string> $ingredientIds */
        $ingredientIds = Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('source_system', self::SOURCE_SYSTEM)
            ->pluck('id', 'source_ref')
            ->all();

        foreach ($rows as $row) {
            $sourceRef = SeedDataFile::string($row, 'ingredient_source_ref');

            if (! isset($ingredientIds[$sourceRef])) {
                throw new RuntimeException("Alias references unseeded ingredient [{$sourceRef}].");
            }

            $alias = SeedDataFile::string($row, 'alias');

            $exists = IngredientAlias::query()
                ->where('ingredient_id', $ingredientIds[$sourceRef])
                ->where('alias_normalised', IngredientAlias::normalise($alias))
                ->exists();

            if ($exists) {
                continue;
            }

            $record = new IngredientAlias;
            $record->ingredient_id = $ingredientIds[$sourceRef];
            $record->alias = $alias;
            $record->source_system = self::SOURCE_SYSTEM;
            $record->source_ref = SeedDataFile::string($row, 'source_ref');
            $record->save();
        }
    }

    private function newId(): string
    {
        return app(IdentifierService::class)->generate();
    }

    /**
     * @param  array{created: int, existing: int, arabic_fallbacks: int, inactive: int, mappings_created: int, contradictions: list<string>}  $report
     */
    private function report(array $report): void
    {
        $this->command->info(sprintf(
            'Platform ingredient library: %d created, %d already present, %d allergen baseline mappings created. '
            .'%d rows use the English name as the Arabic name (the source is English-only). '
            .'%d rows are inactive — the source records no Status for them.',
            $report['created'],
            $report['existing'],
            $report['mappings_created'],
            $report['arabic_fallbacks'],
            $report['inactive'],
        ));

        if ($report['contradictions'] === []) {
            return;
        }

        $this->command->error('');
        $this->command->error('  ALLERGEN CONTRADICTION — REVIEW REQUIRED BEFORE ANY LABEL IS PUBLISHED  ');
        $this->command->error('');

        foreach ($report['contradictions'] as $line) {
            $this->command->error('  · '.$line);
        }

        $this->command->error('');
        $this->command->error(
            '  The source ingredient sheet tags these rows allergen class "None"; the same workbook\'s'
        );
        $this->command->error(
            '  allergen key lists burghul and bread under Cereals/Gluten. They are seeded exactly as'
        );
        $this->command->error(
            '  recorded and flagged verification_status=requires_review. A human must decide (risk R1).'
        );
        $this->command->error('');
    }

    /**
     * @return array<string, string> unit code → id
     */
    private function unitIds(): array
    {
        /** @var array<string, string> $ids */
        $ids = MeasurementUnit::query()->pluck('id', 'code')->all();

        if (! isset($ids[self::DEFAULT_UNIT_CODE])) {
            throw new RuntimeException('The measurement units must be seeded before the ingredient master.');
        }

        return $ids;
    }

    /**
     * @param  array<string, string>  $unitIds
     */
    private function unitIdFor(array $unitIds, ?string $code): string
    {
        $code ??= self::DEFAULT_UNIT_CODE;

        if (! isset($unitIds[$code])) {
            throw new RuntimeException("The document names unit [{$code}] which is not seeded.");
        }

        return $unitIds[$code];
    }
}
