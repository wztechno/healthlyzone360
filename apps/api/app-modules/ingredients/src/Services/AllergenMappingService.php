<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\AccessControl\Http\Middleware\RequirePlatformContext;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Contracts\IngredientUsageRegistry;
use Healthy360\Ingredients\Enums\AllergenContainment;
use Healthy360\Ingredients\Enums\AllergenMappingSource;
use Healthy360\Ingredients\Enums\AllergenMarketScope;
use Healthy360\Ingredients\Enums\AllergenVerificationStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Ingredients\Models\IngredientAllergen;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The allergen mapping editor's only write path.
 *
 * **Replace, not merge.** A mapping set is a complete statement — "this
 * ingredient carries these allergens and no others" — so the endpoint is a
 * PUT and the write replaces the caller's whole layer for one market scope
 * atomically. A per-row PATCH surface would make "I removed the milk row"
 * indistinguishable from "I forgot to send the milk row", and on an allergen
 * list that difference is the whole point.
 *
 * **Layers.** A platform caller replaces the baseline rows (organisation_id
 * NULL). A tenant caller replaces only its own overlay and cannot touch the
 * baseline it reads.
 *
 * **Upgrade-only.** A tenant overlay may say *more* than the platform
 * baseline — add a class the baseline does not mention, or raise a
 * `may_contain` to a `contains` — because a kitchen knows its own supply and
 * its own shared equipment. It may never say *less*: dropping a baseline
 * class, or lowering a `contains` to a `may_contain`, is refused. The
 * asymmetry is not a policy preference. Over-declaring an allergen costs a
 * customer a menu option; under-declaring one costs them an ambulance.
 */
final readonly class AllergenMappingService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private IngredientUsageRegistry $usage,
    ) {}

    /**
     * Every mapping visible for an ingredient — baseline and, in a tenant
     * context, that tenant's overlay. Ordered so the two layers interleave
     * predictably for a UI that shows them side by side.
     *
     * @return Collection<int, IngredientAllergen>
     */
    public function mappingsFor(Ingredient $ingredient, ?string $organisationId): Collection
    {
        return IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->where(function ($query) use ($organisationId): void {
                $query->whereNull('organisation_id');

                if ($organisationId !== null) {
                    $query->orWhere('organisation_id', $organisationId);
                }
            })
            ->orderBy('allergen_code')
            ->orderByRaw('organisation_id nulls first')
            ->get();
    }

    /**
     * Replace the caller's layer for one market scope.
     *
     * @param  list<array{
     *     allergen_code: string,
     *     containment: string,
     *     source?: string|null,
     *     verification_status?: string|null,
     *     evidence?: string|null
     * }>  $mappings
     * @return Collection<int, IngredientAllergen>
     *
     * @throws ApiException
     */
    public function replace(Ingredient $ingredient, AllergenMarketScope $scope, array $mappings): Collection
    {
        $organisationId = $this->callerLayer();
        $normalised = $this->normalise($mappings);

        if ($organisationId !== null) {
            $this->assertUpgradeOnly($ingredient, $scope, $normalised);
        }

        DB::transaction(function () use ($ingredient, $scope, $normalised, $organisationId): void {
            $query = IngredientAllergen::withoutTenancy()
                ->where('ingredient_id', $ingredient->getKey())
                ->where('market_scope', $scope->value);

            $organisationId === null
                ? $query->whereNull('organisation_id')
                : $query->where('organisation_id', $organisationId);

            foreach ($query->get() as $stale) {
                $stale->delete();
            }

            $write = function () use ($ingredient, $scope, $normalised, $organisationId): void {
                foreach ($normalised as $mapping) {
                    $row = new IngredientAllergen;
                    $row->ingredient_id = (string) $ingredient->getKey();
                    $row->organisation_id = $organisationId;
                    $row->allergen_code = $mapping['allergen_code'];
                    $row->market_scope = $scope;
                    $row->containment = $mapping['containment'];
                    $row->source = $mapping['source'];
                    $row->verification_status = $mapping['verification_status'];
                    $row->evidence = $mapping['evidence'];
                    $row->created_by = $this->context->userId();
                    $row->save();
                }
            };

            // A baseline row belongs to nobody; without this the tenancy
            // auto-fill would stamp the platform operator's own identifier on
            // it and quietly turn the baseline into that organisation's
            // private overlay.
            $organisationId === null
                ? IngredientAllergen::asPlatformRow($write)
                : $write();
        });

        // A frozen recipe label is only as good as the mappings it was
        // computed from, so a mapping change invalidates every published label
        // that depends on this ingredient (K1.2). Marked, not recomputed: the
        // reactive recompute — and the quarantine it can raise when the new
        // mapping contradicts a published label — is the **K1.8**
        // allergen-recompute job. Doing it here would make an allergen edit
        // take as long as the largest recipe using the ingredient, and would
        // run a food-safety derivation inside the mapping editor's request.
        $stale = $this->usage->markDependentDerivationsStale($ingredient);

        $this->audit->record(
            'catalogue.ingredient_allergens_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient',
            subjectId: (string) $ingredient->getKey(),
            metadata: [
                // Never a key ending in `_code`: the audit redactor matches
                // `code` as a substring and would blank the value (OQ-036).
                'allergen_classes' => array_map(static fn (array $m): string => $m['allergen_code'], $normalised),
                'market_scope' => $scope->value,
                'layer' => $organisationId === null ? 'platform_baseline' : 'organisation_overlay',
                'stale_recipe_versions' => $stale,
            ],
        );

        return $this->mappingsFor($ingredient, $organisationId);
    }

    /**
     * The layer the caller writes: NULL (the platform baseline) when the
     * active organisation *is* the platform operator, and the tenant's own
     * identifier otherwise.
     *
     * Derived from the organisation's type, never from a request field. A
     * caller that could name the layer it writes to could name the baseline,
     * and the upgrade-only rule would be advice rather than an invariant.
     */
    public function callerLayer(): ?string
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            return null;
        }

        $organisation = Organisation::query()->with('type')->find($organisationId);

        return $organisation?->type?->code === RequirePlatformContext::PLATFORM_OPERATOR_TYPE
            ? null
            : $organisationId;
    }

    /**
     * @param  list<array{allergen_code: string, containment: AllergenContainment, source: AllergenMappingSource, verification_status: AllergenVerificationStatus, evidence: string|null}>  $proposed
     *
     * @throws ApiException
     */
    private function assertUpgradeOnly(Ingredient $ingredient, AllergenMarketScope $scope, array $proposed): void
    {
        /** @var array<string, AllergenContainment> $baseline */
        $baseline = IngredientAllergen::withoutTenancy()
            ->where('ingredient_id', $ingredient->getKey())
            ->where('market_scope', $scope->value)
            ->whereNull('organisation_id')
            ->get()
            ->mapWithKeys(static fn (IngredientAllergen $row): array => [$row->allergen_code => $row->containment])
            ->all();

        if ($baseline === []) {
            return;
        }

        /** @var array<string, AllergenContainment> $offered */
        $offered = [];

        foreach ($proposed as $mapping) {
            $offered[$mapping['allergen_code']] = $mapping['containment'];
        }

        $weakened = [];

        foreach ($baseline as $code => $containment) {
            $replacement = $offered[$code] ?? null;

            if ($replacement === null || $replacement->strength() < $containment->strength()) {
                $weakened[] = $code;
            }
        }

        if ($weakened !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'An organisation mapping may add to the platform allergen baseline but never weaken it.',
                [
                    'fields' => ['mappings' => ['The platform baseline for this ingredient must be kept or strengthened.']],
                    'weakened_allergen_classes' => $weakened,
                ],
            );
        }
    }

    /**
     * @param  list<array{allergen_code: string, containment: string, source?: string|null, verification_status?: string|null, evidence?: string|null}>  $mappings
     * @return list<array{allergen_code: string, containment: AllergenContainment, source: AllergenMappingSource, verification_status: AllergenVerificationStatus, evidence: string|null}>
     *
     * @throws ApiException
     */
    private function normalise(array $mappings): array
    {
        $normalised = [];
        $seen = [];

        foreach ($mappings as $mapping) {
            $code = $mapping['allergen_code'];

            if (in_array($code, $seen, true)) {
                throw new ApiException(
                    ErrorCode::ValidationFailed,
                    'An allergen class may appear once per market scope.',
                    ['fields' => ['mappings' => ['Duplicate allergen class in the submitted set.']]],
                );
            }

            $seen[] = $code;

            $evidence = $mapping['evidence'] ?? null;
            $evidence = is_string($evidence) ? trim($evidence) : null;

            $normalised[] = [
                'allergen_code' => $code,
                'containment' => AllergenContainment::from($mapping['containment']),
                'source' => AllergenMappingSource::from($mapping['source'] ?? AllergenMappingSource::KitchenDeclared->value),
                'verification_status' => AllergenVerificationStatus::from($mapping['verification_status'] ?? AllergenVerificationStatus::Unverified->value),
                'evidence' => $evidence === '' ? null : $evidence,
            ];
        }

        return $normalised;
    }
}
