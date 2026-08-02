<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Tenancy\TenantContext;

/**
 * The recipes module's answer to the ingredients module's questions
 * (`IngredientUsageRegistry`).
 *
 * Bound by `RecipesServiceProvider`, replacing the null implementation. The
 * direction of the dependency is the point: ingredients asks, recipes answers,
 * and the module graph stays Recipes → Ingredients with no cycle.
 */
final readonly class RecipeIngredientUsageRegistry implements IngredientUsageRegistry
{
    public function __construct(private TenantContext $context) {}

    /**
     * Live references: any non-retired version that names this ingredient on a
     * line or as an output.
     *
     * Retired versions are excluded deliberately. History is allowed to point
     * at an archived ingredient — that is what makes an old label
     * reconstructable — and treating it as a live reference would mean a
     * kitchen could never retire an ingredient it once used.
     *
     * `catalogue_item_ids` is always empty here: this module knows nothing
     * about catalogues, and the catalogues module decorates this
     * implementation to fill it in (K1.4).
     *
     * @return array{recipe_ids: list<string>, recipe_version_ids: list<string>, catalogue_item_ids: list<string>}
     */
    public function activeReferences(Ingredient $ingredient): array
    {
        if (! $this->context->hasOrganisation()) {
            return ['recipe_ids' => [], 'recipe_version_ids' => [], 'catalogue_item_ids' => []];
        }

        $versions = RecipeVersion::query()
            ->where('status', '!=', RecipeVersionStatus::Retired->value)
            ->where(function ($query) use ($ingredient): void {
                $query->whereIn('id', RecipeVersionLine::query()
                    ->where('ingredient_id', $ingredient->getKey())
                    ->select('recipe_version_id'))
                    ->orWhereIn('id', RecipeVersionOutput::query()
                        ->where('ingredient_id', $ingredient->getKey())
                        ->select('recipe_version_id'));
            })
            ->orderBy('recipe_id')
            ->orderBy('version_number')
            ->get(['id', 'recipe_id']);

        return [
            'recipe_ids' => array_values($versions->pluck('recipe_id')->unique()->map(static fn (mixed $id): string => (string) $id)->all()),
            'recipe_version_ids' => array_values($versions->pluck('id')->map(static fn (mixed $id): string => (string) $id)->all()),
            'catalogue_item_ids' => [],
        ];
    }

    /**
     * One UPDATE. The reactive recompute — and the quarantine it can raise
     * when a changed mapping contradicts a published label — is the **K1.8**
     * allergen-recompute job, not this call. Recomputing here would make an
     * allergen edit take as long as the largest recipe that uses the
     * ingredient and would run the food-safety derivation inside the mapping
     * editor's transaction.
     *
     * Scoped to the active organisation, which is also all the row-level
     * security policy on `recipe_versions` would permit: a platform-baseline
     * change legitimately affects every tenant, and fanning that out is the
     * K1.8 job's business precisely because it can restore a tenant context
     * per organisation. Marking what this caller owns is honest; claiming to
     * have marked the rest would not be.
     */
    public function markDependentDerivationsStale(Ingredient $ingredient): int
    {
        if (! $this->context->hasOrganisation()) {
            return 0;
        }

        return RecipeVersion::query()
            ->where('status', RecipeVersionStatus::Published->value)
            ->where('derivation_state', '!=', DerivationState::Stale->value)
            ->whereIn('id', RecipeVersionLine::query()
                ->where('ingredient_id', $ingredient->getKey())
                ->select('recipe_version_id'))
            ->update([
                'derivation_state' => DerivationState::Stale->value,
                'updated_at' => now(),
            ]);
    }
}
