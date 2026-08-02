<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

/**
 * The answer to "what does this cost", when there is one.
 *
 * A value object rather than an array, so the two halves of a monetary value
 * cannot be separated on the way out. `amountMinor` alone is meaningless —
 * 4 500 is 45 AED or 45 USD or 4 500 LBP — and the master plan's rule that
 * every amount carries its currency (§4.4) is only enforceable if the type
 * makes carrying it the path of least resistance.
 *
 * `amountMinor` is non-nullable **by construction**: the resolver returns this
 * object or `null`, never this object with an empty amount in it. A
 * placeholder is not a price with a missing number, it is the absence of a
 * price, and giving it a home in this shape would push every caller into a
 * null check they did not know they needed.
 *
 * `priceListId` and `priceListItemId` are carried because C1's order snapshot
 * has to record not merely what was charged but *which row said so* — the
 * standing row will be closed one day, and an order that only recorded the
 * number would lose the ability to explain it.
 */
final readonly class ResolvedPrice
{
    public function __construct(
        public int $amountMinor,
        public string $currencyCode,
        public string $priceListId,
        public string $priceListItemId,
        /** The tier this price came from; null when it is the base price. */
        public ?string $minQuantity = null,
    ) {}

    /**
     * @return array{amount_minor: int, currency_code: string, price_list_id: string, price_list_item_id: string, min_quantity: string|null}
     */
    public function toArray(): array
    {
        return [
            'amount_minor' => $this->amountMinor,
            'currency_code' => $this->currencyCode,
            'price_list_id' => $this->priceListId,
            'price_list_item_id' => $this->priceListItemId,
            'min_quantity' => $this->minQuantity,
        ];
    }
}
