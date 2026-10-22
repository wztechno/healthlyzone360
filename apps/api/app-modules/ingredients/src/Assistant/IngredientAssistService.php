<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Assistant;

use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAlias;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Ingredients\Nutrition\NutritionReferenceService;
use Healthy360\Ingredients\Services\PackagingBranch;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Laravel\Ai\Responses\StructuredAgentResponse;
use Throwable;

/**
 * What the new-ingredient form is told about a name the cook just typed.
 *
 * Deterministic first, the model last, and every part survives the failure of the others:
 *
 * 1. **Existing matches** — every visible food row whose English name, Arabic name or alias equals
 *    the typed name. No AI, so a duplicate is still caught with the assistant down. This is
 *    `IngredientCatalogueService::resolveDesignation()`'s query returning every row rather than
 *    the one it would prefer.
 * 2. **USDA candidates** — the same search the nutrition picker runs. A provider failure is
 *    reported as `unavailable: nutrition`, not an error.
 * 3. **The agent** — one call that may only answer with codes and numbers from lists it was
 *    given. Each answer is validated here and anything off-list becomes null.
 *
 * The Arabic name is a suggestion the form shows as AI-generated and the cook can edit; nothing
 * here writes it to a row.
 */
final readonly class IngredientAssistService
{
    /** Finished goods filed in the ingredient taxonomy; the ingredient form does not offer them. */
    private const array HIDDEN_CATEGORY_CODES = ['sauce', 'dressings', 'beverage', 'bread'];

    public function __construct(
        private NutritionReferenceService $references,
        private PackagingBranch $packaging,
        private TenantContext $context,
    ) {}

    /** @return array<string, mixed> */
    public function assist(string $nameEn): array
    {
        $unavailable = [];
        // ponytail: the whole visible list goes into the prompt (~400 rows, ~4k tokens). Past ~2k
        // rows, shortlist with pg_trgm similarity to the typed name instead.
        $visible = $this->visible()->orderBy('name_en')->get(['id', 'organisation_id', 'name_en', 'name_ar']);
        $existing = $this->existingMatches($nameEn);

        try {
            $candidates = $this->references->search($nameEn);
        } catch (Throwable $error) {
            report($error);
            $candidates = null;
            $unavailable[] = 'nutrition';
        }

        $categories = $this->selectableCategories();
        $answer = [];

        try {
            $response = (new IngredientAssistant(
                categories: array_map(fn (array $category): string => sprintf(
                    '%s — %s — %s', $category['code'], $category['name'], $category['parent'] ?? 'top level',
                ), $categories),
                ingredients: array_values($visible->values()->map(fn (Ingredient $row, int $number): string => sprintf(
                    '%d — %s — %s', $number, $row->name_en, $row->name_ar,
                ))->all()),
                candidates: array_map(fn (int $number, array $candidate): string => sprintf(
                    '%d — %s — %s — %s', $number, $candidate['label'], $candidate['data_type'], $candidate['suitable'] ? 'suitable' : 'unsuitable',
                ), array_keys($candidates ?? []), $candidates ?? []),
            ))->prompt($nameEn);
            $answer = $response instanceof StructuredAgentResponse ? $response->toArray() : [];
        } catch (Throwable $error) {
            report($error);
            $unavailable[] = 'assistant';
        }

        [$categoryCode, $subcategoryCode] = $this->categoryPair(
            $categories, $this->stringOrNull($answer['category_code'] ?? null), $this->stringOrNull($answer['subcategory_code'] ?? null),
        );

        return [
            'existing_matches' => $existing->map(fn (Ingredient $row): array => $this->reference($row))->values()->all(),
            'possible_duplicates' => $this->possibleDuplicates($answer['possible_duplicates'] ?? [], $visible, $existing),
            'name_ar' => $this->arabic($answer['name_ar'] ?? null),
            'category_code' => $categoryCode,
            'subcategory_code' => $subcategoryCode,
            'nutrition' => $candidates === null ? null : $this->nutrition($candidates, $answer),
            'unavailable' => $unavailable,
        ];
    }

    /**
     * Food rows this kitchen sees in its ingredient list: platform and own, not packaging, not
     * archived, and not a platform row the kitchen has forked (the fork stands in for it).
     *
     * @return Builder<Ingredient>
     */
    private function visible(): Builder
    {
        $organisationId = $this->context->organisationId();

        return Ingredient::query()
            ->excludingPackaging()
            ->whereIn('status', [IngredientStatus::Active->value, IngredientStatus::Inactive->value])
            ->when($organisationId !== null, fn (Builder $query) => $query->whereNotIn(
                'id',
                Ingredient::withoutTenancy()
                    ->where('organisation_id', $organisationId)
                    ->whereNotNull('forked_from_ingredient_id')
                    ->select('forked_from_ingredient_id'),
            ));
    }

    /**
     * Also the quick add's duplicate check, so a name the form would call a match is never created.
     *
     * @return Collection<int, Ingredient>
     */
    public function existingMatches(string $nameEn): Collection
    {
        $normalised = IngredientAlias::normalise($nameEn);

        return $this->visible()
            ->where(fn (Builder $query) => $query
                ->whereRaw('lower(name_en) = ?', [$normalised])
                ->orWhereRaw('lower(name_ar) = ?', [$normalised])
                ->orWhereIn('id', IngredientAlias::query()->where('alias_normalised', $normalised)->select('ingredient_id')))
            ->orderBy('name_en')
            ->get(['id', 'organisation_id', 'name_en', 'name_ar']);
    }

    /**
     * The categories the ingredient form offers, each with its parent's code (null at the top).
     *
     * @return list<array{code: string, name: string, parent: string|null}>
     */
    private function selectableCategories(): array
    {
        $rows = IngredientCategory::query()
            ->where('is_active', true)
            ->whereNotIn('id', $this->packaging->categoryIds())
            ->orderByRaw('parent_id nulls first')
            ->orderBy('display_order')
            ->orderBy('code')
            ->get(['id', 'parent_id', 'code', 'name_en']);
        $codes = $rows->mapWithKeys(fn (IngredientCategory $row): array => [(string) $row->id => (string) $row->code]);
        $categories = [];

        foreach ($rows as $row) {
            $parent = $row->parent_id === null ? null : ($codes[(string) $row->parent_id] ?? null);

            if (($row->parent_id !== null && $parent === null) || in_array($parent ?? $row->code, self::HIDDEN_CATEGORY_CODES, true)) {
                continue;
            }

            $categories[] = ['code' => (string) $row->code, 'name' => (string) $row->name_en, 'parent' => $parent];
        }

        return $categories;
    }

    /**
     * A category the form can show, and a sub-category only beneath it. A bad sub-category leaves
     * a good category standing; a bad category takes the sub-category with it.
     *
     * @param  list<array{code: string, name: string, parent: string|null}>  $categories
     * @return array{0: string|null, 1: string|null}
     */
    private function categoryPair(array $categories, ?string $categoryCode, ?string $subcategoryCode): array
    {
        $isTopLevel = fn (array $row): bool => $row['code'] === $categoryCode && $row['parent'] === null;
        $isChild = fn (array $row): bool => $row['code'] === $subcategoryCode && $row['parent'] === $categoryCode;

        if ($categoryCode === null || array_filter($categories, $isTopLevel) === []) {
            return [null, null];
        }

        return [$categoryCode, array_filter($categories, $isChild) === [] ? null : $subcategoryCode];
    }

    /**
     * @param  Collection<int, Ingredient>  $visible
     * @param  Collection<int, Ingredient>  $existing
     * @return list<array<string, mixed>>
     */
    private function possibleDuplicates(mixed $answered, Collection $visible, Collection $existing): array
    {
        $rows = $visible->values();
        $seen = $existing->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();
        $duplicates = [];

        foreach (is_iterable($answered) ? $answered : [] as $entry) {
            $row = is_array($entry) && is_int($entry['number'] ?? null) ? $rows->get($entry['number']) : null;

            if ($row === null || in_array((string) $row->id, $seen, true)) {
                continue;
            }

            $seen[] = (string) $row->id;
            $duplicates[] = $this->reference($row) + ['reason' => $this->stringOrNull($entry['reason'] ?? null)];
        }

        return $duplicates;
    }

    /**
     * @param  list<array<string, mixed>>  $candidates
     * @return array<string, mixed>
     */
    private function nutrition(array $candidates, mixed $answer): array
    {
        $pick = $answer['nutrition_pick'] ?? null;
        $valid = is_int($pick) && ($candidates[$pick]['suitable'] ?? false) === true;
        $relation = $answer['nutrition_relation'] ?? null;

        return [
            'candidates' => $candidates,
            'pick' => $valid ? $pick : null,
            'relation' => $valid && in_array($relation, ['same', 'more_specific', 'different'], true) ? $relation : null,
            'reason' => $valid ? $this->stringOrNull($answer['nutrition_reason'] ?? null) : null,
        ];
    }

    private function arabic(mixed $value): ?string
    {
        $value = $this->stringOrNull($value);

        return $value !== null && preg_match('/\p{Arabic}/u', $value) === 1 ? $value : null;
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /** @return array{id: string, name: array{en: string, ar: string}, is_platform: bool} */
    public function reference(Ingredient $row): array
    {
        return [
            'id' => (string) $row->id,
            'name' => ['en' => (string) $row->name_en, 'ar' => (string) $row->name_ar],
            'is_platform' => $row->organisation_id === null,
        ];
    }
}
