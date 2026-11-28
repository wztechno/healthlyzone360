<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Contracts\SellingPlaceRegistry;
use Healthy360\Catalogues\Models\CatalogueItem;

/**
 * The answer when no module prices anything: offered nowhere, priced nowhere.
 * Fail-closed, for the reason {@see NullConfirmedPriceRegistry} gives.
 */
final class NullSellingPlaceRegistry implements SellingPlaceRegistry
{
    /**
     * @return array{offered: list<'home'|'business'|'counter'>, priced: list<'home'|'business'|'counter'>}
     */
    public function placesOf(CatalogueItem $item): array
    {
        return ['offered' => [], 'priced' => []];
    }
}
