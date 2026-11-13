<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Inventory\Models\OrderLineEstimatedCost;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Models\OrderLine;
use Healthy360\Recipes\Services\WeeklyLineCost;
use Healthy360\Recipes\Services\WeeklyRecipeCostingService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * What a sold line was **expected** to cost, written once at confirm (PROD1).
 *
 * ## Why this is not computed on the report
 *
 * The monthly report can already say what a month's sales actually cost — the
 * consume movements carry their moving-average valuation and sum to COGS. What it
 * cannot say afterwards is what those sales were expected to cost, because
 * re-deriving that later answers a different question: a recipe edited in October
 * would change September's estimated margin, and a weekly price published on
 * Monday would change last month's. Both are wrong, and both are silent.
 *
 * So the figure is frozen here, from the prices standing at the moment the order
 * was confirmed, with the publication it stood on recorded beside it.
 *
 * ## It runs on the rows the deduction already produced
 *
 * The explosion is expensive and the confirm path is hot, so nothing is exploded
 * twice: `OrderConsumptionService` collects what each line actually drew — in the
 * shelf's own unit, which is also the unit the estimate is priced in — and hands
 * it over. A line that drew nothing (no recipe, no shelf) produces no rows and
 * therefore no estimate, which is the honest answer.
 *
 * ## A missing estimate is an absence, never a zero
 *
 * Any ingredient the costing layer cannot price, or two currencies across one
 * line, and **no row is written**. The report counts the absences and flags the
 * month rather than summing what happened to be priceable: an estimated margin
 * over the priced half reads exactly like a complete one and is too high.
 *
 * ## Writing is best-effort by construction
 *
 * A duplicate on `order_line_id` is a confirm that ran twice, which is a success
 * rather than a fault: the first estimate stands, and it is the one computed at
 * the prices of the moment. Swallowed here rather than left to abort a confirm —
 * a kitchen does not lose an order because a reporting figure could not be
 * written.
 *
 * **The nested transaction is what makes that swallow real**, and it is
 * `DeliveryJobProjector`'s reasoning word for word: in PostgreSQL any error
 * aborts the enclosing transaction, so catching the 23505 in PHP does not undo
 * it — every later statement fails with *current transaction is aborted* until
 * a rollback. A nested `DB::transaction` is a `SAVEPOINT` the duplicate unwinds
 * to, leaving the caller's transaction usable.
 *
 * Without it this was not best-effort but fatal, and on exactly the path that
 * always finds its own earlier estimate: `OrderConsumptionService::retry()`
 * wraps a retry in one transaction, so the duplicate written here poisoned it
 * and every open stock gap failed with 25P02 instead of retrying. That is what
 * `ConsumptionExceptionSweep` was reporting, once per gap, every five minutes.
 */
final readonly class OrderLineEstimator
{
    private const int SCALE = 6;

    private const int WORKING_SCALE = 12;

    public function __construct(private WeeklyRecipeCostingService $costing) {}

    /**
     * Freeze this line's estimate, or write nothing and say why by its absence.
     *
     * @param  list<array{ingredient_id: string, stock_unit_id: string, quantity: numeric-string}>  $rows  what the line actually drew, in each shelf's own unit
     */
    public function record(Order $order, OrderLine $line, array $rows): void
    {
        if ($rows === []) {
            return;
        }

        $unitByIngredient = [];

        foreach ($rows as $row) {
            $unitByIngredient[$row['ingredient_id']] = $row['stock_unit_id'];
        }

        $costs = $this->costing->unitCostsFor((string) $order->organisation_id, $unitByIngredient);

        $total = '0';
        $currency = null;
        $publicationId = null;

        foreach ($rows as $row) {
            $cost = $costs[$row['ingredient_id']] ?? null;

            if (! $cost instanceof WeeklyLineCost || ! $cost->isCosted() || $cost->currencyCode === null) {
                // One unpriceable ingredient withholds the whole line. Summing
                // the rest would publish a figure that is real, smaller and
                // indistinguishable from a complete one.
                return;
            }

            $lineCurrency = $cost->currencyCode;

            if ($currency === null) {
                $currency = $lineCurrency;
            } elseif ($currency !== $lineCurrency) {
                // No exchange rate exists anywhere in this system, and inventing
                // one to make a margin look tidy would be the worst number on
                // the report.
                return;
            }

            $publicationId ??= $this->publicationOf($cost);

            $unitCost = $cost->unitCostAmount;

            if ($unitCost === null) {
                return;
            }

            $total = bcadd(
                $total,
                bcmul($row['quantity'], $unitCost, self::WORKING_SCALE),
                self::WORKING_SCALE,
            );
        }

        try {
            // Wrapped even though it is a single statement: the SAVEPOINT is the
            // only reason the catch below can be a swallow rather than a wound.
            DB::transaction(function () use ($order, $line, $total, $currency, $publicationId): void {
                $estimate = new OrderLineEstimatedCost;
                $estimate->organisation_id = (string) $order->organisation_id;
                $estimate->order_id = (string) $order->getKey();
                $estimate->order_line_id = (string) $line->getKey();
                $estimate->estimated_cost_amount = $this->round($total);
                $estimate->currency_code = $currency;
                $estimate->weekly_price_publication_id = $publicationId;
                $estimate->save();
            });
        } catch (QueryException $exception) {
            // 23505 on `order_line_id`: a confirm delivered twice. The first
            // estimate stands and is the right one — it was computed at the
            // prices of the moment. Any other SQLSTATE is a real failure.
            if ($exception->getCode() !== '23505') {
                throw $exception;
            }
        }
    }

    /**
     * The publication a weekly-priced line stood on, where there is one.
     *
     * Null on a component or fallback figure, which has no week — and null is
     * then the honest answer for the line rather than the first publication that
     * happened to appear among its ingredients.
     */
    private function publicationOf(WeeklyLineCost $cost): ?string
    {
        return $cost->source === WeeklyLineCost::SOURCE_WEEKLY ? $cost->publicationId : null;
    }

    /**
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function round(string $value): string
    {
        $half = '0.'.str_repeat('0', self::SCALE).'5';

        return bcadd($value, str_starts_with($value, '-') ? '-'.$half : $half, self::SCALE);
    }
}
