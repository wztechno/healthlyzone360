<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Console;

use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Services\AllergenRollupService;
use Healthy360\Recipes\Services\RecipeLabelWriter;
use Healthy360\Recipes\Services\RecipeOutputAllergenWriter;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Carry every published sub-recipe's allergens onto the ingredient it produces
 * — the backfill for versions published before `RecipeOutputAllergenWriter`
 * existed (T3).
 *
 * **Run `--dry-run` first.** It does the same writes inside a transaction it
 * rolls back, re-derives each published dish built on those outputs in the
 * same transaction, and lists the ones whose label would move — the dishes the
 * live run sends to review. Nothing is committed and nothing is queued.
 *
 * The live run writes through the publish path's own call, so a moved row marks
 * its dishes stale and queues their recompute, which quarantines the ones whose
 * label changed.
 *
 * ponytail: the dry run lists one hop (sauce → dish). A dish whose label moves
 * because a sauce two levels down moved is found by the live run's recompute
 * walk, not listed here; run the dry run again after the live run settles if
 * that matters.
 *
 * **Platform outputs are listed, not carried.** A recipe that names a
 * platform-library ingredient as its output writes nothing onto it (the row is
 * every kitchen's); both modes list those as "not carried: platform
 * ingredient" until the owner decides what they should do.
 *
 * Every organisation, each inside its own tenant context: `recipe_versions` is
 * row-level secured and the stale marking reads the application context.
 */
final class CarryRecipeAllergensCommand extends Command
{
    protected $signature = 'recipes:carry-allergens
        {--dry-run : List the dishes that would go to review, and write nothing}';

    protected $description = 'Write each published sub-recipe\'s allergens onto the ingredient it produces.';

    public function handle(
        DatabaseTenantContext $database,
        TenantContext $context,
        RecipeOutputAllergenWriter $writer,
        AllergenRollupService $rollup,
        RecipeLabelWriter $labels,
    ): int {
        $dryRun = (bool) $this->option('dry-run');
        $ambient = $context->toArray();
        $moved = 0;

        /** @var list<list<string>> $dishes */
        $dishes = [];

        /** @var list<list<string>> $skipped */
        $skipped = [];

        try {
            foreach (Organisation::query()->orderBy('id')->pluck('slug', 'id') as $organisationId => $slug) {
                $organisationId = (string) $organisationId;

                $database->during(null, $organisationId, null, function () use (
                    $context, $writer, $rollup, $labels, $dryRun, $organisationId, $slug, &$moved, &$dishes, &$skipped,
                ): void {
                    $context->restore(['user_id' => null, 'organisation_id' => $organisationId, 'branch_id' => null]);

                    $producers = RecipeVersion::withoutTenancy()
                        ->where('organisation_id', $organisationId)
                        ->where('status', RecipeVersionStatus::Published->value)
                        ->whereIn('id', RecipeVersionOutput::withoutTenancy()->select('recipe_version_id'))
                        ->orderBy('id')
                        ->get();

                    if ($producers->isEmpty()) {
                        return;
                    }

                    foreach ($this->platformOutputs($producers->all()) as [$recipe, $ingredient]) {
                        $skipped[] = [(string) $slug, $recipe, $ingredient, 'not carried: platform ingredient'];
                    }

                    if (! $dryRun) {
                        foreach ($producers as $producer) {
                            $moved += $writer->write($producer);
                        }

                        return;
                    }

                    DB::beginTransaction();

                    try {
                        foreach ($producers as $producer) {
                            $moved += $writer->write($producer, scheduleDependants: false);
                        }

                        foreach ($this->dishesThatMove($organisationId, $producers->modelKeys(), $rollup, $labels) as [$dish, $reason]) {
                            $dishes[] = [(string) $slug, $dish, $reason];
                        }
                    } finally {
                        DB::rollBack();
                    }
                });
            }
        } finally {
            $context->restore($ambient);
        }

        if ($skipped !== []) {
            $this->table(['Organisation', 'Recipe', 'Output', 'Outcome'], $skipped);
        }

        if ($dryRun) {
            if ($dishes !== []) {
                $this->table(['Organisation', 'Dish', 'Label change'], $dishes);
            }

            $this->line(sprintf('Dry run: %d output ingredient(s) would change; %d dish(es) would go to review. Nothing was written.', $moved, count($dishes)));

            return self::SUCCESS;
        }

        $this->line(sprintf('%d output ingredient(s) changed; their dishes are queued for recompute.', $moved));

        return self::SUCCESS;
    }

    /**
     * The platform-library ingredients these producers name as outputs, which
     * the writer leaves alone.
     *
     * @param  list<RecipeVersion>  $producers
     * @return list<array{0: string, 1: string}>
     */
    private function platformOutputs(array $producers): array
    {
        $listed = [];

        foreach ($producers as $producer) {
            $names = Ingredient::withoutTenancy()
                ->whereNull('organisation_id')
                ->whereIn('id', RecipeVersionOutput::withoutTenancy()
                    ->where('recipe_version_id', $producer->getKey())
                    ->select('ingredient_id'))
                ->orderBy('name_en')
                ->pluck('name_en');

            foreach ($names as $name) {
                $listed[] = [$this->versionName($producer), (string) $name];
            }
        }

        return $listed;
    }

    private function versionName(RecipeVersion $version): string
    {
        $name = Recipe::withoutTenancy()->whereKey($version->recipe_id)->value('name_en');

        return sprintf('%s (v%d)', is_string($name) ? $name : $version->recipe_id, $version->version_number);
    }

    /**
     * Re-freeze each published dish built on these producers' outputs and name
     * the ones whose label moved. Called inside the dry run's transaction, which
     * rolls the re-freeze back with everything else.
     *
     * @param  list<mixed>  $producerIds
     * @return list<array{0: string, 1: string}>
     */
    private function dishesThatMove(string $organisationId, array $producerIds, AllergenRollupService $rollup, RecipeLabelWriter $labels): array
    {
        $dependents = RecipeVersion::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', RecipeVersionStatus::Published->value)
            ->whereIn('id', RecipeVersionLine::withoutTenancy()
                ->whereIn('ingredient_id', RecipeVersionOutput::withoutTenancy()
                    ->whereIn('recipe_version_id', $producerIds)
                    ->select('ingredient_id'))
                ->select('recipe_version_id'))
            ->orderBy('id')
            ->get();

        $moving = [];

        foreach ($dependents as $dependent) {
            /** @var list<string> $ingredientIds */
            $ingredientIds = RecipeVersionLine::withoutTenancy()
                ->where('recipe_version_id', $dependent->getKey())
                ->orderBy('line_number')
                ->pluck('ingredient_id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

            $before = $labels->snapshot($dependent);
            $labels->freeze($dependent, $rollup->rollUp($ingredientIds, $rollup->effectiveFor(array_values(array_unique($ingredientIds)), $organisationId)), now());
            $diff = $labels->diff($before, $labels->snapshot($dependent));

            if ($labels->isMaterial($diff)) {
                $moving[] = [$this->versionName($dependent), $labels->describe($diff)];
            }
        }

        return $moving;
    }
}
