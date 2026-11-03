<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemOption;
use Healthy360\Ingredients\Enums\AllergenContainment;
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
 * allergens from that recipe's published version, through
 * {@see DerivedAllergenService::forRecipe()}. A line that picks it carries them
 * beside the dish's own ({@see allergensOf()}).
 *
 * A choice with no link is **not offered**: {@see forItem()} leaves it out and
 * a line that names it is refused `option_unlinked`. Choices written before the
 * link existed stay that way until a kitchen links them; nothing guesses one. A
 * link to a recipe with no published version takes the dish off sale through
 * {@see CatalogueItem::scopeAllergensAssessed()} until the recipe is published.
 *
 * @phpstan-type DishOption array{id: string, kind: string, group_en: string|null, group_ar: string|null, name_en: string, name_ar: string}
 * @phpstan-type Allergen array{allergen_code: string, containment: string}
 * @phpstan-type EditorOption array{id: string, kind: string, group_en: string|null, group_ar: string|null, name_en: string, name_ar: string, recipe_id: string|null, allergens: list<Allergen>|null}
 */
final readonly class DishOptions
{
    public function __construct(private DerivedAllergenService $allergens) {}

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
     * linked to a recipe.
     *
     * @return list<DishOption>
     */
    public function forItem(string $catalogueItemId): array
    {
        return array_values($this->rows($catalogueItemId)
            ->filter(static fn (CatalogueItemOption $option): bool => $option->kind !== 'choice' || $option->recipe_id !== null)
            ->map(fn (CatalogueItemOption $option): array => $this->shape($option))
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
        return array_values($this->rows((string) $item->getKey())
            ->map(function (CatalogueItemOption $option) use ($item): array {
                $label = $option->recipe_id === null ? null : $this->allergens->forRecipe($option->recipe_id, (string) $item->organisation_id);

                return [
                    ...$this->shape($option),
                    'recipe_id' => $option->recipe_id,
                    'allergens' => $label === null || $label['basis'] === 'none' ? null : $this->public($label['allergens']),
                ];
            })
            ->all());
    }

    /**
     * The chosen options as a line stores them, or null when one is not offered
     * on this dish (any more) or two come from one group. {@see refusal()} says
     * which.
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

        $groups = array_filter(array_column($chosen, 'group_en'));

        return count($groups) === count(array_unique($groups)) ? $chosen : null;
    }

    /**
     * Why {@see snapshot()} refused: `option_unlinked` when a chosen choice has
     * no recipe behind it, else `option_unknown`.
     *
     * @param  list<string>  $optionIds
     */
    public function refusal(string $catalogueItemId, array $optionIds): string
    {
        $unlinked = CatalogueItemOption::withoutTenancy()
            ->where('catalogue_item_id', $catalogueItemId)
            ->whereIn('id', $optionIds)
            ->where('kind', 'choice')
            ->whereNull('recipe_id')
            ->exists();

        return $unlinked ? 'option_unlinked' : 'option_unknown';
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

        $choices = CatalogueItemOption::withoutTenancy()
            ->whereIn('id', $optionIds)
            ->where('kind', 'choice')
            ->get();

        foreach ($choices as $choice) {
            $label = $choice->recipe_id === null
                ? ['basis' => 'none', 'allergens' => []]
                : $this->allergens->forRecipe($choice->recipe_id, $choice->organisation_id);

            $assessed = $assessed && $label['basis'] !== 'none';
            $allergens = self::merge($allergens, $this->public($label['allergens']));
        }

        return ['assessed' => $assessed, 'allergens' => $allergens];
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
     * The code and the containment, and nothing about the formulation.
     *
     * @param  list<array{allergen_code: string, containment: string, derivation: string, source_ingredient_id: string|null}>  $allergens
     * @return list<Allergen>
     */
    private function public(array $allergens): array
    {
        return array_map(static fn (array $allergen): array => [
            'allergen_code' => $allergen['allergen_code'],
            'containment' => $allergen['containment'],
        ], $allergens);
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
