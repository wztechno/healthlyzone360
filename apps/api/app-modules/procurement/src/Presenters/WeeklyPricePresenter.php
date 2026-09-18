<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Presenters;

use Healthy360\Procurement\Models\IngredientWeeklyPrice;
use Healthy360\Procurement\Models\WeeklyPricePublication;

/**
 * Published weekly prices on the wire (PROD1).
 *
 * ## An unpriced row is a row, and it is the one worth reading
 *
 * `average_unit_amount` null with `source: unpriced` says nobody could price this
 * ingredient this week. That is the requirement's "flag ingredients with no
 * purchase history", and it is published as a row rather than as an absence
 * precisely so a buyer can act on it. Rendering it as zero would say the
 * ingredient is free; leaving it out would say the list is complete.
 *
 * ## Carried rows say where they came from and why
 *
 * `carry_reason` and `carried_from_week_start_date` travel with every carried
 * price, so a surface can explain itself rather than showing last week's number
 * as though it were this week's. The four reasons are different problems with
 * different fixes — nothing was bought, the week's purchases were in two
 * currencies, every line was unpriced, or the ingredient's unit changed to one
 * the old price cannot convert into — and collapsing them to "carried" would put
 * the ingredient whose unit nobody can convert in the same bucket as the one the
 * kitchen simply did not buy.
 */
final readonly class WeeklyPricePresenter
{
    /**
     * @return array<string, mixed>
     */
    public function price(IngredientWeeklyPrice $price): array
    {
        return [
            'id' => (string) $price->getKey(),
            'ingredient_id' => (string) $price->ingredient_id,
            // Beside the id for the reason every other list carries a name: a
            // price list rendered as a column of uuids is a price list nobody
            // can shop from.
            'ingredient_name_en' => $price->ingredient?->name_en,
            'weekly_price_publication_id' => (string) $price->weekly_price_publication_id,
            'purchase_week_start_date' => $price->purchase_week_start_date->toDateString(),
            'purchase_week_end_date' => $price->purchase_week_end_date->toDateString(),
            'effective_from_date' => $price->effective_from_date->toDateString(),
            'unit_id' => $price->unit_id,
            'unit_code' => $price->unit?->code,
            'average_unit_amount' => $price->average_unit_amount,
            'currency_code' => $price->currency_code,
            'total_quantity' => $price->total_quantity,
            'total_cost_amount' => $price->total_cost_amount,
            'receipt_line_count' => $price->receipt_line_count,
            'unpriced_line_count' => $price->unpriced_line_count,
            'has_unpriced_lines' => $price->has_unpriced_lines,
            'source' => $price->source->value,
            'carry_reason' => $price->carry_reason?->value,
            'carried_from_week_start_date' => $price->carried_from_week_start_date?->toDateString(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function publication(WeeklyPricePublication $publication): array
    {
        return [
            'id' => (string) $publication->getKey(),
            'purchase_week_start_date' => $publication->purchase_week_start_date->toDateString(),
            'purchase_week_end_date' => $publication->purchase_week_end_date->toDateString(),
            'effective_from_date' => $publication->effective_from_date->toDateString(),
            // The clock the week boundaries were resolved in, published because
            // "the week of the 14th" means two different spans in Beirut and
            // Dubai and a reader reconciling a total needs to know which.
            'timezone' => $publication->timezone,
            'published_at' => $publication->published_at->toIso8601String(),
            'ingredient_count' => $publication->ingredient_count,
            'computed_count' => $publication->computed_count,
            'carried_count' => $publication->carried_count,
            'unpriced_count' => $publication->unpriced_count,
            'late_line_count' => $publication->late_line_count,
            // A published row is never rewritten, so a receipt priced after the
            // fact cannot move the week's average. This says the basis has since
            // moved, which is the honest half of that promise.
            'has_late_receipts' => $publication->has_late_receipts,
            'supersedes_id' => $publication->supersedes_id,
        ];
    }
}
