<?php

declare(strict_types=1);

namespace Healthy360\Cart\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;

/**
 * "Can this customer order this, through this channel, on this day — and at
 * what price?"
 *
 * **The single place that question is answered**, asked twice on every order:
 * once when a line enters the basket, as validation, and once at placement,
 * where the answer is authoritative and becomes the snapshot. Two
 * implementations would be two definitions of "orderable", and the one that
 * ran at checkout would eventually disagree with the one that ran on the
 * product page — which is the specific failure this class exists to prevent.
 *
 * **The checks, and why each is separate.**
 *
 * 1. **The channel is trading.** `PriceResolver` deliberately does not consult
 *    the channel's status, because "the desk is switched off" and "this
 *    article has no price on that desk" are different facts and it must not
 *    collapse them. The distinction is real, so somebody has to make it, and
 *    it is made here where a caller is asking to *buy* rather than to price.
 * 2. **The article exists inside the channel's own organisation**, read
 *    `withoutTenancy()` and filtered on the channel's `organisation_id` — the
 *    same construction `PriceResolver` uses and for the same reason: the
 *    caller that matters most is a customer who is a member of nothing. It
 *    also makes a cross-tenant basket impossible rather than merely unlikely.
 * 3. **The article is published.** `published` is the only status a consumer
 *    may be shown (§4.8), so it is the only status a consumer may buy. A
 *    retired article stays in an old basket and is refused here, visibly,
 *    which is the whole reason the `restrictOnDelete` on `cart_items` exists.
 * 4. **The variant belongs to the article and is active.** A pack is not
 *    separately published, so `active` is its whole test.
 * 5. **The channel offers it on the day.** The absence of an assignment says
 *    nothing at all — availability and publication are different questions —
 *    so an article no channel has been given is refused rather than assumed.
 *    The variant rule mirrors pricing's: a named variant matches its own row
 *    *or* the item-level row (a kitchen that offers the article offers every
 *    pack of it); an unnamed one matches only the item-level row.
 * 6. **There is a price**, and it is in the currency the basket is denominated
 *    in. Both halves matter. An unpriced article is not free, and a price in
 *    another currency is not a price in this one — converting it would be this
 *    class inventing an exchange rate nobody agreed to.
 *
 * Every failure is collected, never short-circuited, except where a later
 * check has nothing to stand on: there is no point pricing an article that
 * does not exist.
 */
final readonly class LineProbe
{
    public function __construct(private PriceResolver $prices) {}

    /**
     * @param  string  $quantity  decimal string, as `cart_items.quantity` is held
     * @param  CarbonImmutable|null  $on  the day the line is wanted; today when none is named
     * @param  string  $currencyCode  what the basket or order is denominated in
     */
    public function probe(
        SalesChannel $channel,
        string $catalogueItemId,
        ?string $catalogueItemVariantId,
        string $quantity,
        ?CarbonImmutable $on,
        string $currencyCode,
        ?CustomerAccount $buyer = null,
    ): LineProbeResult {
        $day = ($on ?? CarbonImmutable::now())->startOfDay();
        $refusals = [];

        if ($channel->status !== SalesChannelStatus::Active) {
            $refusals[] = ['reason' => 'channel_not_trading', 'sales_channel_id' => (string) $channel->getKey()];
        }

        $item = CatalogueItem::withoutTenancy()
            ->whereKey($catalogueItemId)
            ->where('organisation_id', $channel->organisation_id)
            ->first();

        if (! $item instanceof CatalogueItem) {
            // Nothing further can be asked. "Unknown here" is deliberately the
            // same answer as "belongs to another kitchen": a channel is one
            // organisation's, and confirming the existence of a neighbour's
            // article through it would be a cross-tenant read by probe.
            return new LineProbeResult(null, null, null, [
                ...$refusals,
                ['reason' => 'item_unknown', 'catalogue_item_id' => $catalogueItemId],
            ]);
        }

        if (! $item->status->isConsumerVisible()) {
            $refusals[] = [
                'reason' => 'item_not_published',
                'catalogue_item_id' => (string) $item->getKey(),
                'status' => $item->status->value,
            ];
        }

        $variant = null;

        if ($catalogueItemVariantId !== null) {
            $variant = CatalogueItemVariant::withoutTenancy()
                ->whereKey($catalogueItemVariantId)
                ->where('catalogue_item_id', $item->getKey())
                ->first();

            if (! $variant instanceof CatalogueItemVariant) {
                $refusals[] = ['reason' => 'variant_unknown', 'catalogue_item_variant_id' => $catalogueItemVariantId];
            } elseif ($variant->status !== VariantStatus::Active) {
                $refusals[] = [
                    'reason' => 'variant_not_active',
                    'catalogue_item_variant_id' => (string) $variant->getKey(),
                    'status' => $variant->status->value,
                ];
            }
        }

        if (! $this->offeredOn($channel, $item, $variant, $day)) {
            $refusals[] = [
                'reason' => 'channel_unavailable',
                'catalogue_item_id' => (string) $item->getKey(),
                'sales_channel_id' => (string) $channel->getKey(),
                'on' => $day->toDateString(),
            ];
        }

        $price = $this->prices->currentFor(
            (string) $channel->getKey(),
            (string) $item->getKey(),
            $variant?->getKey() === null ? null : (string) $variant->getKey(),
            $quantity,
            $day,
            $buyer,
        );

        if (! $price instanceof ResolvedPrice) {
            $refusals[] = [
                'reason' => 'unpriced',
                'catalogue_item_id' => (string) $item->getKey(),
                'catalogue_item_variant_id' => $variant?->getKey() === null ? null : (string) $variant->getKey(),
            ];
        } elseif ($price->currencyCode !== $currencyCode) {
            $refusals[] = [
                'reason' => 'currency_mismatch',
                'catalogue_item_id' => (string) $item->getKey(),
                'expected_currency' => $currencyCode,
                'offered_currency' => $price->currencyCode,
            ];
        }

        return new LineProbeResult($item, $variant, $refusals === [] ? $price : null, $refusals);
    }

    /**
     * Whether the channel offers this article — or this pack of it — on the
     * given day.
     *
     * `is_available` is a switch a kitchen can throw without deleting the
     * assignment, and the `available_from`/`available_to` pair is an inclusive
     * window with either end open. An absent window means "always", which is
     * the common case and is why both columns are nullable rather than
     * defaulted to distant dates.
     */
    private function offeredOn(SalesChannel $channel, CatalogueItem $item, ?CatalogueItemVariant $variant, CarbonImmutable $day): bool
    {
        $assignments = ChannelCatalogueItem::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('catalogue_item_id', $item->getKey())
            ->where('is_available', true)
            ->get();

        $variantId = $variant?->getKey() === null ? null : (string) $variant->getKey();

        foreach ($assignments as $assignment) {
            $rowVariantId = $assignment->catalogue_item_variant_id;

            // The variant rule, mirroring pricing's: the named pack's own row,
            // or the item-level row that offers the article as a whole. An
            // unnamed variant never matches one pack's offer.
            $applies = $rowVariantId === null || $rowVariantId === $variantId;

            if (! $applies) {
                continue;
            }

            if ($assignment->available_from !== null && $day->lessThan($assignment->available_from)) {
                continue;
            }

            if ($assignment->available_to !== null && $day->greaterThan($assignment->available_to)) {
                continue;
            }

            return true;
        }

        return false;
    }
}
