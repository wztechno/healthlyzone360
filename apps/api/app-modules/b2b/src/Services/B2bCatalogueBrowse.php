<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\SalesChannelStatus;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Pricing\Contracts\BuyerAgreementLookup;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Support\Collection;

/**
 * Articles a corporate buyer may browse on private channels they hold
 * agreements for.
 */
final readonly class B2bCatalogueBrowse
{
    public function __construct(
        private BuyerAgreementLookup $agreements,
        private PriceResolver $prices,
        private DatabaseTenantContext $tenantContext,
    ) {}

    /**
     * @return list<array{item: CatalogueItem, sales_channel_id: string, price: ResolvedPrice, pack: array{size: string, unit: string}|null}>
     */
    public function items(CustomerAccount $buyer, CarbonImmutable $on): array
    {
        $this->assertCorporateBuyer($buyer);

        $channels = $this->agreedChannels($buyer, $on);

        $presented = [];

        foreach ($channels as $channel) {
            foreach ($this->offeredItems($channel, $on) as $item) {
                // Priced under the seller's tenant, as `LineProbe` prices a basket line: the
                // buyer's ambient organisation is the corporate one, and the policy on
                // `price_list_items` would otherwise hide every row of the kitchen's tariff.
                $price = $this->tenantContext->during(null, (string) $channel->organisation_id, null, fn (): ?ResolvedPrice => $this->resolvePrice($channel, $item, $buyer, $on));

                if (! $price instanceof ResolvedPrice) {
                    continue;
                }

                $presented[] = [
                    'item' => $item,
                    'sales_channel_id' => (string) $channel->getKey(),
                    'price' => $price,
                    'pack' => CatalogueItemPackVariant::sizeOf($price->catalogueItemVariantId),
                ];
            }
        }

        return $presented;
    }

    /**
     * @return array{item: CatalogueItem, sales_channel_id: string, price: ResolvedPrice, pack: array{size: string, unit: string}|null}
     *
     * @throws ApiException
     */
    public function item(CustomerAccount $buyer, string $catalogueItemId, CarbonImmutable $on): array
    {
        $this->assertCorporateBuyer($buyer);

        $article = CatalogueItem::withoutTenancy()
            ->whereKey($catalogueItemId)
            ->where('status', CatalogueItemStatus::Published->value)
            ->first();

        if (! $article instanceof CatalogueItem) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        foreach ($this->agreedChannels($buyer, $on) as $channel) {
            if ($channel->organisation_id !== $article->organisation_id) {
                continue;
            }

            if (! $this->isOffered($channel, $article, $on)) {
                continue;
            }

            // Priced under the seller's tenant, as `LineProbe` prices a basket line: the
            // buyer's ambient organisation is the corporate one, and the policy on
            // `price_list_items` would otherwise hide every row of the kitchen's tariff.
            $price = $this->tenantContext->during(null, (string) $channel->organisation_id, null, fn (): ?ResolvedPrice => $this->resolvePrice($channel, $article, $buyer, $on));

            if ($price instanceof ResolvedPrice) {
                return [
                    'item' => $article,
                    'sales_channel_id' => (string) $channel->getKey(),
                    'price' => $price,
                    'pack' => CatalogueItemPackVariant::sizeOf($price->catalogueItemVariantId),
                ];
            }
        }

        throw new ApiException(ErrorCode::ResourceNotFound);
    }

    /**
     * The first pack this channel prices, default first, then the item-level
     * row — the same order the consumer listing and the basket use.
     *
     * Not the default pack alone. A dual-pack article's default is its B2C
     * bottle, which the wholesale tariff does not price; asking only for it
     * fell through to an item-level row that does not exist, and the article
     * vanished from the corporate catalogue although its B2B pack is priced.
     */
    private function resolvePrice(
        SalesChannel $channel,
        CatalogueItem $item,
        CustomerAccount $buyer,
        CarbonImmutable $on,
    ): ?ResolvedPrice {
        foreach ([...$this->activePackIds($item), null] as $variantId) {
            $price = $this->prices->currentFor(
                (string) $channel->getKey(),
                (string) $item->getKey(),
                $variantId,
                buyer: $buyer,
                date: $on,
            );

            if ($price instanceof ResolvedPrice) {
                return $price;
            }
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private function activePackIds(CatalogueItem $item): array
    {
        if ($item->item_type->variantType() !== VariantType::Pack) {
            return [];
        }

        return array_values(CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('status', VariantStatus::Active->value)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }

    /**
     * @return Collection<int, SalesChannel>
     */
    private function agreedChannels(CustomerAccount $buyer, CarbonImmutable $on): Collection
    {
        $channels = SalesChannel::withoutTenancy()
            ->where('status', SalesChannelStatus::Active->value)
            ->get()
            ->filter(static fn (SalesChannel $channel): bool => $channel->channel_kind->hasPrivatePricing());

        return $channels->filter(function (SalesChannel $channel) use ($buyer, $on): bool {
            if ($buyer->organisation_id === null) {
                return false;
            }

            return $this->agreements->activeAgreementFor(
                $buyer->organisation_id,
                $channel->organisation_id,
                $on,
            ) !== null;
        })->values();
    }

    /**
     * @return list<CatalogueItem>
     */
    private function offeredItems(SalesChannel $channel, CarbonImmutable $on): array
    {
        $itemIds = ChannelCatalogueItem::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('is_available', true)
            ->get()
            ->filter(fn (ChannelCatalogueItem $row): bool => $this->assignmentOpenOn($row, $on))
            ->pluck('catalogue_item_id')
            ->unique()
            ->all();

        if ($itemIds === []) {
            return [];
        }

        // `array_values` rather than the collection's own `all()`: an Eloquent collection is keyed
        // by position here, but its declared key type is not, and the `list<>` this method promises
        // is what the caller's `foreach` reads.
        return array_values(CatalogueItem::withoutTenancy()
            ->whereIn('id', $itemIds)
            ->where('organisation_id', $channel->organisation_id)
            ->where('status', CatalogueItemStatus::Published->value)
            ->orderBy('name_en')
            ->get()
            ->all());
    }

    private function isOffered(SalesChannel $channel, CatalogueItem $item, CarbonImmutable $on): bool
    {
        $assignments = ChannelCatalogueItem::withoutTenancy()
            ->where('sales_channel_id', $channel->getKey())
            ->where('catalogue_item_id', $item->getKey())
            ->where('is_available', true)
            ->get();

        foreach ($assignments as $assignment) {
            if ($this->assignmentOpenOn($assignment, $on)) {
                return true;
            }
        }

        return false;
    }

    private function assignmentOpenOn(ChannelCatalogueItem $assignment, CarbonImmutable $on): bool
    {
        if ($assignment->available_from !== null && $on->lessThan($assignment->available_from)) {
            return false;
        }

        if ($assignment->available_to !== null && $on->greaterThan($assignment->available_to)) {
            return false;
        }

        return true;
    }

    /**
     * @throws ApiException
     */
    private function assertCorporateBuyer(CustomerAccount $buyer): void
    {
        if ($buyer->account_type !== CustomerAccountType::B2b) {
            throw new ApiException(
                ErrorCode::CartChannelRefused,
                'Corporate catalogue browsing requires a corporate buyer account.',
            );
        }
    }
}
