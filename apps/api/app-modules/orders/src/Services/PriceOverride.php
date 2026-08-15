<?php

declare(strict_types=1);

namespace Healthy360\Orders\Services;

/**
 * A price the caller supplies, and the reason it is allowed to.
 *
 * **`OrderPlacementService` reprices every line at placement.** That rule is
 * the whole design of C1 and it is not weakened here: this object is the single
 * named exception, and it exists because S1's approved semantics create one.
 * A live subscription keeps the per-day price captured at purchase for its
 * entire balance (§5, "grandfathered"), so the order generated for a
 * subscription delivery must charge the captured number and not today's tariff
 * — otherwise a kitchen's price rise reaches a customer who was promised it
 * would not, and the cash the courier collects at the door disagrees with the
 * arrangement the customer signed up to.
 *
 * **`source` is not decoration.** It is written to `order_lines.price_source`
 * and it is what lets a reconciliation that finds an order line disagreeing
 * with the standing price list read the reason instead of raising a
 * discrepancy. The column's CHECK admits exactly the values this class is
 * allowed to carry, so a caller cannot invent a provenance by passing a string.
 *
 * The currency travels with the amount, as every amount on this platform does
 * (§4.4). A placement whose override prices in a currency the order is not
 * denominated in is refused rather than converted — the same refusal a resolved
 * price in the wrong currency earns, and for the same reason: there is no
 * exchange rate anybody quoted.
 */
final readonly class PriceOverride
{
    /** The grandfathered per-day price of a subscription plan line. */
    public const string SUBSCRIPTION_CAPTURE = 'subscription_capture';

    /**
     * A dish that makes up a subscription day, listed at zero because the
     * plan-day line beside it has already charged for it. The kitchen gets a
     * picking list and the customer a record of what was sent, without the
     * order's total counting the food twice.
     */
    public const string SUBSCRIPTION_INCLUDED = 'subscription_included';

    public function __construct(
        public int $unitPriceMinor,
        public string $currencyCode,
        public string $source = self::SUBSCRIPTION_CAPTURE,
    ) {}
}
