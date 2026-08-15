<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Exceptions\PermissionDenied;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Exceptions\PublishBlocked;
use Healthy360\Catalogues\Models\CatalogueItem;
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
 * **The gate itself lives in `CatalogueItemReadiness`** (K1.8). This class
 * decides *what happens* — the permission stack, the transaction, the audit
 * event — and asks that service *whether it may*. The split is not tidiness: a
 * review queue has to be able to ask "which of these thirty listings are
 * ready" without publishing thirty listings to find out, and the only safe way
 * to answer that question twice is to have one implementation of it. Every
 * blocker is still collected and raised as one `catalogue.publish_blocked`, so
 * a kitchen fixes everything in one pass rather than discovering problems one
 * attempt at a time; `PublishBlocked::fromReadiness()` is where the evaluator's
 * shape becomes the refusal clients have parsed since K1.4.
 */
final readonly class PublishCatalogueItem
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
        private DerivedAllergenService $allergens,
        private CatalogueItemReadiness $readiness,
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
        $reasons = $this->readiness->reasons($item);

        if ($reasons !== []) {
            throw PublishBlocked::fromReadiness($reasons);
        }
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
}
