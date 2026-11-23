<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;
use Illuminate\Support\Collection;

/**
 * What each quotation line costs this buyer today at the kitchen's corporate
 * rate — the figure their own catalogue showed them as "Your rate" when they
 * asked — so the kitchen pricing the request can see it beside the price it is
 * about to name.
 *
 * Priced the way the buyer's catalogue prices: through the kitchen's private
 * (wholesale) channel that offers the article, the buyer's agreement list first
 * and then the channel's public tariff, at the line's quantity (so a volume
 * tier applies), the named pack or else the article's packs in order and then
 * its item-level row. A rate in another currency than the quotation's is left
 * out rather than shown beside figures it cannot be compared with.
 */
final readonly class QuotationCorporateRates
{
    public function __construct(private PriceResolver $prices) {}

    /**
     * @param  Collection<int, QuotationLine>  $lines
     * @return array<string, int> line id → unit amount in minor units; a line nothing prices is absent
     */
    public function forLines(Quotation $quotation, Collection $lines, string $kitchenOrganisationId, ?CarbonImmutable $on = null): array
    {
        if ($lines->isEmpty()) {
            return [];
        }

        $on ??= CarbonImmutable::now();

        /** @var list<string> $channelIds */
        $channelIds = array_values(SalesChannel::withoutTenancy()
            ->where('organisation_id', $kitchenOrganisationId)
            ->where('status', SalesChannelStatus::Active->value)
            ->orderBy('created_at')
            ->get()
            ->filter(static fn (SalesChannel $channel): bool => $channel->channel_kind->hasPrivatePricing())
            ->map(static fn (SalesChannel $channel): string => (string) $channel->getKey())
            ->all());

        if ($channelIds === []) {
            return [];
        }

        $itemIds = $lines->pluck('catalogue_item_id')->unique()->values()->all();

        /** @var array<string, string> $offeredOn article id → the private channel that offers it */
        $offeredOn = [];

        foreach (ChannelCatalogueItem::withoutTenancy()
            ->whereIn('sales_channel_id', $channelIds)
            ->whereIn('catalogue_item_id', $itemIds)
            ->where('is_available', true)
            ->get(['sales_channel_id', 'catalogue_item_id']) as $assignment) {
            $offeredOn[(string) $assignment->catalogue_item_id] ??= (string) $assignment->sales_channel_id;
        }

        /** @var array<string, list<string>> $packs article id → active pack ids, default first */
        $packs = [];

        foreach (CatalogueItemVariant::withoutTenancy()
            ->whereIn('catalogue_item_id', $itemIds)
            ->where('status', VariantStatus::Active->value)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->get(['id', 'catalogue_item_id']) as $variant) {
            $packs[(string) $variant->catalogue_item_id][] = (string) $variant->getKey();
        }

        $rates = [];

        foreach ($lines as $line) {
            $itemId = (string) $line->catalogue_item_id;
            $channelId = $offeredOn[$itemId] ?? $channelIds[0];
            $candidates = $line->catalogue_item_variant_id !== null
                ? [(string) $line->catalogue_item_variant_id]
                : [...($packs[$itemId] ?? []), null];

            foreach ($candidates as $variantId) {
                $price = $this->prices->currentForBuyerOrganisation(
                    $channelId,
                    $quotation->organisation_id,
                    $itemId,
                    $variantId,
                    (string) $line->quantity,
                    $on,
                );

                if ($price instanceof ResolvedPrice) {
                    if ($price->currencyCode === $quotation->currency_code) {
                        $rates[(string) $line->getKey()] = $price->amountMinor;
                    }

                    break;
                }
            }
        }

        return $rates;
    }
}
