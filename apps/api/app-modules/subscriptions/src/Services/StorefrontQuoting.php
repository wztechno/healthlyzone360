<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Tenancy\Database\DatabaseTenantContext;

/**
 * The storefront's quote: what a shopper is told a plan costs, and on which
 * days it would arrive.
 *
 * `SubscriptionPricing` answers the same question for a caller who already
 * holds a `sales_channel_id` and a `plan_duration_id` — the purchase path,
 * where both are settled. This class exists because **a shopper holds
 * neither**, and cannot: the public plan read publishes durations as
 * `{code, kind, days}` with no identifier, and sales channels live behind
 * `/catalogue/sales-channels`, a tenant surface a customer has no context for.
 * Asking a client to supply either was asking it to invent one.
 *
 * ## The channel is resolved, never accepted
 *
 * A client-supplied `sales_channel_id` on a consumer surface is a tenant
 * identifier chosen by the party being charged through it, and the whole point
 * of a storefront price is that the platform decides which tariff applies. So
 * the kitchen comes from the plan's own `organisation_id` and the channel from
 * that kitchen's active *consumer* channels — `b2c_web` and `marketplace`, the
 * two kinds `SalesChannelKind::hasPrivatePricing()` declares public. A `b2b`,
 * `corporate` or `insurance` channel can no longer be reached from here at all,
 * which is a stronger guarantee than the old validator gave: it accepted any
 * UUID and let `PriceResolver` decide.
 *
 * First priced channel wins, in creation order, which is the rule
 * `Kitchens\Services\MarketplacePlans::priceOf()` already applies to the plan
 * pages. The two surfaces quote the same tariff for the same plan because they
 * ask the same question in the same order — the alternative, a card and a
 * configurator disagreeing about the price, is the defect this shape exists to
 * prevent.
 *
 * ## The duration is resolved by days, not by code
 *
 * The third option, and the one taken. A kitchen's duration `code` is an
 * authored slug (`4w`, `28d`, `monthly`); the number of days is the fact, and
 * it is the fact the client already holds — `MarketplacePlanDuration.days` is
 * published, and `plan-mappers.ts` has resolved durations by days since M1 on
 * exactly this reasoning. Accepting days therefore changes **no** public
 * projection and asks the client for nothing it must look up.
 *
 * Two offered durations with the same day count are a configuration mistake
 * this class refuses rather than guesses: `duration_ambiguous` names it. A
 * silent pick would quote one discount and capture the other.
 *
 * ## Availability, and the fact it replaces
 *
 * `available_weekdays` is the entire point of S1's replacement of the old
 * seven-probe hack, in which a configurator priced the same subscription once
 * per weekday and read which answers carried a warning. It is derived from the
 * kitchen's active `delivery_windows`, which is where the platform actually
 * records which days deliveries run — `weekdays = []` means every day, and that
 * convention is read here through the model's own `runsOn()` so nothing has to
 * remember it twice.
 *
 * A kitchen with **no** active window is unconstrained rather than closed: all
 * seven days. That is the reading `Orders\Services\BranchScheduleLookup` takes
 * of an unconfigured branch ("unconfigured, not closed"), and it is the safe
 * direction here — telling a customer a kitchen delivers on no day, when nobody
 * has said anything about days, would empty a configurator on a configuration
 * gap. The opposite reading belongs to `MarketplaceAvailability`, which is
 * answering "may I order on this date", a question with a real date in it.
 */
final readonly class StorefrontQuoting
{
    public function __construct(
        private SubscriptionPricing $pricing,
        private DatabaseTenantContext $tenantContext,
    ) {}

    /**
     * Quote a plan configuration for a shopper.
     *
     * @return array{
     *     quote: PlanQuote|null,
     *     reasons: list<array<string, mixed>>,
     *     duration: PlanDuration|null,
     *     available_weekdays: list<int>,
     *     allows_free_selection: bool,
     *     change_cutoff_hours: int,
     * }
     */
    public function quote(
        string $catalogueItemId,
        string $catalogueItemVariantId,
        int $planDurationDays,
        ?CarbonImmutable $on = null,
    ): array {
        $plan = CatalogueItem::withoutTenancy()->whereKey($catalogueItemId)->first();

        if (! $plan instanceof CatalogueItem) {
            return $this->refusal([['reason' => 'plan_not_subscription', 'catalogue_item_id' => $catalogueItemId]]);
        }

        $organisationId = $plan->organisation_id;

        $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($catalogueItemId)->first();

        if (! $profile instanceof SubscriptionPlanProfile) {
            return $this->refusal([['reason' => 'plan_not_subscription', 'catalogue_item_id' => $catalogueItemId]]);
        }

        [$duration, $durationReasons] = $this->resolveDuration(
            $organisationId,
            $catalogueItemVariantId,
            $planDurationDays,
        );

        if (! $duration instanceof PlanDuration) {
            return $this->refusal($durationReasons, $profile);
        }

        $channels = $this->consumerChannels($organisationId);

        if ($channels === []) {
            return $this->refusal(
                [['reason' => 'unpriced', 'catalogue_item_id' => $catalogueItemId]],
                $profile,
                $duration,
            );
        }

        // The RLS policy on `price_list_items` is the outer layer and stays
        // there: the read runs with `app.organisation_id` set to the kitchen
        // being browsed, exactly as an anonymous marketplace read does.
        /** @var array{0: PlanQuote|null, 1: list<array<string, mixed>>} $resolved */
        $resolved = $this->tenantContext->during(null, $organisationId, null, function () use (
            $channels,
            $catalogueItemId,
            $catalogueItemVariantId,
            $duration,
            $on,
        ): array {
            $last = [null, [['reason' => 'unpriced', 'catalogue_item_id' => $catalogueItemId]]];

            foreach ($channels as $channel) {
                [$quote, $reasons] = $this->pricing->quote(
                    (string) $channel->getKey(),
                    $catalogueItemId,
                    $catalogueItemVariantId,
                    (string) $duration->getKey(),
                    $on,
                );

                if ($quote instanceof PlanQuote) {
                    return [$quote, []];
                }

                $last = [null, $reasons];
            }

            return $last;
        });

        return [
            'quote' => $resolved[0],
            'reasons' => $resolved[1],
            'duration' => $duration,
            'available_weekdays' => $this->availableWeekdays($organisationId),
            'allows_free_selection' => $profile->allows_free_selection,
            'change_cutoff_hours' => $profile->change_cutoff_hours,
        ];
    }

    /**
     * The kitchen's active consumer channels, in a deterministic order.
     *
     * `sales_channels` carries no row-level-security policy, so the explicit
     * `organisation_id` filter is the whole boundary — the same note
     * `MarketplaceChannels` records where it applies the same rule.
     *
     * @return list<SalesChannel>
     */
    private function consumerChannels(string $organisationId): array
    {
        $kinds = array_values(array_map(
            static fn (SalesChannelKind $kind): string => $kind->value,
            array_filter(
                SalesChannelKind::cases(),
                static fn (SalesChannelKind $kind): bool => ! $kind->hasPrivatePricing(),
            ),
        ));

        /** @var list<SalesChannel> $channels */
        $channels = SalesChannel::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('status', SalesChannelStatus::Active->value)
            ->whereIn('channel_kind', $kinds)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get()
            ->all();

        return $channels;
    }

    /**
     * The offered duration whose run is this many days.
     *
     * Restricted to durations actually *offered for this configuration*
     * (`plan_variant_durations.is_available`), so a duration the kitchen
     * withdrew cannot be quoted by naming its day count.
     *
     * @return array{0: PlanDuration|null, 1: list<array<string, mixed>>}
     */
    private function resolveDuration(
        string $organisationId,
        string $catalogueItemVariantId,
        int $planDurationDays,
    ): array {
        /** @var list<string> $offeredIds */
        $offeredIds = PlanVariantDuration::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('catalogue_item_variant_id', $catalogueItemVariantId)
            ->where('is_available', true)
            ->pluck('plan_duration_id')
            ->all();

        if ($offeredIds === []) {
            return [null, [['reason' => 'duration_not_offered', 'duration_days' => $planDurationDays]]];
        }

        $matches = PlanDuration::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('id', $offeredIds)
            ->where('is_active', true)
            ->where('duration_days', $planDurationDays)
            ->orderBy('display_order')
            ->orderBy('code')
            ->get();

        if ($matches->count() > 1) {
            return [null, [[
                'reason' => 'duration_ambiguous',
                'duration_days' => $planDurationDays,
                'codes' => $matches->pluck('code')->values()->all(),
            ]]];
        }

        $duration = $matches->first();

        if (! $duration instanceof PlanDuration) {
            return [null, [['reason' => 'duration_not_offered', 'duration_days' => $planDurationDays]]];
        }

        return [$duration, []];
    }

    /**
     * ISO weekdays this kitchen delivers on, ascending.
     *
     * @return list<int>
     */
    private function availableWeekdays(string $organisationId): array
    {
        $windows = DeliveryWindow::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where('is_active', true)
            ->get();

        $all = [1, 2, 3, 4, 5, 6, 7];

        if ($windows->isEmpty()) {
            return $all;
        }

        $available = array_values(array_filter(
            $all,
            static fn (int $weekday): bool => $windows->contains(
                static fn (DeliveryWindow $window): bool => $window->runsOn($weekday),
            ),
        ));

        return $available;
    }

    /**
     * A refusal, carrying whatever plan facts were established before it.
     *
     * The rights and the calendar travel even on a refusal, because a
     * configurator that has just been told "not for that duration" still has to
     * draw the weekday selector and the cut-off it *would* be subject to.
     *
     * @param  list<array<string, mixed>>  $reasons
     * @return array{
     *     quote: PlanQuote|null,
     *     reasons: list<array<string, mixed>>,
     *     duration: PlanDuration|null,
     *     available_weekdays: list<int>,
     *     allows_free_selection: bool,
     *     change_cutoff_hours: int,
     * }
     */
    private function refusal(
        array $reasons,
        ?SubscriptionPlanProfile $profile = null,
        ?PlanDuration $duration = null,
    ): array {
        return [
            'quote' => null,
            'reasons' => $reasons,
            'duration' => $duration,
            'available_weekdays' => [],
            'allows_free_selection' => $profile instanceof SubscriptionPlanProfile
                ? $profile->allows_free_selection
                : false,
            'change_cutoff_hours' => $profile instanceof SubscriptionPlanProfile
                ? $profile->change_cutoff_hours
                : ChangeWindow::DEFAULT_CUTOFF_HOURS,
        ];
    }
}
