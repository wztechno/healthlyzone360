<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Every recipe usable as an ingredient has a twin and says how much of it a batch makes — written
 * by the server, never by an outputs editor (plan slice F).
 *
 * A meal's line names an ingredient. A recipe becomes something a line can name, and something the
 * line can be costed from, through two facts:
 *
 * - **the twin** — the ingredient it is used as. A sauce or dressing has its listing's
 *   `ingredient_id`, asked through {@see RecipeUsageRegistry::twinIngredientId()}; a preparation,
 *   which nothing sells, has `recipes.twin_ingredient_id`, created with it;
 * - **the output row** — "a batch makes 2 kg of it", the version's yield stated as a
 *   `recipe_version_outputs` row. Publication claims the twin from that row
 *   ({@see RecipeOutputNutritionWriter}), and the claim is what
 *   {@see WeeklyRecipeCostingService::componentCost()} follows.
 *
 * The editor no longer has an outputs control, so without this a hand-made sauce had no output row,
 * no recipe-derived cost, and production refused its batch.
 *
 * ## A stated row is never touched
 *
 * Only a row written here (`follows_yield`) is rewritten when the yield changes. A version carrying
 * any other output row — the importer's, or one set through `PUT …/outputs` — states what it
 * produces, and that statement wins.
 */
final readonly class RecipeTwinOutputs
{
    /** The platform ingredient category a preparation's twin is filed under — added by migration. */
    public const string PREPARATION_CATEGORY = 'preparation';

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private RecipeUsageRegistry $usage,
        private IngredientCatalogueService $ingredients,
        private RecipeVersionReadiness $readiness,
        private RecipeNutritionService $nutrition,
        private RecipeOutputAllergenWriter $outputAllergens,
        private RecipeOutputNutritionWriter $outputNutrition,
    ) {}

    /**
     * The ingredient this recipe is used as: its own preparation twin, else its selling sauce's.
     */
    public function twinOf(Recipe $recipe): ?string
    {
        return $recipe->twin_ingredient_id ?? $this->usage->twinIngredientId($recipe);
    }

    /**
     * Give a preparation its own twin and link it — kilograms, the recipe's names, its handle, filed
     * under `preparation`. The same convention `CatalogueItemService::twinOf()` follows for a sauce.
     *
     * A recipe not yet saved takes the link as an attribute and its own save writes it; a saved one
     * is linked by a plain UPDATE that leaves `lock_version` alone, because the editor holding the
     * recipe changed nothing it can see.
     *
     * @throws ApiException
     */
    public function giveTwin(Recipe $recipe): Ingredient
    {
        $unitId = MeasurementUnit::query()->where('code', 'kg')->value('id');

        if (! is_string($unitId)) {
            throw new RuntimeException('The kilogram measurement unit is not seeded; seed reference data first.');
        }

        $category = IngredientCategory::withoutTenancy()
            ->whereNull('organisation_id')
            ->where('code', self::PREPARATION_CATEGORY)
            ->value('id');

        $twin = $this->ingredients->create([
            'name_en' => $recipe->name_en,
            'name_ar' => $recipe->name_ar,
            'slug' => $recipe->slug,
            'ingredient_category_id' => is_string($category) ? $category : null,
            'default_unit_id' => $unitId,
            'source_ref' => $recipe->source_ref,
        ]);

        $recipe->twin_ingredient_id = (string) $twin->getKey();

        if ($recipe->exists) {
            Recipe::withoutTenancy()->whereKey($recipe->getKey())->update(['twin_ingredient_id' => $recipe->twin_ingredient_id]);
            $recipe->syncOriginalAttribute('twin_ingredient_id');
        }

        return $twin;
    }

    /**
     * Every draft of this recipe follows its yield — what the catalogue calls once it has linked a
     * sauce or dressing to the recipe, so a yield saved before the item existed is stated now.
     */
    public function followYieldOf(Recipe $recipe): void
    {
        $twinId = $this->twinOf($recipe);

        $drafts = RecipeVersion::withoutTenancy()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', RecipeVersionStatus::Draft->value)
            ->get();

        foreach ($drafts as $draft) {
            $this->followYield($draft, $twinId);
        }
    }

    /**
     * Make a draft's single primary output row the twin at the yield, and say whether anything moved.
     *
     * Nothing happens on a version that is not a draft, on a recipe with no twin (or one archived),
     * or on a version carrying a row somebody stated. A yield cleared takes the server's row with
     * it: an output must state a quantity, and a stale one would cost the component from a batch
     * size the kitchen has withdrawn.
     *
     * `lock_version` does not move and the label is not marked stale. The row is derived from what
     * the editor just saved, not content of its own, and producing an ingredient changes nothing
     * about what this version is made of.
     *
     * @param  string|null  $twinId  already known to the caller; resolved from the recipe otherwise
     */
    public function followYield(RecipeVersion $version, ?string $twinId = null): bool
    {
        if ($version->status !== RecipeVersionStatus::Draft) {
            return false;
        }

        $outputs = RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $version->getKey())->get();

        if ($outputs->contains(static fn (RecipeVersionOutput $output): bool => ! $output->follows_yield)) {
            return false;
        }

        $quantity = $version->yield_quantity === null ? null : (string) $version->yield_quantity;
        $unitId = $version->yield_unit_id;

        if ($twinId === null) {
            $recipe = Recipe::withoutTenancy()->whereKey($version->recipe_id)->first();
            $twinId = $recipe instanceof Recipe ? $this->twinOf($recipe) : null;
        }

        $usable = $twinId !== null && Ingredient::withoutTenancy()
            ->whereKey($twinId)
            ->where('status', '!=', IngredientStatus::Archived->value)
            ->exists();

        if (! $usable || $unitId === null || $quantity === null || ! is_numeric($quantity) || bccomp($quantity, '0', 4) !== 1) {
            if ($outputs->isEmpty()) {
                return false;
            }

            RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $version->getKey())->delete();
            $this->recordOutput($version, 'cleared');

            return true;
        }

        $current = $outputs->first();

        if ($outputs->count() === 1
            && $current instanceof RecipeVersionOutput
            && $current->ingredient_id === $twinId
            && $current->unit_id === $unitId
            && bccomp((string) $current->output_quantity, $quantity, 4) === 0
        ) {
            return false;
        }

        DB::transaction(function () use ($version, $twinId, $quantity, $unitId): void {
            RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $version->getKey())->delete();
            $this->insertOutput($version, (string) $twinId, $quantity, $unitId);
        });

        $this->recordOutput($version, 'follows_yield');

        return true;
    }

    /**
     * State what a **published** version produces, for a version published before this rule existed
     * — `kitchen:ensure-recipe-outputs` only.
     *
     * ## Why the immutability guard is bypassed here
     *
     * A published version is frozen because its formulation and the label a diner was shown must
     * stay reconstructable. Neither moves: the lines, the yield and the frozen allergen label are
     * untouched. What is added is the missing sentence "a batch of this makes 2 kg of its twin" —
     * the yield the version already states, said about the ingredient it is already used as. Making
     * a new version to say it would put an unchanged formulation back through review.
     *
     * Then exactly what publication runs for outputs: the twin is claimed for allergens and
     * nutrition, which marks every formulation built on it stale and queues its recompute.
     *
     * @param  numeric-string  $quantity
     */
    public function stateOnPublished(RecipeVersion $version, string $twinId, string $quantity, string $unitId): void
    {
        DB::transaction(fn () => $this->insertOutput($version, $twinId, $quantity, $unitId));

        $this->outputAllergens->write($version);
        $this->outputNutrition->write($version, $this->nutrition->forVersion($version, $this->readiness->linesOf($version)));

        $this->recordOutput($version, 'published_backfill');
    }

    /**
     * @param  numeric-string  $quantity
     */
    private function insertOutput(RecipeVersion $version, string $twinId, string $quantity, string $unitId): void
    {
        $row = new RecipeVersionOutput;
        $row->recipe_version_id = (string) $version->getKey();
        $row->organisation_id = $version->organisation_id;
        $row->ingredient_id = $twinId;
        $row->output_quantity = $quantity;
        $row->unit_id = $unitId;
        $row->is_primary = true;
        $row->follows_yield = true;
        $row->save();
    }

    /**
     * The event `setOutputs()` records, with where the row came from. Counts only — the quantity is
     * confidential formulation detail.
     */
    private function recordOutput(RecipeVersion $version, string $origin): void
    {
        $this->audit->record(
            'catalogue.recipe_outputs_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'changed_fields' => ['outputs'],
                'output_count' => RecipeVersionOutput::withoutTenancy()->where('recipe_version_id', $version->getKey())->count(),
                'origin' => $origin,
                'lock_version' => $version->lock_version,
            ],
        );
    }
}
