<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Healthy360\Orders\Services\ComposedLine;
use InvalidArgumentException;

/**
 * Turning what somebody tapped into what an order may hold.
 *
 * A desk agent building a sale taps the same article more than once — that is
 * how a counter works, three coffees is three taps — and `order_lines` will not
 * take that. `order_lines_one_row_per_article` is a unique index over
 * `(order_id, catalogue_item_id, catalogue_item_variant_id)` **`NULLS NOT
 * DISTINCT`**, so the variant-less shape is one row per article rather than one
 * row per null, and two lines naming the same coffee are a unique violation
 * rather than a bigger order. `OrderPlacementService` never aggregates —
 * deliberately, because a *basket* cannot present the same article twice
 * (`cart_items` has its own uniqueness and `CartService::addItem` merges) — so a
 * duplicate tap reaching placement unmerged surfaces as a raw SQLSTATE 23505
 * from inside a transaction. Not a refusal a client can render: a 500.
 *
 * ## Why this is a service and not a request rule
 *
 * Because two endpoints have to do it **identically**. The quote endpoint prices
 * a basket and the placement endpoint places it, and a quote that priced three
 * separate coffees while the placement merged them into one line of three would
 * be a total the customer was shown and a total they were charged, differing for
 * a reason nobody could see. Aggregation is part of what the basket *means*, not
 * a validation step, so it lives where both callers reach it rather than in a
 * FormRequest one of them happens to use.
 *
 * ## What it does, exactly
 *
 * Quantities are summed with `bcadd` at scale 6 — the platform's arithmetic
 * scale, and a string sum rather than a float one for the same reason
 * `order_lines.quantity` is a decimal column: a quantity that round-trips
 * through a float acquires a fifteenth decimal place and a line total nobody can
 * reproduce.
 *
 * **First-seen order is preserved.** The merged line takes the position of the
 * first tap that named the article, so a desk agent reading the sale back sees
 * it in the order they built it. An aggregate keyed by hash and then sorted
 * would be a list nobody assembled.
 *
 * **The price is left null.** A desk line is priced by the standing tariff at
 * placement, exactly as a basket line is — `PriceOverride` exists for one
 * caller, subscription generation grandfathering a subscriber's per-day price,
 * and a counter sale is not that. Charging a walk-in a number the desk supplied
 * rather than one the kitchen's own price list says would put the tariff outside
 * the tariff.
 */
final readonly class DeskBasket
{
    /**
     * The platform's arithmetic scale. Quantities are summed at six decimal
     * places and stored in a `decimal(12, 4)` column, which is the same
     * relationship every other quantity on the platform has to its column: the
     * working figure is never coarser than what is kept.
     */
    private const int SCALE = 6;

    /**
     * Merge a tapped basket into one line per article.
     *
     * @param  list<array{catalogue_item_id: string, catalogue_item_variant_id?: string|null, quantity: string}>  $lines
     * @return list<ComposedLine>
     */
    public function aggregate(array $lines): array
    {
        /** @var array<string, array{item: string, variant: string|null, quantity: numeric-string}> $merged */
        $merged = [];

        foreach ($lines as $line) {
            $itemId = $line['catalogue_item_id'];
            $variantId = $line['catalogue_item_variant_id'] ?? null;

            // The key mirrors the unique index, including its `NULLS NOT
            // DISTINCT` half: an article ordered plain and the same article
            // ordered in a pack are two different things to sell and two rows
            // the index will happily take, so they must stay two lines here. The
            // empty string stands in for the null so that the two shapes cannot
            // collide through a coincidence of identifiers.
            $key = $itemId.'|'.($variantId ?? '');

            if (! array_key_exists($key, $merged)) {
                $merged[$key] = ['item' => $itemId, 'variant' => $variantId, 'quantity' => '0'];
            }

            $merged[$key]['quantity'] = bcadd($merged[$key]['quantity'], $this->numeric($line['quantity']), self::SCALE);
        }

        return array_values(array_map(
            static fn (array $line): ComposedLine => new ComposedLine(
                catalogueItemId: $line['item'],
                catalogueItemVariantId: $line['variant'],
                quantity: $line['quantity'],
            ),
            $merged,
        ));
    }

    /**
     * bcmath handed a non-numeric string returns zero rather than erroring, so a
     * malformed quantity would silently merge to nothing and sell the article
     * free. This turns that into a loud failure instead — the same guard
     * `OrderConsumptionService` puts in front of its own arithmetic, and needed
     * more here than there, because these strings arrive from a request body.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new InvalidArgumentException("A desk basket line carried a non-numeric quantity [{$value}].");
        }

        return $value;
    }
}
