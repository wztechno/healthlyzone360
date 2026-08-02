<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Exceptions\PermissionDenied;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Exceptions\PublishBlocked;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Publication and retirement of a catalogue item — lifecycle actions with
 * their own routes, their own permission (`catalogue.publish_organisation`)
 * and their own audit events, never a `PATCH status` (master plan v2 §4.15).
 *
 * **The K1.4 gate is deliberately minimal, and says so.** The full readiness
 * evaluator — confirmed prices, delivery availability, complete allergen
 * determination across every listed ingredient, translation coverage on every
 * field — is K1.8, and it will add reasons to this list rather than replace
 * the mechanism. What is here is the set that can be evaluated honestly with
 * the data K1.4 holds:
 *
 * - **State.** Only a draft publishes. A quarantined item
 *   (`review_required`) is blocked *structurally* — that is what the state is
 *   for (§4.7) — and a published or retired one is not a candidate.
 * - **Both languages.** An item whose Arabic name is empty is untranslated,
 *   and an untranslated listing reaching an Arabic-speaking customer as
 *   English is the failure §4.18 exists to prevent.
 * - **Something to buy.** A product with no active variant is a name with no
 *   pack behind it, and a price has nothing to attach to.
 * - **An allergen basis.** A meal must either link a recipe with a published
 *   version, or list its own ingredients. An item with neither cannot answer
 *   "what is in this", and silence is not a statement of absence — the same
 *   rule the recipe publish gate is built on.
 * - **Quarantine propagates.** A linked recipe carrying a live
 *   `review_required` version blocks publication, even if a good published
 *   version exists beside it. A quarantine is an unresolved food-safety
 *   contradiction on that formulation, and the answer to "may we sell the dish
 *   while somebody works out whether the burghul contains gluten" is no.
 *
 * Every blocker is collected and raised as one `catalogue.publish_blocked`, so
 * a kitchen fixes everything in one pass rather than discovering problems one
 * attempt at a time.
 *
 * **K1.6 adds a fifth set of checks, for subscription plans only** — and one of
 * them reaches outside the catalogue for the first time:
 *
 * - **Terms.** A plan with no `subscription_plan_profiles` row has had no
 *   commercial decision made about it: nobody has said how it is sold, on what
 *   basis it is priced, or how late a subscriber may change a delivery. A
 *   listing that answers none of those is not a listing.
 * - **A matrix.** A plan with no active `plan_configuration` variant is a name
 *   with no configuration behind it — the plan-side twin of a product with no
 *   pack.
 * - **A run.** At least one available duration assignment across the active
 *   configurations. Without one there is nothing a customer can buy: a plan is
 *   sold *for a period*, and the period is not implied.
 * - **Real prices, on every configuration.** This is what keeps a plan imported
 *   with placeholder prices honestly unpublishable until somebody supplies the
 *   numbers (decision OD-2, reviewer point 15). A placeholder is a row that
 *   says "we have not priced this", and a plan page rendering it — as a blank,
 *   as a zero, or as anything at all — is the failure the whole placeholder
 *   design exists to prevent. So every active configuration must carry a
 *   confirmed, standing price on an active tariff, and the ones that do not are
 *   named individually.
 *
 * The price question is asked through the `ConfirmedPriceRegistry` port rather
 * than by querying `price_list_items` directly: the module dependency runs
 * Pricing → Catalogues, and the registry graph is architecture-tested acyclic.
 * The port answers *whether* a variant is priced and never *what* it costs, so
 * the gate cannot become a way around the K1.5 permission split.
 */
final readonly class PublishCatalogueItem
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
        private DerivedAllergenService $allergens,
        private ConfirmedPriceRegistry $prices,
    ) {}

    /**
     * @throws ApiException
     */
    public function publish(CatalogueItem $item, int $expectedLockVersion): CatalogueItem
    {
        $this->assertMayPublish($item);
        $this->assertPublishable($item);

        DB::transaction(function () use ($item, $expectedLockVersion): void {
            $this->items->compareAndSwap($item, [
                'status' => CatalogueItemStatus::Published->value,
                'review_reason' => null,
                'updated_by' => $this->context->userId(),
            ], $expectedLockVersion);
        });

        $derived = $this->allergens->forItem($item);

        $this->audit->record(
            'catalogue.item_published',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'slug' => $item->slug,
                'item_type' => $item->item_type->value,

                // What the label says at the moment of publication, as class
                // names — never a `*_code` key, which the audit redactor would
                // blank on a substring match (OQ-036).
                'allergen_basis' => $derived['basis'],
                'allergen_classes' => array_map(
                    static fn (array $row): string => $row['allergen_code'],
                    $derived['allergens'],
                ),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * Withdraw an item from sale. Terminal, and the only withdrawal there is:
     * sellable items retire, they never archive (§4.7). A retired row keeps
     * its history and disappears from every consumer read, because an order or
     * a price snapshot may point at it forever.
     *
     * Retirement is available from every state except `retired` itself,
     * including `draft`. Refusing to retire a draft would leave a kitchen with
     * no way at all to withdraw a listing it decided against — there is no
     * archive here and no delete anywhere.
     *
     * @throws ApiException
     */
    public function retire(CatalogueItem $item, int $expectedLockVersion, ?string $reason = null): CatalogueItem
    {
        if ($item->status === CatalogueItemStatus::Retired) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This catalogue item is already retired.',
                ['status' => $item->status->value, 'current_lock_version' => $item->lock_version],
            );
        }

        $previous = $item->status;

        DB::transaction(function () use ($item, $expectedLockVersion): void {
            $this->items->compareAndSwap($item, [
                'status' => CatalogueItemStatus::Retired->value,
                'updated_by' => $this->context->userId(),
            ], $expectedLockVersion);
        });

        $this->audit->record(
            'catalogue.item_retired',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'slug' => $item->slug,
                'previous_status' => $previous->value,
                'reason' => $reason,
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * @throws PublishBlocked
     */
    private function assertPublishable(CatalogueItem $item): void
    {
        $reasons = [];

        if ($item->status === CatalogueItemStatus::ReviewRequired) {
            $reasons[] = ['reason' => 'item_quarantined', 'review_reason' => $item->review_reason];
        } elseif ($item->status !== CatalogueItemStatus::Draft) {
            $reasons[] = ['reason' => 'item_not_a_draft', 'status' => $item->status->value];
        }

        $untranslated = [];

        if (trim($item->name_en) === '') {
            $untranslated[] = 'name_en';
        }

        if (trim($item->name_ar) === '') {
            $untranslated[] = 'name_ar';
        }

        if ($untranslated !== []) {
            $reasons[] = ['reason' => 'translation_incomplete', 'fields' => $untranslated];
        }

        if ($item->item_type === CatalogueItemType::Product && ! $this->hasActiveVariant($item)) {
            $reasons[] = ['reason' => 'no_active_variant'];
        }

        if ($item->item_type === CatalogueItemType::Meal && ! $this->hasAllergenBasis($item)) {
            $reasons[] = ['reason' => 'no_allergen_basis'];
        }

        $quarantined = $this->quarantinedVersionIds($item);

        if ($quarantined !== []) {
            $reasons[] = [
                'reason' => 'linked_recipe_quarantined',
                'recipe_id' => $item->recipe_id,
                'recipe_version_ids' => $quarantined,
            ];
        }

        if ($item->item_type === CatalogueItemType::SubscriptionPlan) {
            $reasons = [...$reasons, ...$this->planReasons($item)];
        }

        if ($reasons !== []) {
            throw new PublishBlocked($reasons);
        }
    }

    /**
     * The plan-only half of the gate (K1.6).
     *
     * Every check is evaluated even when an earlier one has already failed, for
     * the reason the whole class exists: a plan missing its profile *and* its
     * prices should learn both facts in one attempt.
     *
     * @return list<array<string, mixed>>
     */
    private function planReasons(CatalogueItem $item): array
    {
        $reasons = [];

        if (! SubscriptionPlanProfile::withoutTenancy()->whereKey($item->getKey())->exists()) {
            $reasons[] = ['reason' => 'plan_profile_missing'];
        }

        /** @var array<string, string> $activeConfigurations identifier → code */
        $activeConfigurations = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('variant_type', VariantType::PlanConfiguration->value)
            ->where('status', VariantStatus::Active->value)
            ->orderBy('code')
            ->pluck('code', 'id')
            ->all();

        if ($activeConfigurations === []) {
            // Nothing further can be evaluated honestly: durations and prices
            // are both questions *about* configurations, and reporting "no
            // durations" beside "no configurations" would be two ways of saying
            // the same missing thing.
            return [...$reasons, ['reason' => 'no_active_plan_configuration']];
        }

        $variantIds = array_map(strval(...), array_keys($activeConfigurations));

        $hasDuration = PlanVariantDuration::withoutTenancy()
            ->whereIn('catalogue_item_variant_id', $variantIds)
            ->where('is_available', true)
            ->exists();

        if (! $hasDuration) {
            $reasons[] = ['reason' => 'no_duration_assigned'];
        }

        $priced = $this->prices->pricedVariantIds($item->organisation_id, $variantIds);
        $unpriced = array_values(array_diff($variantIds, $priced));

        if ($unpriced !== []) {
            $reasons[] = [
                'reason' => 'plan_prices_incomplete',
                'catalogue_item_variant_ids' => $unpriced,

                // The codes as well as the identifiers: a merchandiser reading
                // this refusal is looking at a matrix labelled by code, and a
                // list of UUIDs would send them back to the API to find out
                // which cells to price.
                'configurations' => array_map(
                    static fn (string $id): string => $activeConfigurations[$id],
                    $unpriced,
                ),
            ];
        }

        return $reasons;
    }

    /**
     * Publishing a **plan** additionally requires `plan.publish_organisation`.
     *
     * The route keeps `catalogue.publish_organisation` as its middleware, so
     * this composes with that code rather than replacing it. That is forced by
     * the decision to keep one publish route for all three item types, and it is
     * the honest arrangement rather than a workaround: middleware cannot branch
     * on a row it has not loaded, and a second route
     * (`/catalogue/plans/{item}/publish`) would give one action two URLs and two
     * audit trails. The precedent is the cost-snapshot endpoint, which stacks
     * `recipe.manage_organisation` inside `recipe.view_costs_organisation` for
     * the same reason.
     *
     * Both seeded roles that may publish anything — `kitchen_manager` and
     * `commercial_manager` — hold both codes, so nothing a template role can do
     * changes. What the extra code buys is that a *bespoke* role can be given
     * authority over products and meals without acquiring authority over the
     * commercial instrument a subscription is.
     *
     * @throws PermissionDenied
     */
    private function assertMayPublish(CatalogueItem $item): void
    {
        if ($item->item_type !== CatalogueItemType::SubscriptionPlan) {
            return;
        }

        if (Gate::allows('plan.publish_organisation')) {
            return;
        }

        throw new PermissionDenied(AccessDenialReason::PermissionNotGranted, 'plan.publish_organisation');
    }

    private function hasActiveVariant(CatalogueItem $item): bool
    {
        return CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('status', VariantStatus::Active->value)
            ->exists();
    }

    /**
     * A meal may answer "what is in this" two ways: a published recipe version
     * whose frozen label it inherits, or its own ingredient list. Either is
     * enough; neither is not.
     */
    private function hasAllergenBasis(CatalogueItem $item): bool
    {
        if ($this->allergens->publishedVersion($item) !== null) {
            return true;
        }

        return CatalogueItemIngredient::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->exists();
    }

    /**
     * Live quarantined versions of the linked recipe.
     *
     * Retired ones are excluded: a quarantine resolved by superseding the
     * version is resolved, and history must not block a publication forever.
     *
     * @return list<string>
     */
    private function quarantinedVersionIds(CatalogueItem $item): array
    {
        if ($item->recipe_id === null) {
            return [];
        }

        return array_values(RecipeVersion::withoutTenancy()
            ->where('recipe_id', $item->recipe_id)
            ->where('status', RecipeVersionStatus::ReviewRequired->value)
            ->orderBy('version_number')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }
}
