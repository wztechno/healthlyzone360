<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Orders\Exceptions\PlacementRefused;
use Healthy360\Orders\Services\ComposedLine;
use Healthy360\Orders\Services\ComposedPlacement;
use Healthy360\Orders\Services\OrderPlacementService;
use Healthy360\Orders\Services\PriceOverride;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * The order an accepted quotation becomes (2026-10-20).
 *
 * Accepting used to change the quotation's status and nothing else, so an
 * agreed price never reached the kitchen: no order on its calendar, nothing in
 * its buy list, nothing to cook. Now acceptance places one order through the
 * same composed placement the desk and subscription generation use — every
 * gate the kitchen relies on still applies (trading status, address, zone,
 * window, cut-off, the buyer's account checks) — with each line carrying the
 * kitchen's quoted unit price as a {@see PriceOverride::QUOTATION}, so the
 * order charges what was agreed rather than today's tariff.
 *
 * **The channel** is the kitchen's private-pricing channel that offers the
 * quotation's first article, the one the buyer browsed it on; any other active
 * private channel of the kitchen is the fallback. A kitchen with none cannot
 * take a wholesale order at all, and says so.
 *
 * **Branch** is left to the zone, exactly as a B2B basket leaves it: the cart a
 * corporate buyer checks out carries no branch either.
 *
 * Idempotent on the quotation: a retried acceptance answers with the order
 * the first one placed instead of placing a second.
 */
final readonly class QuotationOrderPlacer
{
    public function __construct(private OrderPlacementService $placement) {}

    /**
     * @return string the placed order's id
     *
     * @throws PlacementRefused|ApiException
     */
    public function place(
        Quotation $quotation,
        string $kitchenOrganisationId,
        CustomerAccount $buyer,
        CustomerAddress $address,
        CarbonImmutable $deliveryDate,
        string $deliveryWindowCode,
    ): string {
        $lines = QuotationLine::withoutTenancy()
            ->where('quotation_id', $quotation->getKey())
            ->orderBy('line_number')
            ->get();

        $channelId = $this->channelFor($kitchenOrganisationId, (string) ($lines->first()?->catalogue_item_id ?? ''));

        $composed = [];

        foreach ($lines as $line) {
            $composed[] = new ComposedLine(
                catalogueItemId: (string) $line->catalogue_item_id,
                catalogueItemVariantId: $line->catalogue_item_variant_id === null ? null : (string) $line->catalogue_item_variant_id,
                quantity: $this->quantity((string) $line->quantity),
                price: new PriceOverride((int) $line->unit_amount_minor, $quotation->currency_code, PriceOverride::QUOTATION),
            );
        }

        $result = $this->placement->placeComposed(
            new ComposedPlacement(
                account: $buyer,
                address: $address,
                organisationId: $kitchenOrganisationId,
                salesChannelId: $channelId,
                branchId: null,
                currencyCode: $quotation->currency_code,
                lines: $composed,
                deliveryWindowCode: $deliveryWindowCode,
                requestedDate: $deliveryDate,
            ),
            'quotation:'.$quotation->getKey(),
        );

        return (string) $result->order->getKey();
    }

    /**
     * @throws ApiException
     */
    private function channelFor(string $kitchenOrganisationId, string $firstItemId): string
    {
        $private = SalesChannel::withoutTenancy()
            ->where('organisation_id', $kitchenOrganisationId)
            ->where('status', SalesChannelStatus::Active->value)
            ->get()
            ->filter(static fn (SalesChannel $channel): bool => $channel->channel_kind->hasPrivatePricing())
            ->values();

        if ($private->isEmpty()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This kitchen has no wholesale channel open, so an accepted quotation cannot become an order.',
            );
        }

        $offering = ChannelCatalogueItem::withoutTenancy()
            ->whereIn('sales_channel_id', $private->map(static fn (SalesChannel $channel): string => (string) $channel->getKey())->all())
            ->where('catalogue_item_id', $firstItemId)
            ->value('sales_channel_id');

        return is_string($offering) ? $offering : (string) $private->first()->getKey();
    }

    /** `40.0000` → `40`: the quantity as the basket would have written it. */
    private function quantity(string $stored): string
    {
        return str_contains($stored, '.') ? rtrim(rtrim($stored, '0'), '.') : $stored;
    }
}
