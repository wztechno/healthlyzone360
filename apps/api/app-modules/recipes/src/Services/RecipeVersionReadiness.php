<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Services;

use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\IngredientVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Illuminate\Database\Eloquent\Collection;

/**
 * Why a recipe version is not ready to be published — as a list, computed, and
 * never stored.
 *
 * K1.2 evaluated these gates inside `publish()`, which meant the only way to
 * discover them was to attempt a publication and read the refusal. That is a
 * poor answer for a review queue: a screen that wants to show "three of these
 * eleven versions are ready" cannot publish eleven versions to find out. So
 * K1.8 lifts the gates out — **the same gates**, not a second opinion about
 * them. `publish()` now asks this service and throws from what it returns, and
 * `GET …/readiness` asks this service and serialises what it returns. Two
 * implementations of a food-safety gate would eventually disagree, and the
 * disagreement would be discovered by a diner.
 *
 * **The allergen gate keeps its own error code on the publish path.** An
 * ingredient nobody has assessed is fixed in the ingredient's mapping editor
 * rather than in the recipe, which is why publication raises
 * `catalogue.allergen_unmapped` rather than folding it into
 * `catalogue.publish_blocked`. The evaluator has no such distinction to make —
 * it is asked "why not", and this is one more answer — so it reports it as an
 * ordinary reason with the ingredients named in its context.
 *
 * Each reason is `{code, detail, context}`: a stable machine key, a sentence a
 * human can act on, and whatever identifies the offending rows. The context is
 * a nested object rather than sibling keys so that adding a reason with new
 * structure never changes the shape of the reason itself.
 */
final readonly class RecipeVersionReadiness
{
    public function __construct(private AllergenRollupService $rollup) {}

    /**
     * Every reason this version cannot be published, in the order a kitchen
     * would work through them: what state it is in, what it is missing, what it
     * is built from, and what nobody has assessed.
     *
     * An empty list means publishable — as of this instant, and evaluated
     * against the same data `publish()` will re-read a moment later. There is
     * deliberately no stored flag to fall out of step.
     *
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    public function reasons(RecipeVersion $version): array
    {
        $lines = $this->linesOf($version);
        $reasons = $this->structuralReasons($version, $lines);

        /** @var list<string> $orderedIngredientIds */
        $orderedIngredientIds = $lines->pluck('ingredient_id')->map(static fn (mixed $id): string => (string) $id)->all();

        $effective = $this->rollup->effectiveFor(array_values(array_unique($orderedIngredientIds)), $version->organisation_id);
        $undetermined = $this->undeterminedIngredientIds($orderedIngredientIds, $effective);

        if ($undetermined !== []) {
            $reasons[] = [
                'code' => 'allergen_unmapped',
                'detail' => 'At least one ingredient carries no allergen determination at all. An ingredient nobody has assessed is not an ingredient assessed and found clear, and only the second may reach a plate.',
                'context' => ['ingredient_ids' => $undetermined],
            ];
        }

        return $reasons;
    }

    /**
     * The gates that can be answered from the version and its lines alone —
     * everything except the allergen determination, which needs the effective
     * mappings and which publication raises under its own error code.
     *
     * Every check runs even when an earlier one has already failed. A version
     * missing its quantities *and* built on a quarantined ingredient should
     * learn both facts in one attempt rather than five.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    public function structuralReasons(RecipeVersion $version, Collection $lines): array
    {
        $reasons = [];

        if ($version->status === RecipeVersionStatus::ReviewRequired) {
            $reasons[] = [
                'code' => 'version_quarantined',
                'detail' => 'This version is quarantined for review. A quarantine is an unresolved food-safety contradiction on the formulation, and it blocks publication structurally until a human settles it.',
                'context' => ['review_reason' => $version->review_reason],
            ];
        } elseif ($version->status !== RecipeVersionStatus::Draft) {
            $reasons[] = [
                'code' => 'version_not_a_draft',
                'detail' => 'Only a draft version can be published. A published or retired version is frozen, and a change to it is a new draft version.',
                'context' => ['status' => $version->status->value],
            ];
        }

        if ($lines->isEmpty()) {
            $reasons[] = [
                'code' => 'no_lines',
                'detail' => 'A version with no lines is a name rather than a formulation.',
                'context' => [],
            ];
        }

        $unquantified = $lines
            ->filter(static fn (RecipeVersionLine $line): bool => $line->quantity === null || $line->unit_id === null)
            ->map(static fn (RecipeVersionLine $line): int => $line->line_number)
            ->values()
            ->all();

        if ($unquantified !== []) {
            $reasons[] = [
                'code' => 'line_quantity_missing',
                'detail' => 'Some lines state neither a quantity nor a unit, and a formulation that does not say how much cannot be made twice the same way.',
                'context' => ['line_numbers' => $unquantified],
            ];
        }

        /** @var list<string> $ingredientIds */
        $ingredientIds = $lines->pluck('ingredient_id')->map(static fn (mixed $id): string => (string) $id)->unique()->values()->all();

        if ($ingredientIds !== []) {
            $quarantined = Ingredient::withoutTenancy()
                ->whereIn('id', $ingredientIds)
                ->where('verification_status', IngredientVerificationStatus::RequiresReview->value)
                ->orderBy('id')
                ->pluck('id')
                ->map(static fn (mixed $id): string => (string) $id)
                ->all();

            if ($quarantined !== []) {
                $reasons[] = [
                    'code' => 'ingredient_requires_review',
                    'detail' => 'At least one line ingredient is marked for review. Publishing a formulation over an unresolved allergen contradiction is exactly what the review state exists to prevent.',
                    'context' => ['ingredient_ids' => $quarantined],
                ];
            }
        }

        return $reasons;
    }

    /**
     * The line ingredients nobody has assessed.
     *
     * An ingredient passes when it has at least one mapping row in any layer,
     * or when it is `verified` — which is how "somebody checked, and it
     * carries nothing" is recorded. An ingredient with neither has simply not
     * been assessed, and that is not the same as being clear.
     *
     * @param  list<string>  $ingredientIds
     * @param  array<string, array<string, array{containment: AllergenContainment, market_scopes: list<string>}>>  $effective
     * @return list<string>
     */
    public function undeterminedIngredientIds(array $ingredientIds, array $effective): array
    {
        $candidates = array_values(array_unique(array_filter(
            $ingredientIds,
            static fn (string $id): bool => ($effective[$id] ?? []) === [],
        )));

        if ($candidates === []) {
            return [];
        }

        $verified = Ingredient::withoutTenancy()
            ->whereIn('id', $candidates)
            ->where('verification_status', IngredientVerificationStatus::Verified->value)
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        $undetermined = array_values(array_diff($candidates, $verified));
        sort($undetermined);

        return $undetermined;
    }

    /**
     * @return Collection<int, RecipeVersionLine>
     */
    public function linesOf(RecipeVersion $version): Collection
    {
        /** @var Collection<int, RecipeVersionLine> */
        return RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('line_number')
            ->get();
    }
}
