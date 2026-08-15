<?php

declare(strict_types=1);

namespace Healthy360\Cart\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Pricing\Services\ResolvedPrice;

/**
 * What the server found when it asked whether one line is orderable.
 *
 * Either `refusals` is empty and `item` and `price` are both present, or
 * `refusals` says why not — the two are mutually exclusive by construction of
 * `LineProbe`, and `isOrderable()` is the only test a caller needs to make.
 *
 * A result object rather than an exception because the two callers want
 * different things from the same answer. `CartService` is adding one line and
 * throws immediately; `OrderPlacementService` is repricing a whole basket and
 * has to collect every bad line before it refuses, so that a customer with
 * three withdrawn articles is told about three rather than about the first.
 */
final readonly class LineProbeResult
{
    /**
     * @param  list<array<string, mixed>>  $refusals  `{reason, …context}`, empty when the line is orderable
     */
    public function __construct(
        public ?CatalogueItem $item,
        public ?CatalogueItemVariant $variant,
        public ?ResolvedPrice $price,
        public array $refusals = [],
    ) {}

    public function isOrderable(): bool
    {
        return $this->refusals === [] && $this->item instanceof CatalogueItem && $this->price instanceof ResolvedPrice;
    }
}
