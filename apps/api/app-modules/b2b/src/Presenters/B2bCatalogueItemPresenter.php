<?php

declare(strict_types=1);

namespace Healthy360\B2b\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Pricing\Services\ResolvedPrice;

/**
 * Corporate catalogue rows as the buyer sees them — one price, no tariff
 * paperwork.
 */
final class B2bCatalogueItemPresenter
{
    /**
     * @return array{
     *     id: string,
     *     name: string,
     *     item_type: string,
     *     seller_organisation_id: string,
     *     sales_channel_id: string,
     *     price: array{amount_minor: int, currency_code: string}|null,
     * }
     */
    public function item(
        CatalogueItem $item,
        string $salesChannelId,
        ?ResolvedPrice $price,
        string $languageCode,
    ): array {
        return [
            'id' => (string) $item->getKey(),
            'name' => $languageCode === 'ar' ? $item->name_ar : $item->name_en,
            'item_type' => $item->item_type->value,
            'seller_organisation_id' => $item->organisation_id,
            'sales_channel_id' => $salesChannelId,
            'price' => $price === null ? null : [
                'amount_minor' => $price->amountMinor,
                'currency_code' => $price->currencyCode,
            ],
        ];
    }
}
