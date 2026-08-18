<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * How much of each ordered line has actually turned up (§3.5, §4).
 *
 * One question with three readers — the receiving guard that refuses an
 * over-receipt, the order detail that prints Ordered / Received / Outstanding,
 * and the receivable-orders picker that prefills a delivery form — so it is one
 * piece of arithmetic rather than three that could drift apart. §4 is explicit
 * that "ordered lines are prefilled with their outstanding quantity", and a
 * prefill that disagreed with the guard behind it would be a form that refuses
 * what it just suggested.
 *
 * ## The unit is the shelf's own, and the conversion is why this exists
 *
 * An order line's quantity is in the stock item's unit. A receipt line's is in
 * the unit its **price** was quoted per — a delivery note reading "flour, 2 kg
 * at 3.00/kg" against a shelf counted in grams. So a raw `SUM(quantity)` would
 * add two kilograms to a five-thousand-gram order and call it nearly nothing.
 * Every receipt line is converted through the same `UnitConversionService` the
 * stock movement used, so "received" means exactly what the shelf shows.
 *
 * ## One query, whatever the caller asked for
 *
 * The order-detail read hands over a whole order's lines and the picker hands
 * over several orders' worth; both cost one query for the order lines and one
 * for the receipt lines, never one per row. That is the same rule
 * {@see LastPurchasePriceQuery} and {@see OrderProposalService} are built around,
 * and §3.4's "verify the query does not become N+1" applies just as much to a
 * supplier page with ninety lines on it.
 *
 * Only receipt lines that **name** an order line count. An unplanned extra item
 * on a delivery is a real receipt of something else, not progress against what
 * was asked for (§4).
 */
final readonly class ReceivedQuantityQuery
{
    /** bcmath scale, matching `decimal(14,4)` on order and stock quantities. */
    private const int SCALE = 4;

    public function __construct(private UnitConversionService $conversion) {}

    /**
     * The quantity received against each named order line, in the shelf's unit.
     *
     * Lines with nothing against them are absent rather than zero, so a caller
     * reads `$received[$id] ?? '0'` and never has to distinguish "no deliveries"
     * from "a deliberate zero".
     *
     * @param  list<string>  $purchaseOrderLineIds
     * @return array<string, numeric-string>
     */
    public function byOrderLine(array $purchaseOrderLineIds): array
    {
        if ($purchaseOrderLineIds === []) {
            return [];
        }

        /** @var Collection<int, GoodsReceiptLine> $lines */
        $lines = GoodsReceiptLine::query()
            ->whereIn('purchase_order_line_id', $purchaseOrderLineIds)
            ->with('stockItem')
            ->get();

        $totals = [];

        foreach ($lines as $line) {
            $key = (string) $line->purchase_order_line_id;
            $stockItem = $line->stockItem;

            $quantity = $stockItem instanceof StockItem
                ? $this->inStockUnit($this->numeric((string) $line->quantity), $line->unit_id, $stockItem)
                : $this->numeric((string) $line->quantity);

            $totals[$key] = bcadd($totals[$key] ?? '0', $quantity, self::SCALE);
        }

        return $totals;
    }

    /**
     * Ordered, received and outstanding for every line of these orders.
     *
     * Keyed by purchase-order line id. `outstanding` is floored at zero: an
     * over-receipt is a real event the variance note records, and a negative
     * "still to come" on a screen would be an arithmetic curiosity rather than
     * an instruction.
     *
     * @param  list<string>  $purchaseOrderIds
     * @return array<string, array{ordered: numeric-string, received: numeric-string, outstanding: numeric-string}>
     */
    public function progressForOrders(array $purchaseOrderIds): array
    {
        if ($purchaseOrderIds === []) {
            return [];
        }

        /** @var Collection<int, PurchaseOrderLine> $orderLines */
        $orderLines = PurchaseOrderLine::query()->whereIn('purchase_order_id', $purchaseOrderIds)->get();

        $received = $this->byOrderLine(
            array_values($orderLines->map(static fn (PurchaseOrderLine $line): string => (string) $line->getKey())->all()),
        );

        $progress = [];

        foreach ($orderLines as $line) {
            $key = (string) $line->getKey();
            $ordered = $this->numeric((string) $line->quantity);
            $got = $received[$key] ?? '0';
            $outstanding = bcsub($ordered, $got, self::SCALE);

            $progress[$key] = [
                'ordered' => $ordered,
                'received' => $got,
                'outstanding' => bccomp($outstanding, '0', self::SCALE) > 0 ? $outstanding : bcadd('0', '0', self::SCALE),
            ];
        }

        return $progress;
    }

    /**
     * A receipt quantity in the stock item's own unit.
     *
     * When either unit is unknown the quantity is taken as already in stock units
     * — the honest fallback for a stock item INV1.0 left without a resolved
     * `unit_id`, and the same fallback the stock movement itself makes.
     *
     * @param  numeric-string  $quantity
     * @return numeric-string
     */
    private function inStockUnit(string $quantity, ?string $purchaseUnitId, StockItem $stockItem): string
    {
        $purchaseUnit = $purchaseUnitId === null ? null : MeasurementUnit::query()->find($purchaseUnitId);
        $stockUnit = $stockItem->unit_id === null ? null : MeasurementUnit::query()->find($stockItem->unit_id);

        if ($purchaseUnit instanceof MeasurementUnit && $stockUnit instanceof MeasurementUnit) {
            return $this->conversion->convert($quantity, $purchaseUnit, $stockUnit);
        }

        return $quantity;
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Received-quantity arithmetic received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
