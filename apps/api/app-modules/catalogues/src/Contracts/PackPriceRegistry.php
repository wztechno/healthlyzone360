<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Contracts;

use Healthy360\Catalogues\Models\CatalogueItem;

/**
 * An item's active packs, each with what it is made of and its price on the
 * Home shop and Business public tariffs.
 *
 * **A port, for the reason {@see SellingPlaceRegistry} is one**: a place's price
 * lives on its public tariff, which only pricing can name. Dish margins asks it;
 * pricing answers it with the Packs & prices tab's own read, and
 * `NullPackPriceRegistry` is the answer when nothing does — no packs at all.
 *
 * There is no counter price: the counter charges the Home shop's.
 */
interface PackPriceRegistry
{
    /**
     * Default pack first, then in the order they were made. A price is the
     * pack's own standing row, or the item's pack-less one (`inherited`); null
     * when there is neither, or the place has no channel with a tariff.
     *
     * @return list<array{
     *     id: string,
     *     code: string,
     *     name_en: string|null,
     *     fill: array{quantity: string, unit: string},
     *     components: list<array{ingredient_id: string, quantity: string, is_container: bool}>,
     *     prices: array{
     *         home: array{amount_minor: int, currency_code: string, inherited: bool}|null,
     *         business: array{amount_minor: int, currency_code: string, inherited: bool}|null,
     *     },
     * }>
     */
    public function packPricesOf(CatalogueItem $item): array;
}
