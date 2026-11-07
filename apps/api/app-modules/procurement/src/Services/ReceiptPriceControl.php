<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;

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
 * only in the same currency and the same unit. Anything else leaves the variance
 * null: there is no exchange rate here, and a price per box against a price per
 * kilo would be a number nobody asked for. A first purchase has nothing to compare.
 *
 * **Only rises wait.** A price that fell needs nobody's approval. A receipt already
 * approved goes back to pending if a line priced later is over the limit.
 */
final readonly class ReceiptPriceControl
{
    private const int PERCENT_SCALE = 2;

    public function __construct(
        private LastPurchasePriceQuery $lastPrices,
        private KitchenServiceSettingsLookup $settings,
        private StaffAlerts $alerts,
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
        $stockItemIds = array_values($lines->pluck('stock_item_id')->map(static fn (mixed $id): string => (string) $id)->unique()->all());
        $last = $this->lastPrices->perItem($organisationId, $stockItemIds, $receipt->received_at);
        $stockUnits = StockItem::query()->whereKey($stockItemIds)->pluck('unit_id', 'id');
        $limit = $this->settings->for($organisationId)->price_approval_above_percent;
        $overLimit = false;

        foreach ($lines as $line) {
            $previous = $last[$line->stock_item_id] ?? null;

            if ($previous === null || bccomp($previous['unit_price_amount'], '0', 6) <= 0) {
                continue;
            }

            $stockUnit = $stockUnits[$line->stock_item_id] ?? null;

            if ($previous['cost_currency_code'] !== $line->cost_currency_code
                || ($previous['unit_id'] ?? $stockUnit) !== ($line->unit_id ?? $stockUnit)) {
                continue;
            }

            /** @var numeric-string $price */
            $price = (string) $line->unit_price_amount;
            $variance = bcmul(
                bcdiv(bcsub($price, $previous['unit_price_amount'], 6), $previous['unit_price_amount'], 8),
                '100',
                self::PERCENT_SCALE,
            );

            $line->last_unit_price_amount = $previous['unit_price_amount'];
            $line->price_variance_percent = $variance;
            $line->save();

            $overLimit = $overLimit || ($limit !== null && bccomp($variance, (string) $limit, self::PERCENT_SCALE) > 0);
        }

        if ($overLimit) {
            $receipt->price_approval_status = 'pending';

            $this->alerts->send(StaffAlertType::PriceApproval, $organisationId, (string) $receipt->getKey(), [
                'order_number' => $receipt->supplier->name_en ?? (string) $receipt->received_on?->toDateString(),
            ]);
        }
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
