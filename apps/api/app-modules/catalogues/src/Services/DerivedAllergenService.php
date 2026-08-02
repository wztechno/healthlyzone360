<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionAllergen;
use Healthy360\Recipes\Services\AllergenRollupService;

/**
 * What a catalogue item's allergen declaration says, computed on read.
 *
 * **Two bases, in order of authority.**
 *
 * 1. **A published recipe version's frozen label.** If the item links a recipe
 *    and that recipe has a published version, its `recipe_version_allergens`
 *    rows *are* the answer. They were derived at publication from the
 *    formulation's effective mappings and frozen there, and a human's
 *    `declared` row can only have strengthened them. Recomputing over the
 *    item's ingredient list instead would produce a second opinion about a
 *    question that has already been answered authoritatively — and a weaker
 *    one, because the item's list is a customer-facing summary and the
 *    version's lines are the whole formulation.
 * 2. **The item's own ingredient rows.** A bought-in dish or a retail product
 *    has no formulation, so the union of its listed ingredients' effective
 *    mappings is the honest basis. The strongest containment wins — `contains`
 *    beats `may_contain`, never the other way round — which is the same rule
 *    the recipe roll-up applies, reused rather than reimplemented.
 *
 * **Nothing is stored** (K1.4). There is no roll-up column on
 * `catalogue_items` and no per-item allergen table: the joins are cheap, and a
 * stored copy is a copy that goes stale the moment a mapping changes. Stored
 * labels exist exactly where they must — on a published recipe version, where
 * freezing is the point — and K1.8 revisits this when the recompute job and
 * the readiness evaluator arrive together. An item whose derivation is
 * unavailable reports an empty set with `basis = none`, never an empty set
 * that looks like "no allergens".
 */
final readonly class DerivedAllergenService
{
    public function __construct(private AllergenRollupService $rollup) {}

    /**
     * @return array{
     *     basis: string,
     *     recipe_version_id: string|null,
     *     allergens: list<array{allergen_code: string, containment: string, derivation: string, source_ingredient_id: string|null}>
     * }
     */
    public function forItem(CatalogueItem $item): array
    {
        $version = $this->publishedVersion($item);

        if ($version instanceof RecipeVersion) {
            return [
                'basis' => 'recipe_version',
                'recipe_version_id' => (string) $version->getKey(),
                'allergens' => $this->fromFrozenLabel($version),
            ];
        }

        $ingredientIds = $this->listedIngredientIds($item);

        if ($ingredientIds === []) {
            // Not "no allergens" — "no basis". An item nobody has described
            // has not been assessed, and silence is not a statement of absence
            // (the rule the recipe publish gate is built on).
            return ['basis' => 'none', 'recipe_version_id' => null, 'allergens' => []];
        }

        return [
            'basis' => 'item_ingredients',
            'recipe_version_id' => null,
            'allergens' => $this->fromIngredients($ingredientIds, $item->organisation_id),
        ];
    }

    /**
     * The published version of the linked recipe, if there is one. At most one
     * exists — the partial unique index on `recipe_versions` guarantees it —
     * so this is a `first()` with no tie-break to invent.
     */
    public function publishedVersion(CatalogueItem $item): ?RecipeVersion
    {
        if ($item->recipe_id === null) {
            return null;
        }

        $version = RecipeVersion::withoutTenancy()
            ->where('recipe_id', $item->recipe_id)
            ->where('organisation_id', $item->organisation_id)
            ->where('status', RecipeVersionStatus::Published->value)
            ->first();

        return $version instanceof RecipeVersion ? $version : null;
    }

    /**
     * @return list<string>
     */
    public function listedIngredientIds(CatalogueItem $item): array
    {
        return array_values(CatalogueItemIngredient::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->orderBy('display_order')
            ->orderBy('id')
            ->pluck('ingredient_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }

    /**
     * @return list<array{allergen_code: string, containment: string, derivation: string, source_ingredient_id: string|null}>
     */
    private function fromFrozenLabel(RecipeVersion $version): array
    {
        $rows = RecipeVersionAllergen::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('allergen_code')
            ->get();

        return array_values($rows->map(static fn (RecipeVersionAllergen $row): array => [
            'allergen_code' => $row->allergen_code,
            'containment' => $row->containment->value,

            // Carried through rather than flattened: "a human said so" and
            // "the mappings imply it" are different claims, and a label that
            // hid the difference would make a declared warning look computed.
            'derivation' => $row->derivation->value,
            'source_ingredient_id' => $row->source_ingredient_id,
        ])->all());
    }

    /**
     * @param  list<string>  $ingredientIds
     * @return list<array{allergen_code: string, containment: string, derivation: string, source_ingredient_id: string|null}>
     */
    private function fromIngredients(array $ingredientIds, string $organisationId): array
    {
        $effective = $this->rollup->effectiveFor(array_values(array_unique($ingredientIds)), $organisationId);
        $rolled = $this->rollup->rollUp($ingredientIds, $effective);

        return array_map(static fn (array $entry): array => [
            'allergen_code' => $entry['allergen_code'],
            'containment' => $entry['containment']->value,

            // Always `derived`: nothing about a catalogue item is a human's
            // allergen declaration. Declarations live on a recipe version,
            // where a chef who knows the fryer is shared can make one.
            'derivation' => 'derived',
            'source_ingredient_id' => $entry['source_ingredient_id'],
        ], $rolled);
    }
}
