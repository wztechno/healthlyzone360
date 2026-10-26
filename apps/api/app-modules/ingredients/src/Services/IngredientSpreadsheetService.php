<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use BackedEnum;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Assistant\IngredientAssistService;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Http\Requests\StoreIngredientRequest;
use Healthy360\Ingredients\Http\Requests\UpdateIngredientRequest;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Spreadsheet\ImportResult;
use Healthy360\Support\Spreadsheet\SpreadsheetReader;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * The ingredient catalogue as a workbook: the export a kitchen edits, and the import that reads
 * the edit back.
 *
 * **An import converges; it never duplicates.** A row with a Reference updates that ingredient
 * and nothing else — the server assigns references, so an unknown one is refused rather than
 * created. A row without one matches by name the way the quick add's duplicate guard does, and
 * only creates when nothing matches.
 *
 * **Only what the sheet says moves.** A column absent from the header row is never touched, and
 * a blank cell leaves the stored value standing. A row whose values already match is counted
 * unchanged and written not at all — no lock bump, no audit — so a re-upload of an untouched
 * export is a no-op rather than three hundred audit rows saying so.
 *
 * Every row goes through the same service and the same validation rules the form uses, each in
 * its own transaction: one bad row is reported and the rest still land.
 */
final readonly class IngredientSpreadsheetService
{
    public const int MAX_ROWS = 2000;

    /** Editable columns, key => header text, in sheet order. */
    public const array COLUMNS = [
        'reference' => 'Reference',
        'name_en' => 'Name (EN)',
        'name_ar' => 'Name (AR)',
        'category' => 'Category',
        'unit' => 'Unit',
        'purchase_unit' => 'Purchase unit',
        'items_per_unit' => 'Items per unit',
        'grams_per_unit' => 'Grams per unit',
        'yield_factor' => 'Yield factor',
        'unit_price' => 'Unit price',
        'b2b_price' => 'B2B price',
        'b2c_price' => 'B2C price',
        'price_currency' => 'Price currency',
        'purchase_price' => 'Purchase price',
        'purchase_currency' => 'Purchase currency',
        'waste_percent' => 'Waste %',
        'capacity' => 'Capacity',
        'capacity_unit' => 'Capacity unit',
        'availability' => 'Availability',
        'sellable' => 'Sellable',
        'composition' => 'Composition',
        'notes' => 'Notes',
    ];

    /** Written by the export, recognised (so never listed as ignored) and never read by the import. */
    public const array READ_ONLY_COLUMNS = [
        'status' => 'Status',
        'verification' => 'Verification',
        'allergens' => 'Allergens',
        'updated_at' => 'Updated at',
    ];

    public const array HEADERS = [
        'Reference', 'Name (EN)', 'Name (AR)', 'Category', 'Unit', 'Purchase unit', 'Items per unit',
        'Grams per unit', 'Yield factor', 'Unit price', 'B2B price', 'B2C price', 'Price currency',
        'Purchase price', 'Purchase currency', 'Waste %', 'Capacity', 'Capacity unit', 'Availability',
        'Sellable', 'Composition', 'Notes',
    ];

    public const array READ_ONLY_HEADERS = ['Status', 'Verification', 'Allergens', 'Updated at'];

    /** The template's one illustrative row; the reader flags it by its first cell and the import skips it. */
    public const array EXAMPLE = [
        'EXAMPLE', 'Chickpeas, dried', 'حمص مجفف', null, 'kg', 'bag', '25', null, '1', '2.5', null, null, 'USD',
        null, null, null, null, null, 'core', 'no', null, 'Leave the Reference blank to add a new ingredient.',
    ];

    /** Column key => the request attribute it writes. `category` and the three unit columns are resolved from codes first. */
    private const array ATTRIBUTES = [
        'name_en' => 'name_en',
        'name_ar' => 'name_ar',
        'category' => 'ingredient_category_id',
        'unit' => 'default_unit_id',
        'purchase_unit' => 'purchase_unit_id',
        'items_per_unit' => 'items_per_unit',
        'grams_per_unit' => 'grams_per_unit',
        'yield_factor' => 'yield_factor',
        'unit_price' => 'unit_price_amount',
        'b2b_price' => 'b2b_price_amount',
        'b2c_price' => 'b2c_price_amount',
        'price_currency' => 'price_currency_code',
        'purchase_price' => 'purchase_price_amount',
        'purchase_currency' => 'purchase_price_currency',
        'waste_percent' => 'waste_percent',
        'capacity' => 'capacity_quantity',
        'capacity_unit' => 'capacity_unit_id',
        'availability' => 'availability_tier',
        'sellable' => 'is_sellable',
        'composition' => 'composition',
        'notes' => 'notes',
    ];

    private const array UNIT_COLUMNS = ['unit', 'purchase_unit', 'capacity_unit'];

    private const array CURRENCY_COLUMNS = ['price_currency', 'purchase_currency'];

    private const array DECIMAL_ATTRIBUTES = [
        'items_per_unit', 'grams_per_unit', 'yield_factor', 'unit_price_amount', 'b2b_price_amount',
        'b2c_price_amount', 'purchase_price_amount', 'waste_percent', 'capacity_quantity',
    ];

    /**
     * Halves the form requests require together. On an update a blank cell leaves its half
     * stored, so validation reads the stored half rather than refusing a pair that is whole.
     *
     * @var array<string, list<string>> attribute => the attributes that need it
     */
    private const array PARTNERS = [
        'price_currency_code' => ['unit_price_amount', 'b2b_price_amount', 'b2c_price_amount'],
        'purchase_price_currency' => ['purchase_price_amount'],
        'capacity_unit_id' => ['capacity_quantity'],
        'capacity_quantity' => ['capacity_unit_id'],
    ];

    public function __construct(
        private SpreadsheetReader $reader,
        private IngredientCatalogueService $catalogue,
        private IngredientAssistService $assistant,
        private PackagingBranch $packaging,
        private AllergenMappingService $allergens,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * @throws ValidationException when the file itself is unreadable
     */
    public function import(string $path): ImportResult
    {
        $sheet = $this->reader->read($path, self::COLUMNS + self::READ_ONLY_COLUMNS, ['reference', 'name_en'], self::MAX_ROWS);
        $result = new ImportResult;
        $result->ignoredColumns($sheet['ignored_columns']);
        $codes = $this->codes();

        foreach ($sheet['rows'] as $row) {
            $reference = $row['values']['reference'] ?? null;

            if ($row['example']) {
                $result->skipped($row['row'], null, 'Example row');

                continue;
            }

            try {
                [$outcome, $ref, $message] = DB::transaction(fn (): array => $this->importRow($row['values'], $codes));
            } catch (ApiException $e) {
                $result->failed($row['row'], $reference, $this->apiMessage($e));

                continue;
            } catch (ValidationException $e) {
                $result->failed($row['row'], $reference, implode(' ', Arr::flatten($e->errors())));

                continue;
            } catch (Throwable $e) {
                report($e);
                $result->failed($row['row'], $reference, 'The row could not be imported.');

                continue;
            }

            match ($outcome) {
                'created' => $result->created($row['row'], $ref),
                'updated' => $result->updated($row['row'], $ref),
                'unchanged' => $result->unchanged(),
                'skipped' => $result->skipped($row['row'], $ref, (string) $message),
            };
        }

        $this->audit->record(
            'catalogue.ingredients_imported',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $this->context->organisationId(),
            metadata: [
                'row_count' => count($sheet['rows']),
                'created' => $result->count('created'),
                'updated' => $result->count('updated'),
                'unchanged' => $result->count('unchanged'),
                'skipped' => $result->count('skipped'),
                'failed' => $result->count('failed'),
            ],
        );

        return $result;
    }

    /**
     * The template's rows: the example and nothing else.
     *
     * @return list<list<string|null>>
     */
    public function templateRows(): array
    {
        return [self::EXAMPLE];
    }

    /**
     * One sheet row per ingredient, in {@see HEADERS} order then {@see READ_ONLY_HEADERS}.
     *
     * @param  Collection<int, Ingredient>  $ingredients
     * @return iterable<list<string|int|float|null>>
     */
    public function exportRows(Collection $ingredients): iterable
    {
        $ingredients->loadMissing(['category', 'subcategory', 'defaultUnit', 'purchaseUnit', 'capacityUnit']);
        $mappings = $this->allergens->mappingsForMany(
            array_values($ingredients->map(fn (Ingredient $ingredient): string => (string) $ingredient->getKey())->all()),
            $this->allergens->callerLayer(),
        );

        foreach ($ingredients as $ingredient) {
            yield [
                $ingredient->source_ref,
                $ingredient->name_en,
                $ingredient->name_ar,
                $ingredient->subcategory->code ?? $ingredient->category?->code,
                $ingredient->defaultUnit?->code,
                $ingredient->purchaseUnit?->code,
                $this->number($ingredient->items_per_unit),
                $this->number($ingredient->grams_per_unit),
                $this->number($ingredient->yield_factor),
                $this->number($ingredient->unit_price_amount),
                $this->number($ingredient->b2b_price_amount),
                $this->number($ingredient->b2c_price_amount),
                $ingredient->price_currency_code,
                $this->number($ingredient->purchase_price_amount),
                $ingredient->purchase_price_currency,
                $this->number($ingredient->waste_percent),
                $this->number($ingredient->capacity_quantity),
                $ingredient->capacityUnit?->code,
                $ingredient->availability_tier?->value,
                $ingredient->is_sellable ? 'yes' : 'no',
                $ingredient->composition,
                $ingredient->notes,
                $ingredient->status->value,
                $ingredient->verification_status->value,
                $this->allergenSummary($mappings[(string) $ingredient->getKey()] ?? []),
                $ingredient->updated_at?->toIso8601String(),
            ];
        }
    }

    /**
     * @param  array<string, string|null>  $values
     * @param  array{units: array<string, string>, categories: array<string, IngredientCategory>}  $codes
     * @return array{0: 'created'|'updated'|'unchanged'|'skipped', 1: string|null, 2: string|null}
     *
     * @throws ApiException
     * @throws ValidationException
     */
    private function importRow(array $values, array $codes): array
    {
        $reference = $values['reference'] ?? null;
        $attributes = $this->attributes($values, $codes);
        $isPackaging = in_array($attributes['ingredient_category_id'] ?? null, $this->packaging->categoryIds(), true);
        $existing = $this->match($reference, $values['name_en'] ?? null, $isPackaging);

        if ($existing === null) {
            Validator::make($attributes, (new StoreIngredientRequest)->rules(), [], $this->labels())->validate();

            /** @var array{name_en: string, default_unit_id: string, nutrition_pending?: bool} $create */
            $create = $attributes + ($isPackaging ? [] : ['nutrition_pending' => true]);
            $ingredient = $this->catalogue->createPublic($create);

            return ['created', $ingredient->source_ref, null];
        }

        Validator::make($this->withStoredPartners($attributes, $existing), (new UpdateIngredientRequest)->rules(), [], $this->labels())->validate();

        $diff = $this->diff($existing, $attributes);

        if ($diff === []) {
            return ['unchanged', $existing->source_ref, null];
        }

        if (! $this->catalogue->isWritable($existing)) {
            return ['skipped', $existing->source_ref, 'Platform library row — fork it in the app to edit it'];
        }

        $updated = $this->catalogue->updatePublic($existing, $diff, $existing->lock_version);

        return ['updated', $updated->source_ref, null];
    }

    /**
     * The sheet's non-blank cells as request attributes, codes resolved to ids.
     *
     * @param  array<string, string|null>  $values
     * @param  array{units: array<string, string>, categories: array<string, IngredientCategory>}  $codes
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    private function attributes(array $values, array $codes): array
    {
        $attributes = [];

        foreach (self::ATTRIBUTES as $key => $attribute) {
            $value = $values[$key] ?? null;

            if ($value === null) {
                continue;
            }

            $header = self::COLUMNS[$key];

            if (in_array($key, self::UNIT_COLUMNS, true)) {
                $attributes[$attribute] = $codes['units'][mb_strtolower($value)]
                    ?? throw ValidationException::withMessages([$key => "{$header}: '{$value}' is not a known unit code."]);
            } elseif ($key === 'category') {
                $category = $codes['categories'][mb_strtolower($value)]
                    ?? throw ValidationException::withMessages([$key => "{$header}: '{$value}' is not a known category code."]);
                // A child code files under its parent; a root code files at the root, with no sub-category.
                $attributes['ingredient_category_id'] = $category->parent_id ?? (string) $category->getKey();
                $attributes['ingredient_subcategory_id'] = $category->parent_id === null ? null : (string) $category->getKey();
            } elseif (in_array($key, self::CURRENCY_COLUMNS, true)) {
                $attributes[$attribute] = mb_strtoupper($value);
            } elseif ($key === 'sellable') {
                $attributes[$attribute] = match (mb_strtolower($value)) {
                    'yes', 'true', '1' => true,
                    'no', 'false', '0' => false,
                    default => throw ValidationException::withMessages([$key => "{$header}: '{$value}' must be yes or no."]),
                };
            } elseif ($key === 'availability') {
                $attributes[$attribute] = mb_strtolower($value);
            } elseif (in_array($attribute, self::DECIMAL_ATTRIBUTES, true)) {
                $attributes[$attribute] = $this->plainDecimal($value);
            } else {
                $attributes[$attribute] = $value;
            }
        }

        return $attributes;
    }

    /**
     * The ingredient this row is about, or `null` to create one.
     *
     * @throws ApiException
     */
    private function match(?string $reference, ?string $nameEn, bool $isPackaging): ?Ingredient
    {
        if ($reference !== null) {
            $rows = Ingredient::query()->where('source_ref', $reference)->get();

            if ($rows->isEmpty()) {
                throw new ApiException(ErrorCode::ValidationFailed, "No ingredient has reference {$reference}.");
            }

            if ($rows->count() > 1) {
                throw new ApiException(ErrorCode::ValidationFailed, "{$rows->count()} ingredients have reference {$reference}.");
            }

            $row = $rows->firstOrFail();

            // The kitchen edits its fork, never the library row the fork stands in for.
            return $this->catalogue->existingFork($row) ?? $row;
        }

        if ($nameEn === null) {
            return null;
        }

        $candidates = $isPackaging
            ? Ingredient::query()->onlyPackaging()->whereRaw('lower(name_en) = ?', [IngredientAlias::normalise($nameEn)])->get()
            : $this->assistant->existingMatches($nameEn);
        $own = $candidates->filter(fn (Ingredient $row): bool => $row->organisation_id !== null);
        $layer = $own->isNotEmpty() ? $own : $candidates;

        if ($layer->count() > 1) {
            throw new ApiException(ErrorCode::ValidationFailed, "{$layer->count()} ingredients are named {$nameEn}; add the Reference.");
        }

        $match = $layer->first();

        // `existingMatches()` selects four columns; the diff needs the whole row.
        return $match === null ? null : Ingredient::query()->whereKey($match->getKey())->firstOrFail();
    }

    /**
     * The sent attributes whose value differs from the stored one.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function diff(Ingredient $ingredient, array $attributes): array
    {
        $diff = [];

        foreach ($attributes as $attribute => $value) {
            $stored = $ingredient->getAttribute($attribute);

            if ($stored instanceof BackedEnum) {
                $stored = $stored->value;
            }

            $same = match (true) {
                in_array($attribute, self::DECIMAL_ATTRIBUTES, true) => $this->sameDecimal((string) $value, $stored === null ? null : (string) $stored),
                $attribute === 'is_sellable' => (bool) $stored === $value,
                default => trim((string) $stored) === trim((string) $value),
            };

            if (! $same) {
                $diff[$attribute] = $value;
            }
        }

        return $diff;
    }

    /** Equal at the columns' six decimal places; a stored null equals nothing sent. */
    private function sameDecimal(string $sent, ?string $stored): bool
    {
        return $stored !== null && is_numeric($sent) && is_numeric($stored) && bccomp($sent, $stored, 6) === 0;
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function withStoredPartners(array $attributes, Ingredient $ingredient): array
    {
        foreach (self::PARTNERS as $partner => $needers) {
            if (! array_key_exists($partner, $attributes) && array_intersect($needers, array_keys($attributes)) !== []) {
                $attributes[$partner] = $ingredient->getAttribute($partner);
            }
        }

        return $attributes;
    }

    /**
     * Units and categories by code, loaded once per import. A kitchen's own category shadows a
     * library one with the same code.
     *
     * @return array{units: array<string, string>, categories: array<string, IngredientCategory>}
     */
    private function codes(): array
    {
        $units = [];

        foreach (MeasurementUnit::query()->get(['id', 'code']) as $unit) {
            $units[mb_strtolower($unit->code)] = (string) $unit->getKey();
        }

        $categories = [];

        foreach (IngredientCategory::query()->orderByRaw('organisation_id nulls first')->get(['id', 'organisation_id', 'code', 'parent_id']) as $category) {
            $categories[mb_strtolower($category->code)] = $category;
        }

        return ['units' => $units, 'categories' => $categories];
    }

    /** @return array<string, string> attribute => the header a person reads */
    private function labels(): array
    {
        $labels = ['ingredient_subcategory_id' => self::COLUMNS['category']];

        foreach (self::ATTRIBUTES as $key => $attribute) {
            $labels[$attribute] = self::COLUMNS[$key];
        }

        return $labels;
    }

    /** An ApiException's own field messages where it carries them, rather than the generic code text. */
    private function apiMessage(ApiException $e): string
    {
        $fields = $e->details['fields'] ?? null;

        return is_array($fields) && $fields !== [] ? implode(' ', Arr::flatten($fields)) : $e->getMessage();
    }

    /**
     * `1.0E-6`, as a float cell reads back, written out — bcmath refuses exponents.
     */
    private function plainDecimal(string $value): string
    {
        if (! is_numeric($value) || stripos($value, 'e') === false) {
            return $value;
        }

        return rtrim(rtrim(number_format((float) $value, 10, '.', ''), '0'), '.');
    }

    /**
     * A stored decimal as a number cell when a float holds it exactly, else as its text.
     */
    private function number(?string $value): string|float|null
    {
        if ($value === null) {
            return null;
        }

        $trimmed = str_contains($value, '.') ? rtrim(rtrim($value, '0'), '.') : $value;

        return (string) (float) $trimmed === $trimmed ? (float) $trimmed : $trimmed;
    }

    /**
     * `milk, sesame (may contain)` — each class once, `contains` winning over `may contain`.
     *
     * @param  list<IngredientAllergen>  $mappings
     */
    private function allergenSummary(array $mappings): ?string
    {
        $classes = [];

        foreach ($mappings as $mapping) {
            $contains = $mapping->containment === AllergenContainment::Contains;
            $classes[$mapping->allergen_code] = ($classes[$mapping->allergen_code] ?? false) || $contains;
        }

        if ($classes === []) {
            return null;
        }

        ksort($classes);

        return implode(', ', array_map(
            static fn (string $code, bool $contains): string => $contains ? $code : $code.' (may contain)',
            array_keys($classes),
            $classes,
        ));
    }
}
