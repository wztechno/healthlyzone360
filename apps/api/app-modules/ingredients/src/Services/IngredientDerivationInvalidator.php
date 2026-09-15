<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/**
 * "Something under this ingredient moved — mark whatever was derived from it."
 *
 * Extracted from {@see AllergenMappingService}, which was its only caller
 * while allergens were the only thing derived from an ingredient. They are
 * not any more: per-100 g nutrition is derived the same way, from the same
 * rows, with the same fan-out problem, and a second copy of the context
 * dance below is the kind of duplicate that diverges in exactly the branch
 * nobody tests. A move rather than a new abstraction — the behaviour is
 * unchanged and the docblocks came with it.
 *
 * **A write here reaches the labels derived from it** (K1.8). Every published
 * recipe version whose lines use the ingredient is marked stale and queued for
 * recompute. Both halves go through {@see IngredientUsageRegistry} because the
 * module edge runs Recipes → Ingredients and this module must not learn what a
 * recipe is.
 */
final readonly class IngredientDerivationInvalidator
{
    public function __construct(
        private IngredientUsageRegistry $usage,
        private DatabaseTenantContext $database,
        private TenantContext $context,
    ) {}

    /**
     * Mark every derivation downstream of this ingredient stale, and say how
     * wide the blast radius was.
     *
     * Marked synchronously and recomputed on the queue: the derivation is a
     * food-safety conclusion that can quarantine a published version and pull a
     * listing off sale, and running it inside the caller's request would make
     * an ingredient edit take as long as the largest recipe using the
     * ingredient. A label whose basis has moved must never *look* current for
     * even one read, so the marking itself cannot wait.
     *
     * @param  string|null  $layer  the organisation whose derivations this
     *                              change reaches, or NULL when it reaches
     *                              every tenant that uses the ingredient. The
     *                              caller decides, because only the caller
     *                              knows what it wrote: a kitchen adding its
     *                              own allergen overlay to a platform
     *                              ingredient reaches one kitchen, while the
     *                              same row's nutrition changing reaches all of
     *                              them. Deriving it from the row's owner would
     *                              turn the first case into a cross-tenant
     *                              write performed on a tenant's behalf.
     * @return array{0: list<string>, 1: int} the versions marked, and how many
     *                                        organisations were reached
     */
    public function invalidate(Ingredient $ingredient, ?string $layer): array
    {
        return $layer === null
            ? $this->everyTenant($ingredient)
            : [$this->usage->markDependentDerivationsStale($ingredient), 1];
    }

    /**
     * The platform-baseline fan-out (K1.8) — the documented K1.2 gap.
     *
     * A tenant editing its own layer affects exactly one organisation, and the
     * ordinary path handles it. A platform change affects every kitchen that
     * inherits the ingredient, and none of those rows is reachable from the
     * caller's own context: the row-level security policies on
     * `recipe_versions` fail closed, so the marking has to happen *inside* each
     * organisation rather than around all of them.
     *
     * Both layers of context are restored per organisation, and both matter.
     * `DatabaseTenantContext::during()` publishes the session variables the
     * policies read; `TenantContext` is what the recipes module's registry
     * consults to decide which organisation it is answering for. Setting one
     * and not the other is how a query silently returns nothing.
     *
     * The ambient context is put back whatever happens. A platform operator's
     * request continues after this call — it still has an audit event to write
     * and a response to serialise — and leaving it pointed at the last tenant
     * in the loop would be a tenancy breach caused by tidying up badly.
     *
     * @return array{0: list<string>, 1: int}
     */
    private function everyTenant(Ingredient $ingredient): array
    {
        $organisationIds = $this->usage->dependentOrganisationIds($ingredient);

        if ($organisationIds === []) {
            return [[], 0];
        }

        $ambient = $this->context->toArray();

        /** @var list<string> $marked */
        $marked = [];

        try {
            foreach ($organisationIds as $organisationId) {
                $this->database->during(null, $organisationId, null, function () use ($ingredient, $organisationId, &$marked): void {
                    $this->context->restore(['user_id' => null, 'organisation_id' => $organisationId, 'branch_id' => null]);

                    $marked = [...$marked, ...$this->usage->markDependentDerivationsStale($ingredient)];
                });
            }
        } finally {
            $this->context->restore($ambient);
        }

        return [$marked, count($organisationIds)];
    }
}
