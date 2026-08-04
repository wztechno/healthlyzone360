<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\PlanPricingBasis;
use Healthy360\Catalogues\Enums\PlanType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The commercial terms of one subscription plan — read and written as a whole.
 *
 * **A PUT, not a PATCH, and not a set of columns on the item.** The profile is
 * one commercial statement: "sold both ways, priced per day, skippable,
 * pausable, changeable up to 24 hours before delivery". A merchandiser reads
 * all of it to decide any of it, and a PATCH surface over eight interdependent
 * switches makes "I left pausing alone" and "I turned pausing off" the same
 * request on a right a subscriber has been sold.
 *
 * **The profile is created on first write**, not on item creation. A plan that
 * has just been named has no terms yet, and writing a default set at creation
 * would make "nobody has decided" indistinguishable from "somebody chose the
 * defaults" — which is exactly the distinction the publish gate reads when it
 * refuses a plan with no profile.
 *
 * **`change_cutoff_hours` defaults to 24 and the default is evidence**, not a
 * guess: the workbook operating rule and legacy source B's amendment window
 * say the same thing from opposite directions, and the merge preserves both by
 * keeping one column with that default. A kitchen that preps at dawn may raise
 * it; zero is permitted, because "change it until the van leaves" is a policy
 * somebody may genuinely have.
 *
 * `If-Match` carries the **item's** validator, and the write bumps it: the
 * profile has no `lock_version` of its own because it is not a separate thing
 * to hold a lock on — it is the commercial face of the item, and a concurrent
 * editor of either should lose the race with the other.
 */
final readonly class PlanProfileService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
    ) {}

    /**
     * The stored profile, or null when nobody has written one yet.
     *
     * Null rather than a fabricated default, so that a caller — the publish
     * gate above all — can tell "no terms have been decided" from "the terms
     * are the ordinary ones".
     */
    public function forItem(CatalogueItem $item): ?SubscriptionPlanProfile
    {
        $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($item->getKey())->first();

        return $profile instanceof SubscriptionPlanProfile ? $profile : null;
    }

    /**
     * @param  array{
     *     plan_type?: string|null,
     *     pricing_basis?: string|null,
     *     allows_free_selection?: bool|null,
     *     skip_allowed?: bool|null,
     *     pause_allowed?: bool|null,
     *     change_cutoff_hours?: int|string|null,
     *     summary_en?: string|null,
     *     summary_ar?: string|null
     * }  $attributes
     *
     * @throws ApiException
     */
    public function put(CatalogueItem $item, array $attributes, int $expectedLockVersion): SubscriptionPlanProfile
    {
        $this->items->assertEditable($item);

        $planType = $this->planType($attributes['plan_type'] ?? null);
        $basis = $this->pricingBasis($attributes['pricing_basis'] ?? null);
        $cutoff = $this->cutoffHours($attributes['change_cutoff_hours'] ?? null);

        $profile = DB::transaction(function () use ($item, $attributes, $planType, $basis, $cutoff, $expectedLockVersion): SubscriptionPlanProfile {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($item->getKey())->first() ?? new SubscriptionPlanProfile;

            $profile->catalogue_item_id = (string) $item->getKey();
            $profile->organisation_id = $item->organisation_id;
            $profile->plan_type = $planType;
            $profile->pricing_basis = $basis;
            $profile->allows_free_selection = (bool) ($attributes['allows_free_selection'] ?? false);

            // Defaulted to true, deliberately: a plan whose profile says
            // nothing about skipping is a plan a subscriber may skip. The
            // restrictive reading would silently withdraw a right from every
            // plan written before somebody thought about the field.
            $profile->skip_allowed = (bool) ($attributes['skip_allowed'] ?? true);
            $profile->pause_allowed = (bool) ($attributes['pause_allowed'] ?? true);
            $profile->change_cutoff_hours = $cutoff;
            $profile->summary_en = $this->trimmedOrNull($attributes['summary_en'] ?? null);
            $profile->summary_ar = $this->trimmedOrNull($attributes['summary_ar'] ?? null);
            $profile->save();

            return $profile;
        });

        $this->audit->record(
            'catalogue.plan_profile_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'slug' => $item->slug,
                'plan_type' => $profile->plan_type->value,
                'pricing_basis' => $profile->pricing_basis->value,
                'change_cutoff_hours' => $profile->change_cutoff_hours,
                'lock_version' => $item->lock_version,
            ],
        );

        return $profile;
    }

    /**
     * @throws ApiException
     */
    private function planType(mixed $value): PlanType
    {
        if ($value === null || $value === '') {
            return PlanType::Both;
        }

        $type = is_string($value) ? PlanType::tryFrom(trim($value)) : null;

        if ($type === null) {
            throw $this->invalid('plan_type', 'A plan is sold as a subscription, as a limited-time offer, or both.');
        }

        return $type;
    }

    /**
     * @throws ApiException
     */
    private function pricingBasis(mixed $value): PlanPricingBasis
    {
        if ($value === null || $value === '') {
            return PlanPricingBasis::PerDay;
        }

        $basis = is_string($value) ? PlanPricingBasis::tryFrom(trim($value)) : null;

        if ($basis === null) {
            throw $this->invalid('pricing_basis', 'A plan price is quoted per day, per week, or for the whole run.');
        }

        return $basis;
    }

    /**
     * @throws ApiException
     */
    private function cutoffHours(mixed $value): int
    {
        if ($value === null || $value === '') {
            return 24;
        }

        if (! is_numeric($value) || (int) $value < 0) {
            throw $this->invalid(
                'change_cutoff_hours',
                'The change cut-off is a whole number of hours, zero or more. Zero means a subscriber may change a delivery until the van leaves.',
            );
        }

        return (int) $value;
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
