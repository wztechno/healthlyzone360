<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * A placeholder recipe `kitchen:formulate-unlinked` wrote that **nobody has
 * touched since** — the only recipe a batch job may delete or swap out.
 *
 * A stub is untouched, or it is not a stub. Every clause below is a way a
 * person could have made it theirs, and any one of them is enough to keep it:
 *
 * - `source_system = catalogue_backfill` — the backfill wrote it; a recipe
 *   somebody created by hand never carries it, because the HTTP request cannot
 *   set provenance.
 * - `recipes.lock_version = 0` — every recipe-level edit (the names, the notes,
 *   the category, the confidentiality, an archive) goes through the
 *   compare-and-swap and bumps it.
 * - **exactly one version**, a `draft` at `lock_version = 0` — a second
 *   version, a version edit or a publication each move one of those.
 * - **no content and no history** — no lines, packaging, outputs, steps,
 *   allergen rows or cost snapshots, and no production order or production line
 *   naming the version. The lock versions already catch every edit made through
 *   the API; these catch the writes that bypass it (an importer, a relink), and
 *   the production references are also the two `RESTRICT` keys a delete would
 *   trip over.
 *
 * Shared by `kitchen:formulate-unlinked --undo`, which deletes a stub, and by
 * `kitchen:import-v6-recipes`, which swaps a stub for the sheet that describes
 * the same dish. Nothing a person wrote is deleted or archived by either.
 */
final class BackfillStub
{
    /** What `kitchen:formulate-unlinked` stamps on every recipe it writes. */
    public const string SOURCE_SYSTEM = 'catalogue_backfill';

    /**
     * The tables whose rows would make a version somebody's work, each with the
     * column naming the version.
     *
     * @var array<string, string>
     */
    private const array VERSION_REFERENCES = [
        'recipe_version_lines' => 'recipe_version_id',
        'recipe_version_packaging' => 'recipe_version_id',
        'recipe_version_outputs' => 'recipe_version_id',
        'recipe_version_steps' => 'recipe_version_id',
        'recipe_version_allergens' => 'recipe_version_id',
        'recipe_cost_snapshots' => 'recipe_version_id',
        'production_orders' => 'recipe_version_id',
        'production_order_lines' => 'source_recipe_version_id',
    ];

    /**
     * @return Builder<Recipe>
     */
    public static function query(string $organisationId): Builder
    {
        $query = Recipe::withoutTenancy()
            ->where('recipes.organisation_id', $organisationId)
            ->where('recipes.source_system', self::SOURCE_SYSTEM)
            ->where('recipes.lock_version', 0)
            ->whereRaw('(select count(*) from recipe_versions as any_version where any_version.recipe_id = recipes.id) = 1')
            ->whereExists(function (QueryBuilder $sub): void {
                $sub->selectRaw('1')
                    ->from('recipe_versions as stub_version')
                    ->whereColumn('stub_version.recipe_id', 'recipes.id')
                    ->where('stub_version.status', RecipeVersionStatus::Draft->value)
                    ->where('stub_version.lock_version', 0);
            });

        foreach (self::VERSION_REFERENCES as $table => $column) {
            $query->whereNotExists(function (QueryBuilder $sub) use ($table, $column): void {
                $sub->selectRaw('1')
                    ->from($table)
                    ->join('recipe_versions as held_version', 'held_version.id', '=', $table.'.'.$column)
                    ->whereColumn('held_version.recipe_id', 'recipes.id');
            });
        }

        return $query;
    }
}
