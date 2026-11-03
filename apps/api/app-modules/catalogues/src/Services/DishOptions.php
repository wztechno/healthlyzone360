<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemOption;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The free changes a dish offers: what it is, and what a line chose from it.
 *
 * Removing an ingredient changes the plate and **never the allergen statement**.
 * The kitchen may still cross-contact, so a line with "no peanuts" carries the
 * dish's allergens as they stand.
 *
 * A choice is different: a new sauce is a new thing on the plate. So a choice
 * links the sauce or side recipe it is (owner, 3 Nov 2026) and takes its
 * allergens from that recipe's published version's frozen label ({@see labels()}).
 * A line that picks it carries them beside the dish's own ({@see allergensOf()}),
 * and the customer and the desk see them on the choice before they pick it
 * ({@see forItem()}).
 *
 * A choice with no link is **not offered**: {@see forItem()} leaves it out and
 * a line that names it is refused `option_unlinked`. Choices written before the
 * link existed stay that way until a kitchen links them; nothing guesses one. A
 * link to a recipe with no published version takes the dish off sale through
 * {@see CatalogueItem::scopeAllergensAssessed()} until the recipe is published,
 * and a line that picks such a choice anyway (an amended order's held line) is
 * refused `item_not_assessed` ({@see snapshot()}), so it can never reach an order
 * carrying only the dish's allergens.
 *
 * @phpstan-type DishOption array{id: string, kind: string, group_en: string|null, group_ar: string|null, name_en: string, name_ar: string}
 * @phpstan-type Allergen array{allergen_code: string, containment: string}
 * @phpstan-type OfferedOption array{id: string, kind: string, group_en: string|null, group_ar: string|null, name_en: string, name_ar: string, allergens: list<Allergen>|null}
 * @phpstan-type EditorOption array{id: string, kind: string, group_en: string|null, group_ar: string|null, name_en: string, name_ar: string, recipe_id: string|null, allergens: list<Allergen>|null}
 */
final readonly class DishOptions
{
    public function __construct(private DatabaseTenantContext $tenantContext) {}

    /**
     * What makes two lines of one dish different lines: empty when they carry
     * nothing, so a plain line merges exactly as it always has.
     *
     * @param  list<string>  $optionIds
     */
    public static function lineKey(array $optionIds, ?string $note): string
    {
        $note = trim((string) $note);

        if ($optionIds === [] && $note === '') {
            return '';
        }

        sort($optionIds);

        return sha1(implode(',', $optionIds).'|'.$note);
    }

    /**
     * What a customer or the desk is offered: every removal, and every choice
     * linked to a recipe, each with what it adds to the plate. A removal adds
     * nothing (`[]`); a choice whose recipe has no published basis is `null`:
     * unassessed, never "none".
     *
     * @return list<OfferedOption>
     */
    public function forItem(string $catalogueItemId): array
    {
        $offered = $this->rows($catalogueItemId)
            ->filter(static fn (CatalogueItemOption $option): bool => $option->kind !== 'choice' || $option->recipe_id !== null);
        $labels = $this->labels($offered);

        return array_values($offered
            ->map(fn (CatalogueItemOption $option): array => [
                ...$this->shape($option),
                'allergens' => $option->kind === 'choice' ? ($labels[(string) $option->getKey()] ?? null) : [],
            ])
            ->all());
    }

    /**
     * The kitchen's editor: every row, unlinked choices included, with the link
     * and the linked recipe's published label (null when it has none).
     *
     * @return list<EditorOption>
     */
    public function forEditor(CatalogueItem $item): array
    {
        $rows = $this->rows((string) $item->getKey());
        $labels = $this->labels($rows);

        return array_values($rows
            ->map(fn (CatalogueItemOption $option): array => [
                ...$this->shape($option),
                'recipe_id' => $option->recipe_id,
                'allergens' => $labels[(string) $option->getKey()] ?? null,
            ])
            ->all());
    }

    /**
     * The chosen options as a line stores them, or null when one is not offered
     * on this dish (any more), when a chosen choice's recipe has no published
     * basis, or when two come from one group. {@see refusal()} says which.
     *
     * The unassessed refusal holds on every path, including those that waive the
     * dish's own assessment (an amended order's held lines): the line would
     * otherwise carry the dish's allergens alone, and food safety beats the
     * exemption.
     *
     * @param  list<string>  $optionIds
     * @return list<DishOption>|null
     */
    public function snapshot(string $catalogueItemId, array $optionIds): ?array
    {
        if ($optionIds === []) {
            return [];
        }

        $chosen = array_values(array_filter(
            $this->forItem($catalogueItemId),
            static fn (array $option): bool => in_array($option['id'], $optionIds, true),
        ));

        if (count($chosen) !== count(array_unique($optionIds))) {
            return null;
        }

        if (array_filter($chosen, static fn (array $option): bool => $option['allergens'] === null) !== []) {
            return null;
        }

        $groups = array_filter(array_column($chosen, 'group_en'));

        if (count($groups) !== count(array_unique($groups))) {
            return null;
        }

        return array_map(static function (array $option): array {
            unset($option['allergens']);

            return $option;
        }, $chosen);
    }

    /**
     * Why {@see snapshot()} refused: `option_unlinked` when a chosen choice has
     * no recipe behind it, `item_not_assessed` (the code an unassessed dish is
     * refused with) when its recipe has no published basis, else `option_unknown`.
     *
     * @param  list<string>  $optionIds
     */
    public function refusal(string $catalogueItemId, array $optionIds): string
    {
        $choices = $this->choices($optionIds)
            ->filter(static fn (CatalogueItemOption $choice): bool => $choice->catalogue_item_id === $catalogueItemId);

        if ($choices->contains(static fn (CatalogueItemOption $choice): bool => $choice->recipe_id === null)) {
            return 'option_unlinked';
        }

        $labels = $this->labels($choices);

        return $choices->contains(static fn (CatalogueItemOption $choice): bool => ! isset($labels[(string) $choice->getKey()]))
            ? 'item_not_assessed'
            : 'option_unknown';
    }

    /**
     * What the chosen choices add to a line's allergens: each linked recipe's
     * published label. `assessed` is false when one has no basis, which the
     * allergen check reads as it reads a dish nobody assessed.
     *
     * @param  list<string>  $optionIds
     * @return array{assessed: bool, allergens: list<Allergen>}
     */
    public function allergensOf(array $optionIds): array
    {
        if ($optionIds === []) {
            return ['assessed' => true, 'allergens' => []];
        }

        $assessed = true;
        $allergens = [];

        $choices = $this->choices($optionIds);
        $labels = $this->labels($choices);

        foreach ($choices as $choice) {
            $label = $labels[(string) $choice->getKey()] ?? null;

            $assessed = $assessed && $label !== null;
            $allergens = self::merge($allergens, $label ?? []);
        }

        return ['assessed' => $assessed, 'allergens' => $allergens];
    }

    /**
     * The ingredients the chosen choices put on the plate: every line of each
     * linked recipe's published version, the version {@see allergensOf()} reads
     * the label of. An excluded ingredient in the chosen sauce is on the meal.
     *
     * @param  list<string>  $optionIds
     * @return list<string>
     */
    public function ingredientIdsOf(array $optionIds): array
    {
        if ($optionIds === []) {
            return [];
        }

        $ids = [];

        foreach ($this->choices($optionIds)->whereNotNull('recipe_id')->groupBy('organisation_id') as $organisationId => $linked) {
            /** @var list<string> $lines */
            $lines = $this->tenantContext->during(null, (string) $organisationId, null, fn (): array => $this->publishedVersions($linked)
                ->join('recipe_version_lines', 'recipe_version_lines.recipe_version_id', '=', 'recipe_versions.id')
                ->distinct()
                ->pluck('recipe_version_lines.ingredient_id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all());

            $ids = [...$ids, ...$lines];
        }

        return array_values(array_unique($ids));
    }

    /**
     * Two labels as one, each allergen once at its strongest containment —
     * `contains` beats `may_contain`, the rule the recipe roll-up applies.
     *
     * @param  list<Allergen>  $into
     * @param  list<Allergen>  $from
     * @return list<Allergen>
     */
    public static function merge(array $into, array $from): array
    {
        $byCode = array_column($into, null, 'allergen_code');

        foreach ($from as $allergen) {
            $existing = $byCode[$allergen['allergen_code']] ?? null;

            if ($existing === null || AllergenContainment::from($allergen['containment'])->strength() > AllergenContainment::from($existing['containment'])->strength()) {
                $byCode[$allergen['allergen_code']] = $allergen;
            }
        }

        ksort($byCode);

        return array_values($byCode);
    }

    /**
     * The dish's whole list, as the editor sends it. A row that names its id keeps
     * it, so a basket holding that option still finds it after a rename. A choice
     * names the recipe it is; a removal names none.
     *
     * @param  list<array{id?: string|null, kind: string, group_en?: string|null, group_ar?: string|null, name_en: string, name_ar: string, recipe_id?: string|null}>  $rows
     * @return list<EditorOption>
     */
    public function replace(CatalogueItem $item, array $rows): array
    {
        DB::transaction(function () use ($item, $rows): void {
            $kept = array_values(array_filter(array_column($rows, 'id')));

            CatalogueItemOption::query()
                ->where('catalogue_item_id', $item->getKey())
                ->whereNotIn('id', $kept)
                ->delete();

            foreach ($rows as $order => $row) {
                $option = isset($row['id'])
                    ? CatalogueItemOption::query()->where('catalogue_item_id', $item->getKey())->whereKey($row['id'])->first()
                    : null;

                $option ??= new CatalogueItemOption;
                $choice = $row['kind'] === 'choice';

                $option->organisation_id = (string) $item->organisation_id;
                $option->catalogue_item_id = (string) $item->getKey();
                $option->kind = $row['kind'];
                $option->group_en = $choice ? ($row['group_en'] ?? null) : null;
                $option->group_ar = $choice ? ($row['group_ar'] ?? null) : null;
                $option->name_en = $row['name_en'];
                $option->name_ar = $row['name_ar'];
                $option->recipe_id = $choice ? ($row['recipe_id'] ?? null) : null;
                $option->display_order = $order;

                $option->save();
            }
        });

        return $this->forEditor($item);
    }

    /**
     * @return Collection<int, CatalogueItemOption>
     */
    private function rows(string $catalogueItemId): Collection
    {
        return CatalogueItemOption::withoutTenancy()
            ->where('catalogue_item_id', $catalogueItemId)
            ->orderBy('display_order')
            ->orderBy('id')
            ->get()
            ->toBase();
    }

    /**
     * @param  list<string>  $optionIds
     * @return Collection<int, CatalogueItemOption>
     */
    private function choices(array $optionIds): Collection
    {
        return CatalogueItemOption::withoutTenancy()
            ->whereIn('id', $optionIds)
            ->where('kind', 'choice')
            ->get()
            ->toBase();
    }

    /**
     * Each linked choice's published label (the code and the containment, nothing
     * about the formulation) keyed by option id, in one read per kitchen however
     * many choices there are. A choice missing from the result has no basis: no
     * link, or no published version with a line, the test
     * {@see CatalogueItem::scopeAllergensAssessed()} takes a dish off sale on.
     *
     * **Inside the kitchen's tenant context.** `recipe_versions` and its label are
     * tenant rows whose policies fail closed for a request with no organisation,
     * and the marketplace's meal page is exactly that request;
     * `MarketplaceMeals::allergenCodesOf()` restores the same context for the
     * dish's own label. And because a label row is only reached through a version
     * that was found first, a read that cannot see the version answers
     * "unassessed", never "none".
     *
     * @param  Collection<int, CatalogueItemOption>  $options
     * @return array<string, list<Allergen>>
     */
    private function labels(Collection $options): array
    {
        $labels = [];

        foreach ($options->where('kind', 'choice')->whereNotNull('recipe_id')->groupBy('organisation_id') as $organisationId => $linked) {
            /** @var Collection<int, object{option_id: string, allergen_code: string|null, containment: string|null}> $rows */
            $rows = $this->tenantContext->during(null, (string) $organisationId, null, fn (): Collection => $this->publishedVersions($linked)
                ->leftJoin('recipe_version_allergens', 'recipe_version_allergens.recipe_version_id', '=', 'recipe_versions.id')
                ->orderBy('recipe_version_allergens.allergen_code')
                ->get(['catalogue_item_options.id as option_id', 'recipe_version_allergens.allergen_code', 'recipe_version_allergens.containment'])
                ->toBase());

            foreach ($rows as $row) {
                $optionId = (string) $row->option_id;
                $labels[$optionId] ??= [];

                if ($row->allergen_code !== null) {
                    $labels[$optionId][] = ['allergen_code' => (string) $row->allergen_code, 'containment' => (string) $row->containment];
                }
            }
        }

        return $labels;
    }

    /**
     * These options joined to their linked recipe's published version, when it
     * has a line: `recipe_has_published_lines()`, the assessment scope's own test.
     *
     * @param  Collection<int, CatalogueItemOption>  $options
     */
    private function publishedVersions(Collection $options): Builder
    {
        return DB::table('catalogue_item_options')
            ->join('recipe_versions', static fn (JoinClause $join): JoinClause => $join
                ->on('recipe_versions.recipe_id', '=', 'catalogue_item_options.recipe_id')
                ->on('recipe_versions.organisation_id', '=', 'catalogue_item_options.organisation_id')
                ->where('recipe_versions.status', '=', RecipeVersionStatus::Published->value))
            ->whereIn('catalogue_item_options.id', $options->map(static fn (CatalogueItemOption $option): string => (string) $option->getKey())->values()->all())
            ->whereRaw('recipe_has_published_lines(catalogue_item_options.recipe_id, catalogue_item_options.organisation_id)');
    }

    /**
     * @return DishOption
     */
    private function shape(CatalogueItemOption $option): array
    {
        return [
            'id' => (string) $option->getKey(),
            'kind' => $option->kind,
            'group_en' => $option->group_en,
            'group_ar' => $option->group_ar,
            'name_en' => $option->name_en,
            'name_ar' => $option->name_ar,
        ];
    }
}
