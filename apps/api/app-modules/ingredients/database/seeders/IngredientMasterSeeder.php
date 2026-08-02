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
 * The platform ingredient library: 213 ingredients, a two-level taxonomy and
 * the allergen baseline that goes with them, transcribed from the
 * de-duplicated Lebanese-market ingredient master (IG-001..IG-215).
 *
 * **Committed and production-safe.** This is mechanism (a) of the three in
 * the data register (D-046): a public list of ingredient names, categories
 * and regulated allergen classes. It contains no formulation, no cost, no
 * supplier and no yield — those arrive only through the private importer, and
 * never as a file in this repository.
 *
 * **What the source does not say, this seeder does not invent:**
 *
 * - *Units.* The workbook records no purchasing or usage unit, so every row
 *   gets `g` as a neutral default. It is operator-editable and the product
 *   list supplies the real ones in a later slice. Guessing millilitres for
 *   things that look like liquids would have produced 213 confident wrong
 *   answers instead of 213 obvious placeholders.
 * - *Arabic names.* The source is English-only, so `name_ar` falls back to
 *   `name_en` for all 213 rows (the `SeedDataFile::stringOr` pattern). A
 *   machine translation of a food name that ends up on an allergen label is
 *   not an improvement on an honest fallback.
 * - *Availability tier.* The workbook's own introduction promises a
 *   Core/Common/Specialty-imported flag, and the ingredient sheet has no such
 *   column. `availability_tier` is therefore left NULL rather than inferred.
 *
 * **The burghul/pita contradiction** (appendix D, risk R1) is seeded exactly
 * as recorded — allergen class "None" — with `verification_status`
 * `requires_review` and a note stating the conflict, and the run prints a
 * prominent warning. The source sheet tags both rows "None" while the same
 * workbook's allergen key lists burghul and bread under Cereals/Gluten. A
 * seeder that silently "corrected" this would be inventing a food-safety
 * determination; one that silently accepted it would be shipping one. It does
 * neither: it records both readings and escalates.
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
     * The unit every seeded row starts on. See the class docblock: the source
     * records none, and this is a placeholder rather than a claim.
     */
    private const string DEFAULT_UNIT_CODE = 'g';

    public function run(): void
    {
        $data = SeedDataFile::documentIn(dirname(__DIR__).'/data', 'platform-ingredients');
        $unitId = $this->defaultUnitId();

        $categoryIds = $this->seedCategories(SeedDataFile::rowList($data, 'categories'));
        $report = $this->seedIngredients(SeedDataFile::rowList($data, 'ingredients'), $categoryIds, $unitId);
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
     * @return array{created: int, existing: int, arabic_fallbacks: int, mappings_created: int, contradictions: list<string>}
     */
    private function seedIngredients(array $rows, array $categoryIds, string $unitId): array
    {
        /** @var array<string, string> $existingIds */
        $existingIds = Ingredient::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('source_system', self::SOURCE_SYSTEM)
            ->pluck('id', 'source_ref')
            ->all();

        $created = 0;
        $arabicFallbacks = 0;
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
                    'default_unit_id' => $unitId,
                    'yield_factor' => 1,
                    'forked_from_ingredient_id' => null,
                    'availability_tier' => null,
                    'status' => IngredientStatus::Active->value,
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
     * @param  array{created: int, existing: int, arabic_fallbacks: int, mappings_created: int, contradictions: list<string>}  $report
     */
    private function report(array $report): void
    {
        $this->command->info(sprintf(
            'Platform ingredient library: %d created, %d already present, %d allergen baseline mappings created. '
            .'%d rows use the English name as the Arabic name (the source is English-only). '
            .'Every row is on the placeholder unit "%s" — the source records no unit.',
            $report['created'],
            $report['existing'],
            $report['mappings_created'],
            $report['arabic_fallbacks'],
            self::DEFAULT_UNIT_CODE,
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

    private function defaultUnitId(): string
    {
        $id = MeasurementUnit::query()->where('code', self::DEFAULT_UNIT_CODE)->value('id');

        if (! is_string($id)) {
            throw new RuntimeException('The measurement units must be seeded before the ingredient master.');
        }

        return $id;
    }
}
