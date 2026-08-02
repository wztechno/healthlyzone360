<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Models\IngredientAllergen;

/**
 * Turns the allergen mappings of a version's line ingredients into the
 * declaration that version carries.
 *
 * **Effective mappings.** A kitchen sees two layers: the platform baseline
 * (`organisation_id` NULL) and its own overlay. The roll-up reads both and
 * takes the *strongest* containment for each class, because the overlay is
 * upgrade-only by construction and the strongest statement is the only safe
 * one to publish. Market scopes are carried rather than filtered: EU-14 and
 * US Big-9 differ, and dropping a `us_only` row here would silently make a
 * US-market label wrong.
 *
 * **One level, honestly.** An intermediate ingredient — one produced by
 * another recipe version — contributes its own mapping rows and not the
 * allergens of the recipe that makes it. Recursive expansion through
 * `recipe_version_outputs` is a real requirement and is not in K1.2; until it
 * exists, an intermediate must carry its own mappings, which is exactly what
 * the publish gate insists on. Pretending to expand recursively and stopping
 * one level down would be worse than not claiming it.
 *
 * Nothing here writes. The service computes; `RecipeVersionService::publish()`
 * decides what to do with the result, because freezing a label is a
 * transaction with an audit trail and not a calculation.
 */
final class AllergenRollupService
{
    /**
     * The effective mapping set of each ingredient, keyed by ingredient
     * identifier and then by allergen class.
     *
     * @param  list<string>  $ingredientIds
     * @return array<string, array<string, array{containment: AllergenContainment, market_scopes: list<string>}>>
     */
    public function effectiveFor(array $ingredientIds, ?string $organisationId): array
    {
        if ($ingredientIds === []) {
            return [];
        }

        $rows = IngredientAllergen::withoutTenancy()
            ->whereIn('ingredient_id', $ingredientIds)
            ->where(function ($query) use ($organisationId): void {
                $query->whereNull('organisation_id');

                if ($organisationId !== null) {
                    $query->orWhere('organisation_id', $organisationId);
                }
            })
            ->orderBy('ingredient_id')
            ->orderBy('allergen_code')
            ->get();

        /** @var array<string, array<string, array{containment: AllergenContainment, market_scopes: list<string>}>> $effective */
        $effective = [];

        foreach ($rows as $row) {
            $ingredientId = $row->ingredient_id;
            $code = $row->allergen_code;
            $existing = $effective[$ingredientId][$code] ?? null;

            $scopes = $existing['market_scopes'] ?? [];

            if (! in_array($row->market_scope->value, $scopes, true)) {
                $scopes[] = $row->market_scope->value;
                sort($scopes);
            }

            $effective[$ingredientId][$code] = [
                'containment' => $existing === null || $row->containment->strength() > $existing['containment']->strength()
                    ? $row->containment
                    : $existing['containment'],
                'market_scopes' => $scopes,
            ];
        }

        return $effective;
    }

    /**
     * The version-level declaration: one row per allergen class, carrying the
     * strongest containment any line implies and the ingredient that implied
     * it.
     *
     * Provenance is not decoration. "Why does this dish say sesame" has to be
     * answerable from the label alone, and a chip that says "from tahini" is
     * the difference between a warning that is trusted and one that is clicked
     * past. Where two ingredients imply the same class at the same strength,
     * the earlier line wins — deterministic, and the ingredient a cook would
     * name first.
     *
     * @param  list<string>  $orderedIngredientIds  line order, duplicates allowed
     * @param  array<string, array<string, array{containment: AllergenContainment, market_scopes: list<string>}>>  $effective
     * @return list<array{allergen_code: string, containment: AllergenContainment, source_ingredient_id: string, market_scopes: list<string>}>
     */
    public function rollUp(array $orderedIngredientIds, array $effective): array
    {
        /** @var array<string, array{allergen_code: string, containment: AllergenContainment, source_ingredient_id: string, market_scopes: list<string>}> $rolled */
        $rolled = [];

        foreach ($orderedIngredientIds as $ingredientId) {
            foreach ($effective[$ingredientId] ?? [] as $code => $mapping) {
                $existing = $rolled[$code] ?? null;

                if ($existing === null) {
                    $rolled[$code] = [
                        'allergen_code' => $code,
                        'containment' => $mapping['containment'],
                        'source_ingredient_id' => $ingredientId,
                        'market_scopes' => $mapping['market_scopes'],
                    ];

                    continue;
                }

                $scopes = array_values(array_unique([...$existing['market_scopes'], ...$mapping['market_scopes']]));
                sort($scopes);

                $stronger = $mapping['containment']->strength() > $existing['containment']->strength();

                $rolled[$code] = [
                    'allergen_code' => $code,
                    'containment' => $stronger ? $mapping['containment'] : $existing['containment'],
                    'source_ingredient_id' => $stronger ? $ingredientId : $existing['source_ingredient_id'],
                    'market_scopes' => $scopes,
                ];
            }
        }

        ksort($rolled);

        return array_values($rolled);
    }
}
