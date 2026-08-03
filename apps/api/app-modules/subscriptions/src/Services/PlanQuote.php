<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Services;

/**
 * What one plan configuration costs per delivery day, and how that number was
 * arrived at.
 *
 * A value object rather than an array for the reason `ResolvedPrice` gives: the
 * amount and its currency must not be separable on the way out. It carries more
 * than `ResolvedPrice` does because a subscription has to be able to explain
 * itself years later — `listPriceMinor` is what the tariff said,
 * `discountPercent` is what the duration took off, and `perDayMinor` is what
 * the customer actually pays and what a refund multiplies.
 *
 * **`discountPercent` is a nullable string and NULL means "nobody stated one".**
 * The rule `plan_variant_durations` makes, carried through the quote rather
 * than flattened to zero somewhere in the middle. It stays a string because it
 * is a decimal the database holds exactly and a float would not.
 *
 * `days` is the run's length, taken from `plan_durations.duration_days`. It is
 * the balance the subscription starts with — a twenty-day plan is twenty
 * deliveries (§1) — and it is here rather than fetched again at capture so the
 * quote and the balance cannot disagree.
 */
final readonly class PlanQuote
{
    public function __construct(
        public int $listPriceMinor,
        public ?string $discountPercent,
        public int $perDayMinor,
        public string $currencyCode,
        public int $days,
        public ?string $priceListId = null,
        public ?string $priceListItemId = null,
    ) {}

    /** What the whole run costs at this quote. */
    public function totalMinor(): int
    {
        return $this->perDayMinor * $this->days;
    }

    /**
     * @return array{list_price_minor: int, discount_percent: string|null, per_day_minor: int, currency_code: string, days: int, total_minor: int}
     */
    public function toArray(): array
    {
        return [
            'list_price_minor' => $this->listPriceMinor,
            'discount_percent' => $this->discountPercent,
            'per_day_minor' => $this->perDayMinor,
            'currency_code' => $this->currencyCode,
            'days' => $this->days,
            'total_minor' => $this->totalMinor(),
        ];
    }
}
