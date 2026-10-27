<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Http\Requests\StoreRecipeRequest;
use Healthy360\Recipes\Http\Requests\UpdateRecipeRequest;
use Healthy360\Recipes\Http\Requests\UpdateRecipeVersionRequest;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Spreadsheet\ImportResult;
use Healthy360\Support\Spreadsheet\SpreadsheetReader;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * The recipe book as a workbook: one row per formulation line, the recipe's own fields repeated
 * on every row of it.
 *
 * ## Grouping is sheet-wide
 *
 * Rows belong to a recipe by key — the Reference when there is one, the English name otherwise —
 * wherever they sit, so a sheet somebody sorted by Ingredient still reads as one formulation per
 * recipe. Line order is row order. The recipe's fields are read from every row of its group, and
 * two rows that disagree on one of them refuse the whole group before anything is written: there
 * is no way to know which of the two the person meant.
 *
 * ## Create is forgiving, update is not
 *
 * Rows match a recipe by Reference (one that matches nothing fails the group: the server assigns
 * `RC-` handles and a sheet never chooses one), else by English name; no match by name creates.
 *
 * A new recipe is created even when some of its lines cannot be resolved — those lines are
 * reported as skipped, and the chef adds them in the editor. An existing recipe is a different
 * matter: a sheet is its whole formulation, so applying it with a line missing would silently drop
 * that ingredient. Any unresolved line fails the group and nothing is written.
 *
 * ## Costs are carried, never re-derived
 *
 * A line the sheet matches to an existing one (by ingredient, positionally for a repeated
 * ingredient) keeps its unit cost and currency exactly — the sheet has no cost columns to read
 * them from, and the catalogue's price today is not what the line was costed at. The one
 * exception is a changed Unit: the stored cost is per the old unit, so that line goes uncosted
 * and the catalogue prices it in the new one. Because the
 * replacement then carries a cost, the editor's own gate applies: without
 * `recipe.view_costs_organisation` a costed version cannot be re-imported, and that refusal is the
 * group's failure message.
 *
 * A published version is never touched: a change opens the next draft from it, and only when
 * something actually differs — a re-import of an untouched export changes nothing and says so.
 *
 * @phpstan-type SheetRow array{row: int, values: array<string, string|null>, example: bool}
 * @phpstan-type SheetLine array{row: int, ingredient: Ingredient|null, error: string|null, designation: string|null, quantity: numeric-string|null, unit_id: string|null, comment: string|null}
 * @phpstan-type Outcome array{0: 'created'|'updated'|'unchanged'|'skipped'|'failed', 1: int, 2: string|null, 3: string|null}
 * @phpstan-type LinePayload array{ingredient_id: string, quantity?: string|null, unit_id?: string|null, unit_cost_amount?: string|null, cost_currency_code?: string|null, source_designation?: string|null, comment?: string|null}
 */
final readonly class RecipeSpreadsheetService
{
    /** Column key => header text, in template order. */
    public const array HEADERS = [
        'reference' => 'Reference',
        'name_en' => 'Recipe name (EN)',
        'name_ar' => 'Recipe name (AR)',
        'category' => 'Category',
        'yield_quantity' => 'Yield quantity',
        'yield_unit' => 'Yield unit',
        'yield_pieces' => 'Yield pieces',
        'shelf_life_days' => 'Shelf life days',
        'notes' => 'Notes',
        'ingredient_ref' => 'Ingredient ref',
        'ingredient' => 'Ingredient',
        'quantity' => 'Quantity',
        'unit' => 'Unit',
        'comment' => 'Comment',
    ];

    /**
     * The export's read-only columns. Known to the reader so that a re-imported export does not
     * report them as unknown, and never read.
     */
    public const array READ_ONLY_HEADERS = [
        'version' => 'Version',
        'version_status' => 'Version status',
        'allergens' => 'Allergens',
        'line_cost' => 'Line cost',
        'cost_currency' => 'Cost currency',
        'updated_at' => 'Updated at',
    ];

    /** The template's sample row; the reader skips any row whose Reference is `EXAMPLE`. */
    public const array EXAMPLE = ['EXAMPLE', 'Hummus', 'حمص', 'Dips', 2, 'kg', 8, 5, 'House recipe', 'ING-001', 'Chickpeas', 500, 'g', 'Soaked overnight'];

    public const int MAX_ROWS = 5000;

    /** The recipe-level fields, read from every row of a group and required to agree. */
    private const array HEADER_FIELDS = ['name_en', 'name_ar', 'category', 'yield_quantity', 'yield_unit', 'yield_pieces', 'shelf_life_days', 'notes'];

    /** Validation attribute names, so a message names the column the person sees. */
    private const array LABELS = [
        'name_en' => 'Recipe name (EN)',
        'name_ar' => 'Recipe name (AR)',
        'recipe_category' => 'Category',
        'notes' => 'Notes',
        'shelf_life_days' => 'Shelf life days',
        'yield_quantity' => 'Yield quantity',
        'yield_unit_id' => 'Yield unit',
        'yield_piece_count' => 'Yield pieces',
    ];

    public function __construct(
        private SpreadsheetReader $reader,
        private RecipeService $recipes,
        private RecipeVersionService $versions,
        private RecipeSummaries $summaries,
        private IngredientCatalogueService $ingredients,
        private CostVisibility $costVisibility,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * @return list<list<string|int|float|null>>
     */
    public function templateRows(): array
    {
        return [self::EXAMPLE];
    }

    /**
     * @throws ValidationException when the file itself cannot be read
     */
    public function import(string $path): ImportResult
    {
        $sheet = $this->reader->read($path, self::HEADERS + self::READ_ONLY_HEADERS, ['reference', 'name_en'], self::MAX_ROWS);

        $result = new ImportResult;
        $result->ignoredColumns($sheet['ignored_columns']);

        /** @var array<string, non-empty-list<SheetRow>> $groups */
        $groups = [];

        foreach ($sheet['rows'] as $row) {
            if ($row['example']) {
                $result->skipped($row['row'], null, 'Example row');

                continue;
            }

            $key = $this->groupKey($row['values']);

            if ($key === null) {
                $result->skipped($row['row'], null, 'A row needs a Reference or a Recipe name (EN).');

                continue;
            }

            $groups[$key][] = $row;
        }

        $units = $this->unitIdsByCode();
        $byReference = $this->ingredientsByReference($groups);
        $byName = [];

        foreach ($groups as $rows) {
            $this->importGroup($rows, $units, $byReference, $byName, $result);
        }

        $this->audit->record(
            'catalogue.recipes_imported',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $this->context->organisationId(),
            metadata: [
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
     * @return list<string>
     */
    public function exportHeaders(): array
    {
        return [
            ...array_values(self::HEADERS),
            self::READ_ONLY_HEADERS['version'],
            self::READ_ONLY_HEADERS['version_status'],
            self::READ_ONLY_HEADERS['allergens'],
            ...($this->costVisibility->granted() ? [self::READ_ONLY_HEADERS['line_cost'], self::READ_ONLY_HEADERS['cost_currency']] : []),
            self::READ_ONLY_HEADERS['updated_at'],
        ];
    }

    /**
     * One row per line of each recipe's current version (one row for a recipe with none), and the
     * one access event the read writes — recipes are Confidential.
     *
     * @param  EloquentCollection<int, Recipe>  $recipes
     * @return list<list<string|int|float|null>>
     */
    public function exportRows(EloquentCollection $recipes): array
    {
        $withCosts = $this->costVisibility->granted();
        $recipeIds = array_values(array_map(static fn (Recipe $recipe): string => (string) $recipe->getKey(), $recipes->all()));

        $summaries = $this->summaries->page($recipes, false);
        $current = $this->summaries->currentVersions($recipeIds);
        $unitCodes = MeasurementUnit::query()->pluck('code', 'id')->all();

        $lines = $current === [] ? collect() : RecipeVersionLine::query()
            ->whereIn('recipe_version_id', array_values(array_map(static fn (RecipeVersion $version): string => (string) $version->getKey(), $current)))
            ->with(['ingredient', 'unit'])
            ->orderBy('line_number')
            ->get()
            ->groupBy('recipe_version_id');

        $rows = [];

        foreach (array_values($recipes->all()) as $index => $recipe) {
            $version = $current[(string) $recipe->getKey()] ?? null;

            $head = [
                $recipe->source_ref,
                $recipe->name_en,
                $recipe->name_ar === '' ? null : $recipe->name_ar,
                $recipe->recipe_category,
                self::number($version?->yield_quantity),
                $version?->yield_unit_id === null ? null : ($unitCodes[$version->yield_unit_id] ?? null),
                $version?->yield_piece_count,
                $recipe->shelf_life_days,
                $recipe->notes,
            ];

            $tail = static fn (?RecipeVersionLine $line): array => [
                $version?->version_number,
                $version?->status->value,
                implode(', ', $summaries[$index]['current_version_allergen_codes']),
                ...($withCosts ? [self::number($line?->line_cost_amount), $line?->cost_currency_code] : []),
                $recipe->updated_at?->toIso8601String(),
            ];

            /** @var list<RecipeVersionLine> $versionLines */
            $versionLines = $version === null ? [] : array_values(($lines[(string) $version->getKey()] ?? collect())->all());

            if ($versionLines === []) {
                $rows[] = [...$head, null, null, null, null, null, ...$tail(null)];

                continue;
            }

            foreach ($versionLines as $line) {
                $rows[] = [
                    ...$head,
                    $line->ingredient?->source_ref,
                    $line->ingredient?->name_en,
                    self::number($line->quantity),
                    $line->unit?->code,
                    $line->comment,
                    ...$tail($line),
                ];
            }
        }

        $this->audit->recordAccess(
            'catalogue.recipes_exported',
            PurposeOfUse::OrganisationAdministration,
            DataClassification::Confidential,
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: $this->context->organisationId(),
            metadata: ['recipe_count' => $recipes->count(), 'row_count' => count($rows), 'costs_included' => $withCosts],
        );

        return $rows;
    }

    /**
     * One recipe's rows, in one transaction. Whatever happens, the import goes on to the next.
     *
     * @param  non-empty-list<SheetRow>  $rows
     * @param  array<string, string>  $units
     * @param  array<string, list<Ingredient>>  $byReference
     * @param  array<string, array{0: Ingredient|null, 1: string|null}>  $byName
     */
    private function importGroup(array $rows, array $units, array $byReference, array &$byName, ImportResult $result): void
    {
        $first = $rows[0]['row'];
        $reference = $rows[0]['values']['reference'] ?? null;
        /** @var list<int> $payloadRows sheet row of each line handed to `setLines`, by index */
        $payloadRows = [];

        try {
            $header = $this->headerFields($rows);

            /** @var list<Outcome> $outcomes */
            $outcomes = DB::transaction(function () use ($rows, $header, $units, $byReference, &$byName, &$payloadRows): array {
                return $this->writeGroup($rows, $header, $units, $byReference, $byName, $payloadRows);
            });
        } catch (ValidationException $e) {
            $result->failed($first, $reference, implode(' ', $e->validator->errors()->all()));

            return;
        } catch (ApiException $e) {
            $result->failed($first, $reference, $this->apiMessage($e, $payloadRows));

            return;
        } catch (Throwable $e) {
            report($e);
            $result->failed($first, $reference, 'The recipe could not be imported.');

            return;
        }

        foreach ($outcomes as [$outcome, $row, $ref, $message]) {
            match ($outcome) {
                'created' => $result->created($row, $ref),
                'updated' => $result->updated($row, $ref),
                'unchanged' => $result->unchanged(),
                'skipped' => $result->skipped($row, $ref, (string) $message),
                'failed' => $result->failed($row, $ref, (string) $message),
            };
        }
    }

    /**
     * @param  non-empty-list<SheetRow>  $rows
     * @param  array<string, string>  $header
     * @param  array<string, string>  $units
     * @param  array<string, list<Ingredient>>  $byReference
     * @param  array<string, array{0: Ingredient|null, 1: string|null}>  $byName
     * @param  list<int>  $payloadRows
     * @return list<Outcome>
     *
     * @throws ApiException
     * @throws ValidationException
     */
    private function writeGroup(array $rows, array $header, array $units, array $byReference, array &$byName, array &$payloadRows): array
    {
        $first = $rows[0]['row'];
        $reference = $rows[0]['values']['reference'] ?? null;

        $lines = [];

        foreach ($rows as $row) {
            if (($row['values']['ingredient_ref'] ?? null) !== null || ($row['values']['ingredient'] ?? null) !== null) {
                $lines[] = $this->resolveLine($row, $units, $byReference, $byName);
            }
        }

        $recipe = $this->matchRecipe($reference, $header['name_en'] ?? null);

        if ($recipe instanceof Recipe && $recipe->status === RecipeStatus::Archived) {
            return [['skipped', $first, $recipe->source_ref, 'This recipe is archived; restore it before importing over it.']];
        }

        $attributes = $this->recipeAttributes($header, creating: ! $recipe instanceof Recipe);
        $yields = $this->yieldAttributes($header, $units);

        return $recipe instanceof Recipe
            ? $this->updateRecipe($recipe, $first, $attributes, $yields, $lines, $payloadRows)
            : $this->createRecipe($first, $attributes, $yields, $lines, $payloadRows);
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @param  array<string, mixed>  $yields
     * @param  list<SheetLine>  $lines
     * @param  list<int>  $payloadRows
     * @return list<Outcome>
     *
     * @throws ApiException
     */
    private function createRecipe(int $first, array $attributes, array $yields, array $lines, array &$payloadRows): array
    {
        // No `source_ref`: the server numbers a new recipe in the `RC-` series; a sheet never chooses one.
        /** @var array{name_en: string, name_ar?: string|null, recipe_category?: string|null, notes?: string|null, shelf_life_days?: int|null} $create */
        $create = $attributes;
        $created = $this->recipes->create($create);
        $version = $created['version'];

        if ($yields !== []) {
            $this->versions->update($version, $yields, $version->lock_version);
        }

        $skipped = [];
        $payload = [];

        foreach ($lines as $line) {
            if ($line['error'] !== null || ! $line['ingredient'] instanceof Ingredient) {
                $skipped[] = ['skipped', $line['row'], null, (string) $line['error']];

                continue;
            }

            $payload[] = [
                'ingredient_id' => (string) $line['ingredient']->getKey(),
                'quantity' => $line['quantity'],
                'unit_id' => $line['unit_id'],
                'source_designation' => $line['designation'] ?? $line['ingredient']->name_en,
                'comment' => $line['comment'],
            ];
            $payloadRows[] = $line['row'];
        }

        if ($payload !== []) {
            $this->versions->setLines($version, $payload, $version->lock_version);
        }

        return [['created', $lines[0]['row'] ?? $first, $created['recipe']->source_ref, null], ...$skipped];
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @param  array<string, mixed>  $yields
     * @param  list<SheetLine>  $lines
     * @param  list<int>  $payloadRows
     * @return list<Outcome>
     *
     * @throws ApiException
     */
    private function updateRecipe(Recipe $recipe, int $first, array $attributes, array $yields, array $lines, array &$payloadRows): array
    {
        $unresolved = array_values(array_filter($lines, static fn (array $line): bool => $line['error'] !== null));

        if ($unresolved !== []) {
            return [['failed', $first, $recipe->source_ref, implode(' ', array_map(
                static fn (array $line): string => "Row {$line['row']}: {$line['error']}",
                $unresolved,
            ))]];
        }

        $changed = false;
        $diff = $this->recipeDiff($recipe, $attributes);

        if ($diff !== []) {
            $this->recipes->update($recipe, $diff, $recipe->lock_version);
            $changed = true;
        }

        $current = $this->summaries->currentVersions([(string) $recipe->getKey()])[(string) $recipe->getKey()] ?? null;

        /** @var list<RecipeVersionLine> $existing */
        $existing = $current === null ? [] : array_values(RecipeVersionLine::query()
            ->where('recipe_version_id', $current->getKey())
            ->orderBy('line_number')
            ->get()
            ->all());

        // Zero line rows is a header-only group: it never touches the formulation.
        $merged = $lines === [] ? null : $this->mergeLines($existing, $lines, $payloadRows);
        $linesDiffer = $merged !== null && ! $this->sameLines($existing, $merged);
        $yieldDiff = $current === null ? $yields : $this->yieldDiff($current, $yields);

        if ($linesDiffer || $yieldDiff !== []) {
            $target = $current !== null && $current->isEditable() ? $current : $this->versions->newDraft($recipe, $current);

            if ($yieldDiff !== []) {
                $this->versions->update($target, $yieldDiff, $target->lock_version);
            }

            if ($linesDiffer) {
                $target->refresh();
                $this->versions->setLines($target, $merged, $target->lock_version);
            }

            $changed = true;
        }

        return [[$changed ? 'updated' : 'unchanged', $first, $recipe->source_ref, null]];
    }

    /**
     * The sheet's lines laid over the stored ones. A stored line is matched by ingredient —
     * positionally when an ingredient repeats; line numbers are not an identity — and keeps every
     * value the sheet leaves blank, and always its cost.
     *
     * @param  list<RecipeVersionLine>  $existing
     * @param  list<SheetLine>  $lines  every one resolved
     * @param  list<int>  $payloadRows
     * @return list<LinePayload>
     */
    private function mergeLines(array $existing, array $lines, array &$payloadRows): array
    {
        /** @var array<string, list<RecipeVersionLine>> $pool */
        $pool = [];

        foreach ($existing as $line) {
            $pool[$line->ingredient_id][] = $line;
        }

        $merged = [];

        foreach ($lines as $line) {
            $ingredient = $line['ingredient'];

            if (! $ingredient instanceof Ingredient) {
                continue;
            }

            $id = (string) $ingredient->getKey();
            $stored = isset($pool[$id]) && $pool[$id] !== [] ? array_shift($pool[$id]) : null;

            if ($stored instanceof RecipeVersionLine) {
                $row = [
                    'ingredient_id' => $id,
                    'quantity' => $line['quantity'] ?? $stored->quantity,
                    'unit_id' => $line['unit_id'] ?? $stored->unit_id,
                    // A cell that only repeats the ingredient's own name — which is what an export
                    // writes — adds nothing to a line that never carried a designation.
                    'source_designation' => $stored->source_designation
                        ?? ($line['designation'] !== null && mb_strtolower($line['designation']) !== mb_strtolower($ingredient->name_en) ? $line['designation'] : null),
                    'comment' => $line['comment'] ?? $stored->comment,
                ];

                // The stored cost is per the stored unit. A sheet that changes the unit sends the
                // line uncosted, so the catalogue prices it in the new unit (or leaves it uncosted)
                // rather than a per-gram figure being applied to kilograms.
                if ($line['unit_id'] === null || $line['unit_id'] === $stored->unit_id) {
                    $row['unit_cost_amount'] = $stored->unit_cost_amount;
                    $row['cost_currency_code'] = $stored->cost_currency_code;
                }

                $merged[] = $row;
            } else {
                $merged[] = [
                    'ingredient_id' => $id,
                    'quantity' => $line['quantity'],
                    'unit_id' => $line['unit_id'],
                    'source_designation' => $line['designation'] ?? $ingredient->name_en,
                    'comment' => $line['comment'],
                ];
            }

            $payloadRows[] = $line['row'];
        }

        return $merged;
    }

    /**
     * @param  list<RecipeVersionLine>  $existing
     * @param  list<LinePayload>  $merged
     */
    private function sameLines(array $existing, array $merged): bool
    {
        if (count($existing) !== count($merged)) {
            return false;
        }

        foreach ($existing as $index => $line) {
            $candidate = $merged[$index];

            if ($line->ingredient_id !== $candidate['ingredient_id']
                || ! self::sameDecimal($line->quantity, $candidate['quantity'] ?? null)
                || $line->unit_id !== ($candidate['unit_id'] ?? null)
                || ! self::sameDecimal($line->unit_cost_amount, $candidate['unit_cost_amount'] ?? null)
                || $line->cost_currency_code !== ($candidate['cost_currency_code'] ?? null)
                || $line->source_designation !== ($candidate['source_designation'] ?? null)
                || $line->comment !== ($candidate['comment'] ?? null)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $yields
     * @return array<string, mixed>
     */
    private function yieldDiff(RecipeVersion $version, array $yields): array
    {
        $diff = [];

        if (array_key_exists('yield_quantity', $yields) && ! self::sameDecimal($version->yield_quantity, is_string($yields['yield_quantity']) ? $yields['yield_quantity'] : null)) {
            $diff['yield_quantity'] = $yields['yield_quantity'];
        }

        if (array_key_exists('yield_unit_id', $yields) && $version->yield_unit_id !== $yields['yield_unit_id']) {
            $diff['yield_unit_id'] = $yields['yield_unit_id'];
        }

        if (array_key_exists('yield_piece_count', $yields) && $version->yield_piece_count !== $yields['yield_piece_count']) {
            $diff['yield_piece_count'] = $yields['yield_piece_count'];
        }

        return $diff;
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function recipeDiff(Recipe $recipe, array $attributes): array
    {
        return array_filter(
            $attributes,
            static fn (mixed $value, string $field): bool => $recipe->getAttribute($field) !== $value,
            ARRAY_FILTER_USE_BOTH,
        );
    }

    /**
     * @param  SheetRow  $row
     * @param  array<string, string>  $units
     * @param  array<string, list<Ingredient>>  $byReference
     * @param  array<string, array{0: Ingredient|null, 1: string|null}>  $byName
     * @return SheetLine
     */
    private function resolveLine(array $row, array $units, array $byReference, array &$byName): array
    {
        $values = $row['values'];
        $text = $values['ingredient'] ?? null;
        $line = [
            'row' => $row['row'],
            'ingredient' => null,
            'error' => null,
            'designation' => $text,
            'quantity' => null,
            'unit_id' => null,
            'comment' => $values['comment'] ?? null,
        ];

        $reference = $values['ingredient_ref'] ?? null;

        [$ingredient, $error] = $reference !== null
            ? $this->ingredientByReference($reference, $byReference)
            : $this->ingredientByName((string) $text, $byName);

        if ($error !== null) {
            return ['error' => $error] + $line;
        }

        $line['ingredient'] = $ingredient;

        $quantity = $values['quantity'] ?? null;

        if ($quantity !== null) {
            $decimal = self::decimal($quantity);

            if ($decimal === null || bccomp($decimal, '0', 6) !== 1) {
                return ['error' => "Quantity \"{$quantity}\" must be a number greater than zero."] + $line;
            }

            $line['quantity'] = $decimal;
        }

        $unit = $values['unit'] ?? null;

        if ($unit !== null) {
            $unitId = $units[mb_strtolower($unit)] ?? null;

            if ($unitId === null) {
                return ['error' => "Unit \"{$unit}\" is not a unit this system knows."] + $line;
            }

            $line['unit_id'] = $unitId;
        }

        if ($line['comment'] !== null && mb_strlen($line['comment']) > 255) {
            return ['error' => 'Comment is longer than 255 characters.'] + $line;
        }

        if ($text !== null && mb_strlen($text) > 160) {
            return ['error' => 'Ingredient is longer than 160 characters.'] + $line;
        }

        return $line;
    }

    /**
     * @param  array<string, list<Ingredient>>  $byReference
     * @return array{0: Ingredient|null, 1: string|null}
     */
    private function ingredientByReference(string $reference, array $byReference): array
    {
        $candidates = $byReference[$reference] ?? [];

        if ($candidates === []) {
            return [null, "No ingredient has reference {$reference}."];
        }

        if (count($candidates) > 1) {
            return [null, sprintf(
                '%d ingredients carry reference %s: %s.',
                count($candidates),
                $reference,
                implode(', ', array_map(static fn (Ingredient $ingredient): string => $ingredient->name_en, $candidates)),
            )];
        }

        $ingredient = $candidates[0];

        if ($ingredient->status !== IngredientStatus::Active) {
            return [null, "{$reference} ({$ingredient->name_en}) is {$ingredient->status->value} and cannot be added to a recipe."];
        }

        return [$ingredient, null];
    }

    /**
     * Ambiguity is refused, never resolved: two rows that answer to one name — the kitchen's own
     * and the platform's, say — are the person's call, and the message names both references.
     *
     * @param  array<string, array{0: Ingredient|null, 1: string|null}>  $byName
     * @return array{0: Ingredient|null, 1: string|null}
     */
    private function ingredientByName(string $text, array &$byName): array
    {
        $key = mb_strtolower($text);

        if (isset($byName[$key])) {
            return $byName[$key];
        }

        $candidates = $this->ingredients->resolveDesignationCandidates($text, $this->context->organisationId());
        $active = array_values(array_filter(
            $candidates,
            static fn (Ingredient $ingredient): bool => $ingredient->status === IngredientStatus::Active,
        ));

        return $byName[$key] = match (true) {
            count($active) === 1 => [$active[0], null],
            count($active) > 1 => [null, sprintf(
                '%s ingredients are named %s: %s — fill in Ingredient ref.',
                count($active) === 2 ? 'Two' : (string) count($active),
                $text,
                implode(', ', array_map(static fn (Ingredient $ingredient): string => $ingredient->source_ref ?? (string) $ingredient->getKey(), $active)),
            )],
            $candidates !== [] => [null, "{$text} is not active and cannot be added to a recipe."],
            default => [null, "No ingredient named {$text}."],
        };
    }

    /**
     * @throws ValidationException
     */
    private function matchRecipe(?string $reference, ?string $nameEn): ?Recipe
    {
        if ($reference === null && $nameEn === null) {
            return null;
        }

        $matches = $reference !== null
            ? Recipe::query()->where('source_ref', $reference)->get()
            : Recipe::query()->whereRaw('lower(name_en) = ?', [mb_strtolower((string) $nameEn)])->get();

        if ($matches->count() > 1) {
            throw ValidationException::withMessages(['recipe' => $reference !== null
                ? "{$matches->count()} recipes carry reference {$reference}."
                : sprintf('%d recipes are named %s: %s — fill in Reference.', $matches->count(), $nameEn, $matches->pluck('source_ref')->implode(', '))]);
        }

        $recipe = $matches->first();

        // A Reference names an existing recipe or nothing: the server assigns `RC-` handles, so a
        // reference nobody holds is a typo or another kitchen's sheet, never a request to create.
        if ($reference !== null && ! $recipe instanceof Recipe) {
            throw ValidationException::withMessages(['reference' => "No recipe has reference {$reference}."]);
        }

        return $recipe instanceof Recipe ? $recipe : null;
    }

    /**
     * The recipe identity fields the group sets, validated by the same rules the create and update
     * routes apply.
     *
     * @param  array<string, string>  $header
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    private function recipeAttributes(array $header, bool $creating): array
    {
        $attributes = [];

        foreach (['name_en' => 'name_en', 'name_ar' => 'name_ar', 'category' => 'recipe_category', 'notes' => 'notes', 'shelf_life_days' => 'shelf_life_days'] as $column => $field) {
            if (isset($header[$column])) {
                $attributes[$field] = $header[$column];
            }
        }

        $rules = array_intersect_key(
            $creating ? (new StoreRecipeRequest)->rules() : (new UpdateRecipeRequest)->rules(),
            array_flip(['name_en', 'name_ar', 'recipe_category', 'notes', 'shelf_life_days']),
        );

        Validator::make($attributes, $rules, [], self::LABELS)->validate();

        if (isset($attributes['shelf_life_days'])) {
            $attributes['shelf_life_days'] = (int) $attributes['shelf_life_days'];
        }

        return $attributes;
    }

    /**
     * @param  array<string, string>  $header
     * @param  array<string, string>  $units
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    private function yieldAttributes(array $header, array $units): array
    {
        $yields = [];

        if (isset($header['yield_quantity'])) {
            $yields['yield_quantity'] = self::decimal($header['yield_quantity']) ?? $header['yield_quantity'];
        }

        if (isset($header['yield_unit'])) {
            $unitId = $units[mb_strtolower($header['yield_unit'])] ?? null;

            if ($unitId === null) {
                throw ValidationException::withMessages(['yield_unit_id' => "Yield unit \"{$header['yield_unit']}\" is not a unit this system knows."]);
            }

            $yields['yield_unit_id'] = $unitId;
        }

        if (isset($header['yield_pieces'])) {
            $yields['yield_piece_count'] = $header['yield_pieces'];
        }

        Validator::make(
            $yields,
            array_intersect_key((new UpdateRecipeVersionRequest)->rules(), array_flip(['yield_quantity', 'yield_unit_id', 'yield_piece_count'])),
            [],
            self::LABELS,
        )->validate();

        if (isset($yields['yield_piece_count'])) {
            $yields['yield_piece_count'] = (int) $yields['yield_piece_count'];
        }

        return $yields;
    }

    /**
     * The group's recipe-level values, each the one non-blank value its rows agree on.
     *
     * @param  non-empty-list<SheetRow>  $rows
     * @return array<string, string>
     *
     * @throws ValidationException
     */
    private function headerFields(array $rows): array
    {
        /** @var array<string, array{value: string, row: int}> $fields */
        $fields = [];

        foreach ($rows as $row) {
            foreach (self::HEADER_FIELDS as $field) {
                $value = $row['values'][$field] ?? null;

                if ($value === null) {
                    continue;
                }

                if (! isset($fields[$field])) {
                    $fields[$field] = ['value' => $value, 'row' => $row['row']];

                    continue;
                }

                if (! self::sameCell($field, $fields[$field]['value'], $value)) {
                    throw ValidationException::withMessages([$field => sprintf(
                        'Row %d and row %d disagree on %s.',
                        $fields[$field]['row'],
                        $row['row'],
                        self::HEADERS[$field],
                    )]);
                }
            }
        }

        return array_map(static fn (array $entry): string => $entry['value'], $fields);
    }

    /**
     * @param  array<string, string|null>  $values
     */
    private function groupKey(array $values): ?string
    {
        $reference = $values['reference'] ?? null;

        if ($reference !== null) {
            return 'ref:'.$reference;
        }

        $name = $values['name_en'] ?? null;

        return $name === null ? null : 'name:'.self::groupName($name);
    }

    private static function groupName(string $value): string
    {
        return mb_strtolower((string) preg_replace('/\s+/u', ' ', trim($value)));
    }

    /**
     * Unit id by lower-cased code — one read for the whole sheet.
     *
     * @return array<string, string>
     */
    private function unitIdsByCode(): array
    {
        $units = [];

        foreach (MeasurementUnit::query()->get(['id', 'code']) as $unit) {
            $units[mb_strtolower($unit->code)] ??= (string) $unit->getKey();
        }

        return $units;
    }

    /**
     * Every food ingredient the sheet names by reference, visible to this kitchen (its own rows
     * and the platform's), keyed by reference — one read for the whole sheet.
     *
     * @param  array<string, non-empty-list<SheetRow>>  $groups
     * @return array<string, list<Ingredient>>
     */
    private function ingredientsByReference(array $groups): array
    {
        $references = [];

        foreach ($groups as $rows) {
            foreach ($rows as $row) {
                $reference = $row['values']['ingredient_ref'] ?? null;

                if ($reference !== null) {
                    $references[$reference] = true;
                }
            }
        }

        if ($references === []) {
            return [];
        }

        $byReference = [];

        foreach (Ingredient::query()->excludingPackaging()->whereIn('source_ref', array_keys($references))->get() as $ingredient) {
            $byReference[(string) $ingredient->source_ref][] = $ingredient;
        }

        return $byReference;
    }

    /**
     * The refusal's message, with each `lines.{i}.*` field pointed back at the sheet row of line i.
     *
     * @param  list<int>  $payloadRows
     */
    private function apiMessage(ApiException $exception, array $payloadRows): string
    {
        $fields = $exception->details['fields'] ?? null;

        if (! is_array($fields) || $fields === []) {
            return $exception->getMessage();
        }

        $parts = [];

        foreach ($fields as $field => $messages) {
            $text = implode(' ', array_map(static fn (mixed $message): string => is_scalar($message) ? (string) $message : '', (array) $messages));

            if (preg_match('/^lines\.(\d+)\./', (string) $field, $match) === 1 && isset($payloadRows[(int) $match[1]])) {
                $text = "Row {$payloadRows[(int) $match[1]]}: {$text}";
            }

            $parts[] = $text;
        }

        return implode(' ', $parts);
    }

    private static function sameCell(string $field, string $a, string $b): bool
    {
        if (in_array($field, ['yield_quantity', 'yield_pieces', 'shelf_life_days'], true)) {
            $left = self::decimal($a);
            $right = self::decimal($b);

            if ($left !== null && $right !== null) {
                return bccomp($left, $right, 6) === 0;
            }
        }

        // Case-insensitive for the two that group or resolve that way: `Sheet A` and `sheet a`
        // are one recipe, and `KG` and `kg` one unit.
        if ($field === 'yield_unit' || $field === 'name_en') {
            return self::groupName($a) === self::groupName($b);
        }

        return $a === $b;
    }

    private static function sameDecimal(?string $a, ?string $b): bool
    {
        if ($a === null || $b === null) {
            return $a === $b;
        }

        $left = self::decimal($a);
        $right = self::decimal($b);

        return $left !== null && $right !== null ? bccomp($left, $right, 6) === 0 : $a === $b;
    }

    /**
     * A plain decimal as a numeric string, or null for anything bcmath would refuse.
     *
     * @return numeric-string|null
     */
    private static function decimal(string $value): ?string
    {
        $trimmed = trim($value);

        return is_numeric($trimmed) && preg_match('/^-?\d+(\.\d+)?$/', $trimmed) === 1 ? $trimmed : null;
    }

    private static function number(?string $value): ?float
    {
        return $value === null || ! is_numeric($value) ? null : (float) $value;
    }
}
