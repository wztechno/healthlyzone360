<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Contracts;

use Healthy360\Catalogues\Models\CatalogueItem;

/**
 * Where an item is offered and where one of its packs carries a price.
 *
 * **A port, for the reason {@see ConfirmedPriceRegistry} is one.** The
 * dependency edge runs Pricing → Catalogues, and a place's price lives on the
 * place's public tariff, which only pricing can name. So the catalogue declares
 * the question and pricing answers it; `NullSellingPlaceRegistry` is the
 * fail-closed answer when nothing does.
 *
 * The three places are the Packs & prices tab's: `home` (the web shop),
 * `business` (the B2B channel) and `counter` (the order desk, priced by the
 * list it quotes from — the Home shop's while it follows it).
 */
interface SellingPlaceRegistry
{
    /**
     * `offered`: the places whose item-level offer is available today.
     * `priced`: the places on whose public tariff at least one active pack has
     * a standing confirmed base price, its own or the item's pack-less one.
     *
     * @return array{offered: list<'home'|'business'|'counter'>, priced: list<'home'|'business'|'counter'>}
     */
    public function placesOf(CatalogueItem $item): array;
}
