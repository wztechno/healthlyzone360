<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Illuminate\Database\Eloquent\Collection;

/**
 * What a delivery's prices say about it, stamped once when a line is priced.
 *
 * Both receipt writers call this inside their transaction, so a delivery priced at
 * the door and one priced a week later are held to one rule. Nothing here stops
 * goods being received or costed: the food is on the shelf and the blend is a fact.
 * What an approval holds back is the payment, in {@see Payables}.
 *
 * **A difference needs two prices that mean the same thing.** The comparison is with
 * the last priced delivery of that shelf before this one, from any supplier, and
 * only in the same currency. A price per kilo against a price per gram is brought
 * into the line's unit first (mass and volume only, {@see UnitConversionService});
 * anything else leaves the variance null: there is no exchange rate here, and a
 * price per box against a price per kilo would be a number nobody asked for. A
 * first purchase has nothing to compare. A rise too large to store is stored as the
 * largest the column holds, so it still waits for approval.
 *
 * **Only rises wait.** A price that fell needs nobody's approval. A receipt already
 * approved goes back to pending if a line priced later is over the limit.
 */
final readonly class ReceiptPriceControl
{
    private const int PERCENT_SCALE = 2;

    /** The largest figure `price_variance_percent`, a decimal(10,2), holds. */
    private const string MAX_PERCENT = '99999999.99';

    public function __construct(
        private LastPurchasePriceQuery $lastPrices,
        private KitchenServiceSettingsLookup $settings,
        private StaffAlerts $alerts,
        private UnitConversionService $conversion,
    ) {}

    /**
     * Compare every priced line not yet compared. Sets the receipt's approval state;
     * the caller saves the receipt.
     */
    public function review(GoodsReceipt $receipt): void
    {
        $lines = GoodsReceiptLine::query()
            ->where('goods_receipt_id', $receipt->getKey())
            ->whereNotNull('unit_price_amount')
            ->whereNull('price_variance_percent')
            ->get();

        if ($lines->isEmpty()) {
            return;
        }

        $organisationId = $receipt->organisation_id;
        $stockItemIds = $lines->pluck('stock_item_id')->unique()->values()->all();
        $last = $this->lastPrices->perItem($organisationId, $stockItemIds, $receipt->received_at);
        $stockUnits = StockItem::query()->whereKey($stockItemIds)->pluck('unit_id', 'id');
        $units = MeasurementUnit::query()
            ->whereKey(array_values(array_unique(array_filter([
                ...$stockUnits->values()->all(),
                ...$lines->pluck('unit_id')->all(),
                ...array_column($last, 'unit_id'),
            ]))))
            ->get()
            ->keyBy(static fn (MeasurementUnit $unit): string => (string) $unit->getKey());
        $limit = $this->settings->for($organisationId)->price_approval_above_percent;
        $overLimit = false;

        foreach ($lines as $line) {
            $previous = $last[$line->stock_item_id] ?? null;

            if ($previous === null || bccomp($previous['unit_price_amount'], '0', 6) <= 0) {
                continue;
            }

            if ($previous['cost_currency_code'] !== $line->cost_currency_code) {
                continue;
            }

            $stockUnit = isset($stockUnits[$line->stock_item_id]) ? (string) $stockUnits[$line->stock_item_id] : null;
            $lastPrice = $this->inLineUnit(
                $previous['unit_price_amount'],
                $previous['unit_id'] ?? $stockUnit,
                $line->unit_id ?? $stockUnit,
                $units,
            );

            if ($lastPrice === null) {
                continue;
            }

            /** @var numeric-string $price */
            $price = (string) $line->unit_price_amount;

            // A rise past the decimal(10,2) column, or a last price that rounds to nothing
            // in this line's unit (0.40/kg compared per mg), is almost always a unit slip:
            // the line most likely to put a wrong payable on the books. It is stored as the
            // largest rise the column holds, so the limit below holds the payment for a
            // person. A fall is never past it: the most a price can fall is 100%.
            $variance = bccomp($lastPrice, '0', 6) <= 0
                ? self::MAX_PERCENT
                : bcmul(bcdiv(bcsub($price, $lastPrice, 6), $lastPrice, 8), '100', self::PERCENT_SCALE);

            if (bccomp($variance, self::MAX_PERCENT, self::PERCENT_SCALE) > 0) {
                $variance = self::MAX_PERCENT;
            }

            $line->last_unit_price_amount = $lastPrice;
            $line->price_variance_percent = $variance;
            $line->save();

            $overLimit = $overLimit || ($limit !== null && bccomp($variance, (string) $limit, self::PERCENT_SCALE) > 0);
        }

        if ($overLimit) {
            $receipt->price_approval_status = 'pending';

            $this->alerts->send(StaffAlertType::PriceApproval, $organisationId, (string) $receipt->getKey(), [
                'order_number' => $receipt->supplier?->name_en ?? (string) $receipt->received_on?->toDateString(),
            ]);
        }
    }

    /**
     * The last price, per the unit this line is priced in. The same unit needs
     * nothing; a pair the conversion service refuses (a box against a kilo, two
     * different count units) or an unknown unit has no answer.
     *
     * @param  numeric-string  $price
     * @param  Collection<string, MeasurementUnit>  $units
     * @return numeric-string|null
     */
    private function inLineUnit(string $price, ?string $previousUnitId, ?string $lineUnitId, Collection $units): ?string
    {
        if ($previousUnitId === $lineUnitId) {
            return $price;
        }

        $previousUnit = $previousUnitId === null ? null : $units->get($previousUnitId);
        $lineUnit = $lineUnitId === null ? null : $units->get($lineUnitId);

        if (! $previousUnit instanceof MeasurementUnit || ! $lineUnit instanceof MeasurementUnit
            || ! $this->conversion->canConvert($lineUnit, $previousUnit)) {
            return null;
        }

        // A price per previous unit, times the previous units in one line unit.
        return $this->conversion->convert($price, $lineUnit, $previousUnit);
    }

    /**
     * Whether this delivery is owed for, and when. A direct purchase was paid on the
     * day. Without a number of days on the supplier there is no due date until a
     * person sets one. The caller saves the receipt.
     */
    public function openPayable(GoodsReceipt $receipt): void
    {
        if ($receipt->supplier_id === null) {
            $receipt->payment_status = 'not_tracked';

            return;
        }

        $receipt->payment_status = 'unpaid';

        $days = Supplier::query()->whereKey($receipt->supplier_id)->value('payment_due_days');
        $from = $receipt->invoice_date ?? $receipt->received_on;

        if ($days !== null && $from !== null) {
            $receipt->due_on = $from->addDays((int) $days);
        }
    }
}
