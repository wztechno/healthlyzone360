<?php

declare(strict_types=1);

namespace Healthy360\Recipes\Jobs;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Enums\CostBasis;
use Healthy360\Recipes\Enums\DerivationState;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Recipes\Models\RecipeVersionLine;
use Healthy360\Recipes\Models\RecipeVersionOutput;
use Healthy360\Recipes\Services\AllergenRollupService;
use Healthy360\Recipes\Services\RecipeCostingService;
use Healthy360\Recipes\Services\RecipeLabelWriter;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Re-derive one recipe version's allergen label, its derivation fingerprint and
 * its cost — and quarantine it if the label a diner was promised has moved.
 *
 * This closes the gap K1.2 and K1.4 both documented and deferred. Until now a
 * mapping change *marked* dependent labels stale and stopped there, which is
 * honest but incomplete: a label that says `stale` still says sesame, and the
 * kitchen only found out it now says peanut when somebody happened to publish a
 * new version.
 *
 * **Quarantine is a safety event, not bookkeeping** (master plan v2 §4.7,
 * appendix C). If the version is `published` and the recomputed label differs
 * in any direction — a class appeared, a class went away, a containment
 * strengthened, a containment weakened — the version moves to
 * `review_required` with a reason naming the delta, and every published
 * catalogue item selling that recipe moves with it. A quarantine that stopped
 * at the recipe would leave the listing in front of the customer unchanged,
 * which is the only place the promise is actually made.
 *
 * **Only a published label quarantines.** A draft, a version already in review
 * and a retired one are all recomputed and none of them quarantines: a draft is
 * somebody's work in progress, a version already in review is already where the
 * quarantine would put it, and a retired one is history. Only a published label
 * is a promise to a diner, and only a promise can be broken.
 *
 * **Uniqueness and overlap.** `ShouldBeUnique` is keyed on the recipe version,
 * so ten mapping edits in a minute collapse into one pending recompute per
 * version rather than ten. That gives the effect `WithoutOverlapping` would
 * give here — no two workers deriving the same label at once — with the
 * duplicate-suppression a burst of edits actually needs; `WithoutOverlapping`
 * alone would queue every copy and run them one after another, each recomputing
 * the same answer. `$uniqueFor` bounds the lock so a worker killed mid-run
 * cannot make a version permanently un-recomputable.
 *
 * **Transitive, with two guards.** A version that *outputs* an ingredient other
 * versions consume propagates: those versions' labels are derived from a
 * mapping set this recompute may have just changed the meaning of. The walk is
 * capped at {@see self::MAX_DEPTH} hops and carries the versions already
 * visited, and both are needed. The visited set stops a cycle — two components
 * that produce what the other consumes are a legitimate formulation and an
 * infinite recursion — while the depth cap stops a long chain from turning one
 * mapping edit into a queue-flooding cascade. Hitting the cap is logged rather
 * than swallowed: a chain that deep is a data-model observation somebody should
 * see, not an invisible truncation of a food-safety recompute.
 *
 * **Tenancy is re-established, not inherited.** The job may run in a worker with
 * no request behind it, so it restores both the database session variables the
 * row-level security policies read and the application-layer context the
 * services read. Doing one and not the other is how a query silently returns
 * nothing: the policies fail closed.
 */
final class RecomputeRecipeDerivations implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    /**
     * How far the output → line chain is followed before the walk stops and
     * says so. Five is not a measurement; it is a number comfortably above the
     * deepest component chain a kitchen has (sauce → dressing → salad → bowl)
     * and comfortably below anything that could flood a queue.
     */
    public const int MAX_DEPTH = 5;

    /**
     * The uniqueness lock's lifetime, in seconds. Long enough that a burst of
     * mapping edits collapses into one recompute; short enough that a worker
     * lost mid-run leaves the version recomputable again within five minutes
     * rather than until somebody clears a cache by hand.
     */
    public int $uniqueFor = 300;

    /**
     * @param  list<string>  $visited  the versions already recomputed on this
     *                                 chain, which is what makes a cycle
     *                                 terminate rather than recurse
     */
    public function __construct(
        public string $recipeVersionId,
        public string $organisationId,
        public int $depth = 0,
        public array $visited = [],
    ) {
        $this->onQueue('default');
    }

    /**
     * The version, so that two edits to the same formulation collapse. Not the
     * organisation: two organisations' versions are different rows and must
     * never wait for each other.
     */
    public function uniqueId(): string
    {
        return $this->recipeVersionId;
    }

    public function handle(
        DatabaseTenantContext $database,
        TenantContext $context,
        AllergenRollupService $rollup,
        RecipeLabelWriter $labels,
        RecipeCostingService $costing,
        RecipeUsageRegistry $usage,
        AuditRecorder $audit,
    ): void {
        $ambient = $context->toArray();

        try {
            $database->during(null, $this->organisationId, null, function () use (
                $context,
                $rollup,
                $labels,
                $costing,
                $usage,
                $audit,
            ): void {
                $context->restore(['user_id' => null, 'organisation_id' => $this->organisationId, 'branch_id' => null]);

                $this->recompute($rollup, $labels, $costing, $usage, $audit);
            });
        } finally {
            $context->restore($ambient);
        }
    }

    /**
     * One version, start to finish, with the tenant context already in place.
     */
    private function recompute(
        AllergenRollupService $rollup,
        RecipeLabelWriter $labels,
        RecipeCostingService $costing,
        RecipeUsageRegistry $usage,
        AuditRecorder $audit,
    ): void {
        $version = RecipeVersion::withoutTenancy()->whereKey($this->recipeVersionId)->first();

        // A version deleted, or dispatched against the wrong organisation, is
        // not an error worth retrying: the work has no subject. Failing loudly
        // here would put a job in the failed table that no operator can act on.
        if (! $version instanceof RecipeVersion || $version->organisation_id !== $this->organisationId) {
            return;
        }

        $lines = RecipeVersionLine::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->orderBy('line_number')
            ->get();

        /** @var list<string> $orderedIngredientIds */
        $orderedIngredientIds = $lines->pluck('ingredient_id')->map(static fn (mixed $id): string => (string) $id)->all();

        $effective = $rollup->effectiveFor(array_values(array_unique($orderedIngredientIds)), $version->organisation_id);
        $rolled = $rollup->rollUp($orderedIngredientIds, $effective);

        // Captured before anything is written: the diff is between what a diner
        // was promised and what the mappings now imply, and once the label is
        // rewritten the promise is unrecoverable.
        $before = $labels->snapshot($version);

        $hash = $labels->derivationHash($lines, $effective);
        $now = now();

        DB::transaction(function () use ($version, $labels, $rolled, $hash, $now): void {
            $labels->freeze($version, $rolled, $now);

            // `lock_version` deliberately does not move. Every gate this
            // recompute arms is structural — a `review_required` version is
            // refused publication whatever validator the caller holds — so
            // bumping the validator would buy no safety and would turn every
            // open editor's next save into a spurious 409 for a change they did
            // not make and cannot see.
            RecipeVersion::withoutTenancy()
                ->whereKey($version->getKey())
                ->update([
                    'derivation_state' => DerivationState::Current->value,
                    'derived_at' => $now,
                    'derived_input_hash' => $hash,
                    'updated_at' => $now,
                ]);
        });

        $version->refresh();

        $this->writeCostSnapshot($version, $costing, $lines);

        $diff = $labels->diff($before, $labels->snapshot($version));

        if ($labels->isMaterial($diff)) {
            $this->quarantine($version, $labels, $usage, $audit, $diff);
        }

        $this->propagate($version);
    }

    /**
     * A recalculated snapshot, when — and only when — every line is costed.
     *
     * Append-only and never blocking. Cost is commercial and the label is
     * food-safety, so a recompute that could not price the formulation still
     * writes the label and simply records no snapshot;
     * `costingForPublication()` is the method that cannot throw, and that is
     * why it is the one used here.
     *
     * A snapshot is appended on every recompute of a fully costed version, even
     * when the figures are identical to the last one. That is a deliberate
     * trade against ledger volume: the snapshot's value is that it says what the
     * formulation cost *at a moment*, and a writer that skipped "unchanged"
     * rows would leave gaps a reader has to interpret. The cost history is
     * paginated newest-first precisely because it grows.
     *
     * @param  Collection<int, RecipeVersionLine>  $lines
     */
    private function writeCostSnapshot(RecipeVersion $version, RecipeCostingService $costing, Collection $lines): void
    {
        $computation = $costing->costingForPublication($version, $lines);

        if ($computation === null) {
            return;
        }

        $costing->writeSnapshot($version, CostBasis::Recalculated, $computation);
    }

    /**
     * Take a published version — and everything selling it — off sale.
     *
     * @param  array{added: list<string>, removed: list<string>, strengthened: list<string>, weakened: list<string>}  $diff
     */
    private function quarantine(
        RecipeVersion $version,
        RecipeLabelWriter $labels,
        RecipeUsageRegistry $usage,
        AuditRecorder $audit,
        array $diff,
    ): void {
        if ($version->status !== RecipeVersionStatus::Published) {
            return;
        }

        $reason = $labels->describe($diff);

        RecipeVersion::withoutTenancy()
            ->whereKey($version->getKey())
            ->update([
                'status' => RecipeVersionStatus::ReviewRequired->value,
                'review_reason' => $reason,
                'updated_at' => now(),
            ]);

        $audit->record(
            'catalogue.allergen_rollup_changed',
            subjectType: 'recipe_version',
            subjectId: (string) $version->getKey(),
            metadata: [
                'recipe_version_id' => (string) $version->getKey(),
                'recipe_id' => $version->recipe_id,

                // Never a key containing `code`: the audit redactor matches it
                // as a substring and would blank the value (OQ-036), which on a
                // food-safety event would leave a trail that records that
                // something changed and refuses to say what. The
                // `allergen_classes` precedent is `AllergenMappingService`.
                'added_allergen_classes' => $diff['added'],
                'removed_allergen_classes' => $diff['removed'],
                'changed_allergen_classes' => $labels->changedClasses($diff),
                'review_reason' => $reason,
            ],
        );

        $recipe = Recipe::withoutTenancy()->whereKey($version->recipe_id)->first();

        if ($recipe instanceof Recipe) {
            // Through the port, never by touching catalogue tables: the
            // dependency edge runs Catalogues → Recipes, and this module must
            // not learn that catalogues exist.
            $usage->quarantinePublishedItems($recipe, $reason);
        }
    }

    /**
     * Follow the output → line chain one hop.
     *
     * Scoped to this organisation. An intermediate is a tenant's own component,
     * and reaching into another kitchen's formulations because it happens to use
     * an ingredient of the same name would be a tenancy breach dressed up as a
     * recompute.
     */
    private function propagate(RecipeVersion $version): void
    {
        $visited = [...$this->visited, $this->recipeVersionId];

        if ($this->depth >= self::MAX_DEPTH) {
            // Recorded, not swallowed. A chain this deep is a fact about the
            // formulation graph somebody should look at, and a recompute that
            // silently stopped short would leave a stale label looking current.
            Log::warning('Recipe derivation recompute stopped at the depth cap.', [
                'recipe_version_id' => $this->recipeVersionId,
                'organisation_id' => $this->organisationId,
                'depth' => $this->depth,
                'max_depth' => self::MAX_DEPTH,
                'visited_count' => count($visited),
            ]);

            return;
        }

        $outputIngredientIds = RecipeVersionOutput::withoutTenancy()
            ->where('recipe_version_id', $version->getKey())
            ->pluck('ingredient_id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        if ($outputIngredientIds === []) {
            return;
        }

        $dependents = RecipeVersion::withoutTenancy()
            ->where('organisation_id', $this->organisationId)
            ->where('status', '!=', RecipeVersionStatus::Retired->value)
            ->whereIn('id', RecipeVersionLine::withoutTenancy()
                ->whereIn('ingredient_id', $outputIngredientIds)
                ->select('recipe_version_id'))
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        foreach ($dependents as $dependentId) {
            if (in_array($dependentId, $visited, true)) {
                continue;
            }

            self::dispatch($dependentId, $this->organisationId, $this->depth + 1, $visited);
        }
    }
}
