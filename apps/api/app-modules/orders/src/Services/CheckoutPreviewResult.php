<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

/**
 * What `CheckoutPreviewService::preview()` gives back — a priced quotation
 * that reserves nothing and writes nothing.
 *
 * **`deliveryFeeMinor: null` is a distinct fact from `0`.** Zero is a zone
 * that charges nothing for delivery; `null` is a fee the preview could not
 * resolve at all — no address was named, the area is not served, the serving
 * zone is suspended, or the zone's own fee column has never been set.
 * Collapsing the two would tell a customer delivery is free when the honest
 * answer is "not yet known" (OQ-045).
 *
 * `totalMinor` never adds an unknown fee in to make one up: it equals
 * `subtotalMinor` whenever `deliveryFeeMinor` is null, because a total that
 * silently treated a missing fee as zero would be the same dishonesty one
 * column over.
 */
final readonly class CheckoutPreviewResult
{
    /**
     * @param  list<string>  $warnings  the stable reason vocabulary this preview reports rather than refuses on — see `CheckoutPreviewService`
     */
    public function __construct(
        public string $cartId,
        public string $currencyCode,
        public int $subtotalMinor,
        public ?int $deliveryFeeMinor,
        public int $totalMinor,
        public int $lineCount,
        public array $warnings,
    ) {}
}
