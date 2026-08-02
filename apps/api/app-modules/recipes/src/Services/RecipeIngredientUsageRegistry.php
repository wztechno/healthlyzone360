<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Jobs\RecomputeRecipeDerivations;
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
     * One UPDATE, then one job per version marked.
     *
     * The marking is synchronous because a label whose basis has moved must not
     * look current for even one read. The recompute is queued because it
     * re-derives a food-safety conclusion, can quarantine a published version
     * and can pull a listing off sale — none of which belongs inside the
     * mapping editor's request, and all of which would make an allergen edit
     * take as long as the largest recipe using the ingredient.
     *
     * **Every version marked is dispatched, including one already `stale`.**
     * The `derivation_state` filter is on the UPDATE only, so a second mapping
     * edit before the first recompute lands still schedules the work; the job's
     * `ShouldBeUnique` key collapses the duplicates rather than this query
     * pretending there was nothing to do.
     *
     * Scoped to the active organisation, which is also all the row-level
     * security policy on `recipe_versions` would permit. A platform-baseline
     * change legitimately affects every tenant, and the fan-out across them is
     * driven by `dependentOrganisationIds()` with a restored context per
     * organisation. Marking what this caller owns is honest; claiming to have
     * marked the rest would not be.
     *
     * @return list<string>
     */
    public function markDependentDerivationsStale(Ingredient $ingredient): array
    {
        if (! $this->context->hasOrganisation()) {
            return [];
        }

        $organisationId = (string) $this->context->organisationId();

        /** @var list<string> $versionIds */
        $versionIds = RecipeVersion::query()
            ->where('status', RecipeVersionStatus::Published->value)
            ->whereIn('id', RecipeVersionLine::query()
                ->where('ingredient_id', $ingredient->getKey())
                ->select('recipe_version_id'))
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        if ($versionIds === []) {
            return [];
        }

        RecipeVersion::query()
            ->whereIn('id', $versionIds)
            ->where('derivation_state', '!=', DerivationState::Stale->value)
            ->update([
                'derivation_state' => DerivationState::Stale->value,
                'updated_at' => now(),
            ]);

        foreach ($versionIds as $versionId) {
            RecomputeRecipeDerivations::dispatch($versionId, $organisationId);
        }

        return $versionIds;
    }

    /**
     * Read across tenants, which is exactly what `withoutTenancy()` is for and
     * exactly why every call site of it is a decision.
     *
     * The caller is a platform operator rewriting a baseline that every kitchen
     * inherits. Refusing to look outside their own context would mean the
     * correction reached the reference data and never reached the labels
     * derived from it — the documented K1.2 gap. What is *not* done here is any
     * writing: this returns organisation identifiers, and the marking happens
     * inside each organisation's restored context so that the row-level
     * security policies see the tenant they are protecting.
     *
     * Non-retired rather than published-only, because a draft version's stale
     * label is still worth recomputing before somebody tries to publish it, and
     * the organisation list is the same either way in every case that matters.
     *
     * @return list<string>
     */
    public function dependentOrganisationIds(Ingredient $ingredient): array
    {
        /** @var list<string> */
        return array_values(RecipeVersion::withoutTenancy()
            ->where('status', '!=', RecipeVersionStatus::Retired->value)
            ->whereIn('id', RecipeVersionLine::withoutTenancy()
                ->where('ingredient_id', $ingredient->getKey())
                ->select('recipe_version_id'))
            ->orderBy('organisation_id')
            ->pluck('organisation_id')
            ->unique()
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }
}
