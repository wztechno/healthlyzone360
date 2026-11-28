<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Contracts\PackPriceRegistry;
use Healthy360\Catalogues\Models\CatalogueItem;

/**
 * The answer when no module prices anything: no packs, so Dish margins says
 * `no_pack` rather than invent a price.
 */
final class NullPackPriceRegistry implements PackPriceRegistry
{
    /**
     * @return list<array{id: string, code: string, name_en: string|null, fill: array{quantity: string, unit: string}, components: list<array{ingredient_id: string, quantity: string, is_container: bool}>, prices: array{home: array{amount_minor: int, currency_code: string, inherited: bool}|null, business: array{amount_minor: int, currency_code: string, inherited: bool}|null}}>
     */
    public function packPricesOf(CatalogueItem $item): array
    {
        return [];
    }
}
