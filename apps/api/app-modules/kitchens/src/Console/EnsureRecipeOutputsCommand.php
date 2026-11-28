<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Enums\RecipeStatus;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Services\RecipeTwinOutputs;
use Illuminate\Console\Command;

/**
 * Give every recipe usable as an ingredient what the editor now writes by itself: a twin, and an
 * output row stating its yield (plan slice F).
 *
 * The editor lost its outputs control, so a sauce made by hand has no output row — no cost from its
 * own recipe inside a meal, and production refuses its batch — and a preparation made before this
 * slice has no twin at all, so no line can name it. {@see RecipeTwinOutputs} now writes both as a
 * recipe is edited; this is the same for what already exists.
 *
 * For each active recipe with a twin — its sauce or dressing's `ingredient_id`, or a preparation's
 * own — each draft and published version with a yield and no output row gets one. A draft goes
 * through the service. A published version is frozen and `setOutputs()` refuses it, so the row is
 * inserted directly and the twin is then claimed exactly as publication claims it — see
 * {@see RecipeTwinOutputs::stateOnPublished()} for why that is not an edit to the formulation.
 *
 * A recipe nothing sells and with no twin is an old preparation: `--dry-run` names it "needs a
 * twin", and a live run gives it one. A recipe sold only as a meal makes nothing a line can name
 * and is passed over. A version that already states an output — the importer's, or anybody's — is
 * never touched.
 *
 * `--dry-run` writes nothing and prints what it would do with a closing count. Idempotent: a second
 * run finds every twin linked and every row written.
 */
final class EnsureRecipeOutputsCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:ensure-recipe-outputs
        {--org= : The kitchen organisation slug (defaults to the configured one)}
        {--dry-run : Report what would be written, and write nothing}';

    protected $description = 'Give every recipe usable as an ingredient its twin and an output row stating its yield.';

    public function handle(RecipeTwinOutputs $twins, RecipeUsageRegistry $usage): int
    {
        $dryRun = (bool) $this->option('dry-run');

        if (! $dryRun && $this->refusesThisEnvironment('kitchen:ensure-recipe-outputs')) {
            return self::FAILURE;
        }

        $kitchen = $this->resolveOrganisation();

        if (! $kitchen instanceof Organisation) {
            return self::FAILURE;
        }

        $this->components->info(sprintf(
            'Ensure recipe outputs — mode: %s · organisation: %s',
            $dryRun ? 'dry-run' : 'live',
            $kitchen->slug,
        ));

        $this->insideOrganisation($kitchen, function (string $organisationId) use ($twins, $usage, $dryRun): void {
            $twinsGiven = 0;
            $written = 0;
            $withoutYield = 0;

            $recipes = Recipe::withoutTenancy()
                ->where('organisation_id', $organisationId)
                ->where('status', RecipeStatus::Active->value)
                ->orderBy('name_en')
                ->orderBy('id')
                ->get();

            $sellers = $usage->sellersByRecipe(array_values($recipes->map(static fn (Recipe $recipe): string => (string) $recipe->getKey())->all()));

            foreach ($recipes as $recipe) {
                $twinId = $twins->twinOf($recipe);

                if ($twinId === null) {
                    // Sold, but not as something a line can name — a meal.
                    if (isset($sellers[(string) $recipe->getKey()])) {
                        continue;
                    }

                    $this->components->twoColumnDetail($recipe->name_en, $dryRun ? 'needs a twin' : 'twin created');
                    $twinsGiven++;

                    if (! $dryRun) {
                        $twinId = (string) $twins->giveTwin($recipe)->getKey();
                    }
                }

                $versions = RecipeVersion::withoutTenancy()
                    ->where('recipe_id', $recipe->getKey())
                    ->whereIn('status', [RecipeVersionStatus::Draft->value, RecipeVersionStatus::Published->value])
                    ->whereNotExists(static function ($query): void {
                        $query->selectRaw('1')
                            ->from('recipe_version_outputs')
                            ->whereColumn('recipe_version_outputs.recipe_version_id', 'recipe_versions.id');
                    })
                    ->orderBy('version_number')
                    ->get();

                foreach ($versions as $version) {
                    $title = sprintf('%s v%d (%s)', $recipe->name_en, $version->version_number, $version->status->value);
                    $quantity = $version->yield_quantity === null ? null : (string) $version->yield_quantity;
                    $unitId = $version->yield_unit_id;

                    if ($quantity === null || $unitId === null || ! is_numeric($quantity) || bccomp($quantity, '0', 4) !== 1) {
                        $this->components->twoColumnDetail($title, 'no yield — skipped');
                        $withoutYield++;

                        continue;
                    }

                    $this->components->twoColumnDetail($title, $dryRun ? 'would write output' : 'output written');
                    $written++;

                    if ($dryRun || $twinId === null) {
                        continue;
                    }

                    if ($version->status === RecipeVersionStatus::Published) {
                        $twins->stateOnPublished($version, $twinId, $quantity, $unitId);
                    } else {
                        $twins->followYield($version, $twinId);
                    }
                }
            }

            // A plain line, so the closing count is never wrapped mid-sentence.
            $this->line('');
            $this->line(sprintf(
                $dryRun
                    ? 'Dry run: %d twin(s) would be created, %d output row(s) would be written, %d version(s) have no yield.'
                    : '%d twin(s) created, %d output row(s) written, %d version(s) have no yield.',
                $twinsGiven,
                $written,
                $withoutYield,
            ));
        });

        return self::SUCCESS;
    }
}
