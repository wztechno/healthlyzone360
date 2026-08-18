<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Procurement\Models\PurchaseOrder;
use Healthy360\Procurement\Models\PurchaseOrderLine;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\ReferenceData\Services\UnitConversionService;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Posting a goods receipt — the delivery, the invoice, and the order it settles
 * (§3.6, §4).
 *
 * **One service and one transaction for both kinds of receipt.** §6 says to
 * extend this endpoint rather than add a second receipt-writing service, and the
 * reason is not tidiness: two writers would be two chances for the purchase
 * ledger and the stock ledger to disagree about the same delivery. A direct
 * market purchase and a delivery against an issued order take the same path
 * here; the order is an optional extra step inside it, never a separate one.
 *
 * Per line, inside that one transaction:
 *
 * 1. **Records the line**, with what was paid — unit price, line total and
 *    currency — kept on the procurement side where a landed cost belongs
 *    (never on the order, which `OrderArchitectureTest` guards), together with
 *    the order line it fulfils when there is one.
 * 2. **Raises stock.** The purchased quantity is converted from the unit the
 *    price is quoted in into the stock item's own unit (`UnitConversionService`,
 *    which refuses across dimensions rather than inventing a density) and a
 *    `receipt` movement is recorded through the locked `InventoryService`.
 * 3. **Blends the cost**, when the stock item is backed by an ingredient and the
 *    line carries a price, and stamps `costed_at` — see below.
 *
 * Then, once, for the receipt: the invoice arithmetic, the cost status, and the
 * order's own received state.
 *
 * ## Receiving never loses to a currency
 *
 * §3.6: "If that currency cannot be blended into the ingredient's existing
 * valuation currency, physical receiving must not be lost." That rule lives in
 * {@see ReceiptLineCosting}, which both this service and the late price
 * completion call, so a delivery priced on the day and one priced a week later
 * settle by the same arithmetic. `IngredientCostService::recordPurchase` keeps
 * its own invariant untouched — one average, one currency, no invented rate —
 * and the costing collaborator is the caller that knows what to do when it is
 * refused.
 *
 * `cost_status` follows from `costed_at` and nothing else — `complete` when
 * every line carries it, `unpriced` when none does, `partial` otherwise. A
 * receipt whose only line is `valuation_pending_fx` therefore reads `unpriced`,
 * and the queue row's `valuation_pending_count` is what tells a person that its
 * prices are in fact recorded and something else is blocking.
 *
 * ## Quantities are compared in the stock item's own unit
 *
 * A receipt line's quantity is in the unit its **price** is quoted per; an order
 * line's quantity is in the shelf's own unit. Outstanding, received and
 * over-receipt are all computed after the same conversion `raiseStock` performs,
 * so "two of the five kilograms have arrived" is one arithmetic rather than two
 * that could disagree.
 *
 * ## Audit metadata is counts and identifiers
 *
 * Never an amount — an audit row is readable with `audit.view_organisation`,
 * which is not the cost permission, so a figure here would route around the gate
 * — and never a key containing `code`, which `AuditRecorder` redacts blindly by
 * substring.
 *
 * @phpstan-type PreparedLine array{
 *     stock_item: StockItem,
 *     purchase_order_line_id: string|null,
 *     quantity: numeric-string,
 *     stock_quantity: numeric-string,
 *     unit_id: string|null,
 *     unit_price_amount: numeric-string|null,
 *     line_total_amount: numeric-string|null,
 *     cost_currency_code: string|null
 * }
 */
final readonly class GoodsReceiptService
{
    /** bcmath scale for quantities, matching `decimal(14,4)` on stock and order lines. */
    private const int QUANTITY_SCALE = 4;

    /** bcmath scale for money, matching `decimal(18,6)` (§4.4). */
    private const int MONEY_SCALE = 6;

    /** The receipt-level charge columns, in the order the invoice arithmetic reads them. */
    private const array CHARGE_KEYS = [
        'discount_amount',
        'tax_amount',
        'delivery_amount',
        'other_charges_amount',
        'invoice_total_amount',
    ];

    public function __construct(
        private InventoryService $inventory,
        private ReceiptLineCosting $lineCosting,
        private ReceivedQuantityQuery $received,
        private UnitConversionService $conversion,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * Record a delivery: what arrived, what it cost, and what it settles.
     *
     * The first six parameters are unchanged from INV1.1 so that every existing
     * caller keeps working; everything slice 5 adds is optional and is best
     * passed by name.
     *
     * @param  list<array{stock_item_id: string, quantity: float|string, unit_id?: string|null, unit_price_amount?: float|string|null, cost_currency_code?: string|null, purchase_order_line_id?: string|null}>  $lines
     * @param  array{discount_amount?: float|string|null, tax_amount?: float|string|null, delivery_amount?: float|string|null, other_charges_amount?: float|string|null, invoice_total_amount?: float|string|null}  $charges
     *
     * @throws ApiException
     */
    public function post(
        string $organisationId,
        string $branchId,
        ?string $supplierId,
        ?string $documentRef,
        ?string $purchaseOrderId,
        array $lines,
        ?string $receivedOn = null,
        ?string $supplierInvoiceRef = null,
        ?string $invoiceDate = null,
        array $charges = [],
        ?string $varianceNote = null,
        bool $overReceiptConfirmed = false,
        bool $closeShort = false,
        ?string $closeShortReason = null,
    ): GoodsReceipt {
        $branch = $this->branch($branchId);
        $dates = $this->dates($branch, $receivedOn);
        $chargeAmounts = $this->chargeAmounts($charges);
        $varianceNote = $this->trimmed($varianceNote);
        $closeShortReason = $this->trimmed($closeShortReason);

        if ($closeShort && $purchaseOrderId === null) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Only a delivery against a purchase order can close the rest of that order.',
                ['parameter' => 'close_short'],
            );
        }

        if ($closeShort && $closeShortReason === null) {
            // §3.5: a short delivery may be closed "with an explicit reason". A
            // blank one is not an explicit reason.
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Closing the rest of an order needs a reason.',
                ['parameter' => 'close_short_reason'],
            );
        }

        return DB::transaction(function () use (
            $organisationId,
            $branchId,
            $supplierId,
            $documentRef,
            $purchaseOrderId,
            $lines,
            $dates,
            $supplierInvoiceRef,
            $invoiceDate,
            $chargeAmounts,
            $varianceNote,
            $overReceiptConfirmed,
            $closeShort,
            $closeShortReason,
        ): GoodsReceipt {
            // The order is locked before its outstanding quantities are read, so
            // two vans unloading at once cannot both be told the same line is
            // still outstanding.
            $order = $purchaseOrderId === null
                ? null
                : $this->receivableOrder($purchaseOrderId, $branchId, $supplierId);

            $prepared = $this->prepareLines($lines, $order);

            $this->guardOneCurrency($prepared, $chargeAmounts);
            $this->guardInvoiceTotal($prepared, $chargeAmounts);
            $this->guardVariance($order, $prepared, $overReceiptConfirmed, $varianceNote);

            $receipt = GoodsReceipt::query()->create([
                'organisation_id' => $organisationId,
                'branch_id' => $branchId,
                'supplier_id' => $supplierId,
                'document_ref' => $documentRef,
                'supplier_invoice_ref' => $supplierInvoiceRef,
                'invoice_date' => $invoiceDate,
                'variance_note' => $varianceNote,
                'purchase_order_id' => $order?->getKey(),
                'received_at' => $dates['received_at'],
                'received_on' => $dates['received_on'],
                // Rewritten from the lines below, once they exist. A receipt is
                // never briefly claimed complete.
                'cost_status' => 'unpriced',
            ] + $chargeAmounts);

            $costedLineCount = 0;
            $pendingCount = 0;
            $settledLineCount = 0;

            foreach ($prepared as $line) {
                /** @var StockItem $stockItem */
                $stockItem = $line['stock_item'];

                $record = GoodsReceiptLine::query()->create([
                    'goods_receipt_id' => $receipt->getKey(),
                    'stock_item_id' => (string) $stockItem->getKey(),
                    'purchase_order_line_id' => $line['purchase_order_line_id'],
                    'quantity' => $line['quantity'],
                    'unit_id' => $line['unit_id'],
                    'unit_price_amount' => $line['unit_price_amount'],
                    'line_total_amount' => $line['line_total_amount'],
                    'cost_currency_code' => $line['unit_price_amount'] === null ? null : $line['cost_currency_code'],
                ]);

                $this->inventory->recordMovement(
                    $organisationId,
                    $branchId,
                    (string) $stockItem->getKey(),
                    'receipt',
                    $line['stock_quantity'],
                    'goods_receipt',
                    (string) $receipt->getKey(),
                );

                $outcome = $this->lineCosting->settle($organisationId, $record, $stockItem);

                if ($outcome === 'blended') {
                    $costedLineCount++;
                }

                if ($outcome === 'pending_fx') {
                    $pendingCount++;
                }

                if ($outcome === 'blended' || $outcome === 'settled') {
                    $settledLineCount++;
                }
            }

            $receipt->cost_status = $this->costStatus(count($prepared), $settledLineCount);
            $receipt->save();

            $orderOutcome = $order === null
                ? ['status' => null, 'close_short_applied' => false]
                : $this->settleOrder($order, $closeShort, $closeShortReason);

            $this->audit->record(
                'procurement.goods_receipt_posted',
                actorUserId: $this->context->userId(),
                subjectType: 'goods_receipt',
                subjectId: (string) $receipt->getKey(),
                // Identifiers, counts and states only — never an amount, and
                // never a key containing `code`.
                metadata: [
                    'branch_id' => $branchId,
                    'supplier_id' => $supplierId,
                    'purchase_order_id' => $order?->getKey(),
                    'line_count' => count($prepared),
                    'matched_line_count' => count(array_filter(
                        $prepared,
                        static fn (array $line): bool => $line['purchase_order_line_id'] !== null,
                    )),
                    'costed_line_count' => $costedLineCount,
                    'valuation_pending_count' => $pendingCount,
                    'cost_status' => $receipt->cost_status,
                    'over_receipt' => $overReceiptConfirmed,
                    'close_short_applied' => $orderOutcome['close_short_applied'],
                    'purchase_order_status' => $orderOutcome['status'],
                ],
            );

            return $receipt;
        });
    }

    /* ── the order this delivery settles ─────────────────────────────────── */

    /**
     * The order a delivery may be made against, locked (§4).
     *
     * Four questions, and the answers are shaped differently on purpose. An
     * identifier belonging to another kitchen is **not found**, because whether
     * it exists is itself the answer this tenant is not entitled to. The other
     * three — a wrong status, a different branch, a different supplier — are
     * `409` with an explicit reason, the shape §6 mandates for refusals of this
     * kind: every identifier in the request is perfectly well formed, and what
     * refuses the operation is the relationship between them. A `422` would tell
     * a client its field was malformed when the field is fine.
     *
     * @throws ApiException
     */
    private function receivableOrder(string $purchaseOrderId, string $branchId, ?string $supplierId): PurchaseOrder
    {
        $order = PurchaseOrder::query()->whereKey($purchaseOrderId)->lockForUpdate()->first();

        if ($order === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        if (! in_array($order->status, [PurchaseOrderStatus::Issued, PurchaseOrderStatus::PartiallyReceived], true)) {
            throw $this->orderConflict(
                $order,
                'purchase_order_not_receivable',
                'Only an issued or partially received purchase order can be delivered against.',
            );
        }

        if ((string) $order->branch_id !== $branchId) {
            throw $this->orderConflict(
                $order,
                'purchase_order_branch_mismatch',
                'This delivery is being received at a different branch from the one that ordered it.',
            );
        }

        if ($supplierId === null || (string) $order->supplier_id !== $supplierId) {
            throw $this->orderConflict(
                $order,
                'purchase_order_supplier_mismatch',
                'This delivery names a different supplier from the one the order was addressed to.',
            );
        }

        return $order;
    }

    /**
     * Move the order to whatever its received quantities now say it is (§3.5).
     *
     * Nobody presses this. The status is a reading of the sums, which is why
     * there is no "mark as received" action anywhere in this module: it would let
     * an order claim a delivery that never turned up.
     *
     * `received_at` is stamped only when every ordered line has actually been
     * fulfilled — on a close-short nothing was "last fulfilled", and a date there
     * would be a small lie in the one place a person looks to check. `closed_at`
     * is stamped on both routes, because it answers a different question: this
     * order is finished and nothing more is expected against it.
     *
     * A close-short requested on an order that turns out to be **fully**
     * fulfilled stores no reason, because there is nothing left to explain. That
     * is not silent: the audit records `close_short_applied: false`, and the
     * order detail shows a plain `received` with no reason precisely because none
     * applies.
     *
     * @return array{status: string, close_short_applied: bool}
     */
    private function settleOrder(PurchaseOrder $order, bool $closeShort, ?string $closeShortReason): array
    {
        $outstanding = $this->outstandingByLine($order);
        $fulfilled = $outstanding === [];
        $closeShortApplied = $closeShort && ! $fulfilled;

        $target = $fulfilled || $closeShortApplied
            ? PurchaseOrderStatus::Received
            : PurchaseOrderStatus::PartiallyReceived;

        if ($target === $order->status) {
            // A second partial delivery against an already partially received
            // order changes the sums and not the status.
            return ['status' => $order->status->value, 'close_short_applied' => false];
        }

        if (! $order->status->canTransitionTo($target)) {
            throw $this->orderConflict(
                $order,
                'purchase_order_not_receivable',
                'This purchase order can no longer take a delivery.',
            );
        }

        $order->status = $target;

        if ($target === PurchaseOrderStatus::Received) {
            $order->closed_at = CarbonImmutable::now();

            if ($fulfilled) {
                $order->received_at = CarbonImmutable::now();
            }

            if ($closeShortApplied) {
                $order->close_short_reason = $closeShortReason;
            }
        }

        $order->save();

        return ['status' => $order->status->value, 'close_short_applied' => $closeShortApplied];
    }

    /**
     * How much of each ordered line is still to come, in the shelf's own unit.
     *
     * Lines that are fully fulfilled are absent from the result, so an empty
     * array means the whole order has arrived. The arithmetic itself lives in
     * {@see ReceivedQuantityQuery}, shared with the order-detail read and the
     * receivable-orders picker, because a prefill that disagreed with the guard
     * behind it would be a form that refuses what it just suggested.
     *
     * @return array<string, numeric-string>
     */
    private function outstandingByLine(PurchaseOrder $order): array
    {
        $outstanding = [];

        foreach ($this->received->progressForOrders([(string) $order->getKey()]) as $lineId => $progress) {
            if (bccomp($progress['outstanding'], '0', self::QUANTITY_SCALE) > 0) {
                $outstanding[$lineId] = $progress['outstanding'];
            }
        }

        return $outstanding;
    }

    /* ── reading the request ─────────────────────────────────────────────── */

    /**
     * Resolve every line: its shelf, its quantity in two units, its money, and
     * the order line it fulfils.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return list<PreparedLine>
     *
     * @throws ApiException
     */
    private function prepareLines(array $lines, ?PurchaseOrder $order): array
    {
        $orderLines = $order === null
            ? collect()
            : PurchaseOrderLine::query()
                ->where('purchase_order_id', $order->getKey())
                ->get()
                ->keyBy(static fn (PurchaseOrderLine $line): string => (string) $line->getKey());

        $prepared = [];

        foreach ($lines as $index => $line) {
            /** @var string $stockItemId */
            $stockItemId = $line['stock_item_id'];
            $stockItem = StockItem::query()->findOrFail($stockItemId);

            $orderLineId = $this->orderLineFor($line, $orderLines, $stockItem, $index, $order);

            $quantity = $this->numeric((string) $line['quantity']);
            $unitId = isset($line['unit_id']) ? (string) $line['unit_id'] : null;

            // `isset` is already false for a null value, so an explicit null
            // check beside it would always be true.
            $unitPrice = isset($line['unit_price_amount'])
                ? $this->numeric((string) $line['unit_price_amount'])
                : null;

            $currencyCode = isset($line['cost_currency_code']) ? (string) $line['cost_currency_code'] : null;

            $prepared[] = [
                'stock_item' => $stockItem,
                'purchase_order_line_id' => $orderLineId,
                'quantity' => $quantity,
                'stock_quantity' => $this->stockQuantity($quantity, $unitId, $stockItem),
                'unit_id' => $unitId,
                'unit_price_amount' => $unitPrice,
                'line_total_amount' => $unitPrice === null ? null : $this->roundMoney(bcmul($quantity, $unitPrice, 12)),
                'cost_currency_code' => $unitPrice === null ? null : $currencyCode,
            ];
        }

        return $prepared;
    }

    /**
     * The order line one request line fulfils, validated against the order.
     *
     * A `422` naming the exact line rather than a `404`, because this is a form
     * with rows in it and the person fixing it needs to know **which** row is
     * wrong. A line naming an order line from a different order, or naming one
     * that stocks a different shelf, is the same class of mistake.
     *
     * @param  array<string, mixed>  $line
     * @param  Collection<string, PurchaseOrderLine>  $orderLines
     *
     * @throws ApiException
     */
    private function orderLineFor(
        array $line,
        Collection $orderLines,
        StockItem $stockItem,
        int $index,
        ?PurchaseOrder $order,
    ): ?string {
        $requested = isset($line['purchase_order_line_id']) ? (string) $line['purchase_order_line_id'] : null;

        if ($requested === null) {
            return null;
        }

        if ($order === null) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A line can only name an order line when the delivery names the order it belongs to.',
                ['parameter' => "lines.{$index}.purchase_order_line_id"],
            );
        }

        $orderLine = $orderLines->get($requested);

        if (! $orderLine instanceof PurchaseOrderLine) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That order line is not on this purchase order.',
                ['parameter' => "lines.{$index}.purchase_order_line_id"],
            );
        }

        if ((string) $orderLine->stock_item_id !== (string) $stockItem->getKey()) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That order line was for a different item.',
                ['parameter' => "lines.{$index}.stock_item_id"],
            );
        }

        return $requested;
    }

    /**
     * The charge columns, as decimal strings, with absent keys left absent.
     *
     * @param  array<string, mixed>  $charges
     * @return array<string, numeric-string>
     */
    private function chargeAmounts(array $charges): array
    {
        $amounts = [];

        foreach (self::CHARGE_KEYS as $key) {
            if (! isset($charges[$key])) {
                continue;
            }

            $amounts[$key] = $this->roundMoney($this->numeric((string) $charges[$key]));
        }

        return $amounts;
    }

    /**
     * The business date and the instant, kept consistent with each other.
     *
     * `received_on` is the branch-local calendar day; `received_at` is the
     * instant. The invariant every reader assumes — and the one the migration's
     * backfill assumed in reverse — is that the instant, read in branch time,
     * falls on that day. So a receipt recorded for today gets the real `now()`,
     * and a receipt backdated to Tuesday gets Tuesday at the current local
     * time-of-day. Neither invents a figure: the second is the honest statement
     * that the day is known and the hour is not.
     *
     * A future business date is refused. A delivery that has not happened is not
     * a delivery, and slice 6 would file its money in a period that has not
     * started.
     *
     * @return array{received_on: string, received_at: CarbonImmutable}
     *
     * @throws ApiException
     */
    private function dates(OrganisationBranch $branch, ?string $receivedOn): array
    {
        $localNow = CarbonImmutable::now($branch->timezone);
        $today = $localNow->toDateString();

        if ($receivedOn === null) {
            return ['received_on' => $today, 'received_at' => CarbonImmutable::now()];
        }

        $businessDate = CarbonImmutable::parse($receivedOn, $branch->timezone)->toDateString();

        if ($businessDate > $today) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A delivery cannot be received on a date that has not arrived at this branch yet.',
                ['parameter' => 'received_on'],
            );
        }

        if ($businessDate === $today) {
            return ['received_on' => $today, 'received_at' => CarbonImmutable::now()];
        }

        return [
            'received_on' => $businessDate,
            'received_at' => CarbonImmutable::parse(
                $businessDate.' '.$localNow->format('H:i:s'),
                $branch->timezone,
            )->utc(),
        ];
    }

    /* ── refusals ────────────────────────────────────────────────────────── */

    /**
     * One receipt, one currency (§3.6).
     *
     * Healthy360 has no exchange-rate source, so a receipt whose lines are in two
     * currencies has a subtotal nobody could compute. The header charges are
     * covered by the same rule from the other side: they carry no currency
     * column, they are in the receipt's line currency, and a charge on a receipt
     * with no priced line has no currency at all — which is why that is refused
     * rather than stored. An amount without its currency is not an amount (§4.4).
     *
     * @param  list<PreparedLine>  $prepared
     * @param  array<string, numeric-string>  $charges
     *
     * @throws ApiException
     */
    private function guardOneCurrency(array $prepared, array $charges): void
    {
        $currencies = [];

        foreach ($prepared as $line) {
            if ($line['cost_currency_code'] !== null) {
                $currencies[(string) $line['cost_currency_code']] = true;
            }
        }

        if (count($currencies) > 1) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Every priced line on one receipt is in the same currency — this system never adds unlike currencies.',
                ['parameter' => 'lines', 'currencies' => array_keys($currencies)],
            );
        }

        if ($charges !== [] && $currencies === []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'A receipt charge needs a currency, and it takes it from the priced lines — so at least one line must carry a price.',
                ['parameter' => 'invoice_total_amount'],
            );
        }
    }

    /**
     * `invoice total = line subtotal − discount + tax + delivery + other` (§3.6).
     *
     * Only checked when an invoice total is present, because a receipt posted off
     * a delivery note has no invoice to reconcile against yet. The refusal names
     * the difference rather than only saying no: the person looking at it has the
     * supplier's paper in their hand, and the gap is what tells them which line
     * they mistyped.
     *
     * @param  list<PreparedLine>  $prepared
     * @param  array<string, numeric-string>  $charges
     *
     * @throws ApiException
     */
    private function guardInvoiceTotal(array $prepared, array $charges): void
    {
        if (! isset($charges['invoice_total_amount'])) {
            return;
        }

        $subtotal = '0';

        foreach ($prepared as $line) {
            if ($line['line_total_amount'] !== null) {
                $subtotal = bcadd($subtotal, (string) $line['line_total_amount'], self::MONEY_SCALE);
            }
        }

        $expected = bcadd(
            bcadd(
                bcsub($subtotal, $charges['discount_amount'] ?? '0', self::MONEY_SCALE),
                $charges['tax_amount'] ?? '0',
                self::MONEY_SCALE,
            ),
            bcadd($charges['delivery_amount'] ?? '0', $charges['other_charges_amount'] ?? '0', self::MONEY_SCALE),
            self::MONEY_SCALE,
        );

        $difference = bcsub($charges['invoice_total_amount'], $expected, self::MONEY_SCALE);

        if (bccomp($difference, '0', self::MONEY_SCALE) !== 0) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'The invoice total does not match the lines and charges on this receipt.',
                [
                    'parameter' => 'invoice_total_amount',
                    'expected_total_amount' => $expected,
                    'difference_amount' => $difference,
                ],
            );
        }
    }

    /**
     * Over-receipt and unplanned items both need somebody to say why (§3.5, §4).
     *
     * An over-receipt is refused outright unless the caller has confirmed it, and
     * confirming it is not enough on its own — §3.5 asks for "an explicit
     * confirmation **and** a variance note", because a confirmation records that
     * somebody clicked and a note records what they knew.
     *
     * An unplanned extra item on an ordered delivery takes the same note, which
     * is §4's "allowed with an explicit note" — the goods turned up and the
     * kitchen keeps them, but the order does not silently grow a line nobody
     * asked the supplier for.
     *
     * @param  list<PreparedLine>  $prepared
     *
     * @throws ApiException
     */
    private function guardVariance(?PurchaseOrder $order, array $prepared, bool $overReceiptConfirmed, ?string $varianceNote): void
    {
        if ($order === null) {
            return;
        }

        $unplanned = array_filter($prepared, static fn (array $line): bool => $line['purchase_order_line_id'] === null);

        if ($unplanned !== [] && $varianceNote === null) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'An item that was not on this order needs a note saying why it is on the delivery.',
                ['parameter' => 'variance_note'],
            );
        }

        $exceeded = $this->exceededLines($order, $prepared);

        if ($exceeded === []) {
            return;
        }

        if (! $overReceiptConfirmed) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This delivery is more than the order still has outstanding. Confirm the over-receipt to record it.',
                ['parameter' => 'over_receipt_confirmed', 'purchase_order_line_ids' => $exceeded],
            );
        }

        if ($varianceNote === null) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'An over-receipt needs a note saying why more arrived than was ordered.',
                ['parameter' => 'variance_note', 'purchase_order_line_ids' => $exceeded],
            );
        }
    }

    /**
     * The order lines this delivery would push past their ordered quantity.
     *
     * @param  list<PreparedLine>  $prepared
     * @return list<string>
     */
    private function exceededLines(PurchaseOrder $order, array $prepared): array
    {
        $outstanding = $this->outstandingByLine($order);

        $incoming = [];

        foreach ($prepared as $line) {
            if ($line['purchase_order_line_id'] === null) {
                continue;
            }

            $key = (string) $line['purchase_order_line_id'];
            $incoming[$key] = bcadd($incoming[$key] ?? '0', (string) $line['stock_quantity'], self::QUANTITY_SCALE);
        }

        $exceeded = [];

        foreach ($incoming as $lineId => $quantity) {
            if (bccomp($quantity, $outstanding[$lineId] ?? '0', self::QUANTITY_SCALE) > 0) {
                $exceeded[] = $lineId;
            }
        }

        return $exceeded;
    }

    /* ── costing ─────────────────────────────────────────────────────────── */

    /**
     * `unpriced | partial | complete`, from `costed_at` and nothing else.
     *
     * An empty receipt is `unpriced`: there is nothing on it that has been
     * costed, and calling it complete would quietly retire a record that never
     * had any money on it.
     */
    private function costStatus(int $lineCount, int $settledLineCount): string
    {
        if ($lineCount === 0 || $settledLineCount === 0) {
            return 'unpriced';
        }

        return $settledLineCount === $lineCount ? 'complete' : 'partial';
    }

    /* ── units and arithmetic ────────────────────────────────────────────── */

    /**
     * The purchased quantity in the stock item's own unit.
     *
     * When either unit is unknown the quantity is taken as already in stock units
     * — the honest fallback for a stock item INV1.0 left without a resolved
     * `unit_id`. This is the one conversion; the stock movement and the order's
     * outstanding arithmetic both read it, so they cannot disagree.
     *
     * @param  numeric-string  $quantity
     * @return numeric-string
     */
    private function stockQuantity(string $quantity, ?string $purchaseUnitId, StockItem $stockItem): string
    {
        $purchaseUnit = $purchaseUnitId === null ? null : MeasurementUnit::query()->find($purchaseUnitId);
        $stockUnit = $stockItem->unit_id === null ? null : MeasurementUnit::query()->find($stockItem->unit_id);

        if ($purchaseUnit instanceof MeasurementUnit && $stockUnit instanceof MeasurementUnit) {
            return $this->conversion->convert($quantity, $purchaseUnit, $stockUnit);
        }

        return $quantity;
    }

    /**
     * @throws ApiException
     */
    private function branch(string $branchId): OrganisationBranch
    {
        $branch = OrganisationBranch::query()->whereKey($branchId)->first();

        if ($branch === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $branch;
    }

    private function orderConflict(PurchaseOrder $order, string $reason, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ResourceConflict,
            $message,
            ['reason' => $reason, 'status' => $order->status->value],
        );
    }

    private function trimmed(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    /**
     * Round half away from zero to the six places the money columns store.
     *
     * @param  numeric-string  $value
     * @return numeric-string
     */
    private function roundMoney(string $value): string
    {
        $negative = str_starts_with($value, '-');

        return bcadd($value, $negative ? '-0.0000005' : '0.0000005', self::MONEY_SCALE);
    }

    /**
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Goods receipt received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
