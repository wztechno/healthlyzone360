<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The invoice that turned up a week after the van did (§3.6).
 *
 * A delivery may be posted with no prices at all — the goods are on the shelf
 * and the paperwork is in the post — and a cost-authorised person then works
 * through the **Unpriced receipts** queue and fills in what each line cost. This
 * is that write, and it is defined as much by what it does not do.
 *
 * ## It cannot move stock, structurally
 *
 * §3.6: completing prices "never creates a second stock movement". This class
 * has no `InventoryService` and neither does {@see ReceiptLineCosting}, which it
 * delegates the costing to. That is the guarantee — not a rule somebody has to
 * remember, but an absence of the only thing that could break it. A test pins
 * both constructors, because the way this breaks is a helpful dependency being
 * injected later.
 *
 * ## It prices each line once, and the null is the guard
 *
 * Only a line whose `costed_at` is null may be priced here, which is exactly
 * §3.6's rule. A line already settled answers `422` naming that line rather than
 * being quietly skipped: the client asked to price something that is already
 * priced, and a silent no-op would leave a person believing they had corrected a
 * figure they had not. Correcting a posted price is deliberately not this
 * endpoint's job — §3.6 puts that behind "a reasoned, audited adjustment rather
 * than silently rewriting history", which is a later object with its own trail.
 *
 * ## A line already waiting on an exchange rate is refused, not re-tried
 *
 * `valuation_pending_fx` also has a null `costed_at`, and it is deliberately
 * **not** eligible. Its price is already recorded exactly as the supplier wrote
 * it; what is outstanding is a valuation decision, and §3.6 assigns that to "a
 * later exchange-rate/accounting phase" while the original supplier price
 * remains unchanged. Offering to re-price it here would invite somebody to
 * rewrite a real invoice figure in order to dodge a currency wall. The refusal
 * names the reason so a screen can say so plainly.
 *
 * The reverse case is handled and matters: a line priced **here** for the first
 * time, in a currency the ingredient's valuation cannot take, is marked
 * `valuation_pending_fx` exactly as it would have been at post time. Receiving
 * is never lost to a currency, and neither is an invoice.
 *
 * ## The whole receipt is one currency
 *
 * The lines being completed must agree with each other and with whatever the
 * receipt's already-priced lines carry. There is no exchange rate in this system
 * (§4.4), and a receipt with two currencies has a subtotal nobody could compute.
 *
 * That guard runs **after** line eligibility, not before it: the person most
 * likely to send a second currency is the one trying to re-price an
 * exchange-rate-blocked line into the valuation currency, and telling them their
 * receipt has two currencies answers a question they did not ask.
 *
 * Gated by `inventory.view_costs_organisation` at the route: entering a price
 * off a delivery note is a warehouse job, but going back over the money
 * afterwards is the cost holder's (§5).
 *
 * Audited as `procurement.goods_receipt_priced` with counts and identifiers only
 * — never an amount, which would put a cost figure behind the audit permission
 * instead of the cost one.
 */
final readonly class ReceiptPriceCompletionService
{
    /** bcmath scale for money, matching `decimal(18,6)` (§4.4). */
    private const int MONEY_SCALE = 6;

    public function __construct(
        private ReceiptLineCosting $lineCosting,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * Fill in the missing prices on one receipt.
     *
     * `line_total_amount` is optional. When it is sent it is **checked** against
     * quantity × unit price rather than stored as given: the total and the price
     * are two views of one fact, and a database holding two answers for it is
     * worse than one that refuses. Sending it is how a client says "this is what
     * I read off the invoice", and a mismatch is worth a refusal that names the
     * difference.
     *
     * @param  list<array{goods_receipt_line_id: string, unit_price_amount: float|string, line_total_amount?: float|string|null, cost_currency_code: string}>  $lines
     *
     * @throws ApiException
     */
    public function complete(GoodsReceipt $receipt, array $lines): GoodsReceipt
    {
        if ($lines === []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Completing prices needs at least one line.',
                ['parameter' => 'lines'],
            );
        }

        return DB::transaction(function () use ($receipt, $lines): GoodsReceipt {
            /** @var Collection<string, GoodsReceiptLine> $existing */
            $existing = GoodsReceiptLine::query()
                ->where('goods_receipt_id', $receipt->getKey())
                ->with('stockItem')
                ->lockForUpdate()
                ->get()
                ->keyBy(static fn (GoodsReceiptLine $line): string => (string) $line->getKey());

            // Eligibility before currency, and the order is the answer to a real
            // question. A person looking at a line that is waiting on an
            // exchange rate will try to unblock it by re-entering the price in
            // the valuation currency — which is both "this line may not be
            // priced here" and "that is a second currency on this receipt", and
            // only the first of those tells them anything they can act on.
            // Refusing the ineligible line first means the reason a screen shows
            // is the reason the request was actually wrong.
            /** @var array<int, GoodsReceiptLine> $records */
            $records = [];

            foreach ($lines as $index => $line) {
                $records[$index] = $this->eligibleLine($existing, (string) $line['goods_receipt_line_id'], $index);
            }

            $currency = $this->guardOneCurrency($existing, $lines);

            $organisationId = (string) $receipt->organisation_id;
            $blendedCount = 0;
            $pendingCount = 0;

            foreach ($lines as $index => $line) {
                $record = $records[$index];

                $unitPrice = $this->numeric((string) $line['unit_price_amount']);
                $lineTotal = $this->roundMoney(bcmul((string) $record->quantity, $unitPrice, 12));

                if (isset($line['line_total_amount'])) {
                    $this->guardLineTotal($this->numeric((string) $line['line_total_amount']), $lineTotal, $index);
                }

                $record->unit_price_amount = $unitPrice;
                $record->line_total_amount = $lineTotal;
                $record->cost_currency_code = $currency;
                $record->save();

                $outcome = $this->lineCosting->settle($organisationId, $record);

                if ($outcome === 'blended') {
                    $blendedCount++;
                }

                if ($outcome === 'pending_fx') {
                    $pendingCount++;
                }
            }

            $receipt->cost_status = $this->costStatus($receipt);
            $receipt->save();

            $this->audit->record(
                'procurement.goods_receipt_priced',
                actorUserId: $this->context->userId(),
                subjectType: 'goods_receipt',
                subjectId: (string) $receipt->getKey(),
                // Counts and states only — never an amount. This surface exists
                // to write money, and an audit row is readable with a different
                // permission from the one that gates reading it.
                metadata: [
                    'branch_id' => (string) $receipt->branch_id,
                    'supplier_id' => $receipt->supplier_id,
                    'priced_line_count' => count($lines),
                    'costed_line_count' => $blendedCount,
                    'valuation_pending_count' => $pendingCount,
                    'cost_status' => $receipt->cost_status,
                ],
            );

            return $receipt;
        });
    }

    /* ── refusals ────────────────────────────────────────────────────────── */

    /**
     * The one line this request may price, or a refusal naming it.
     *
     * @param  Collection<string, GoodsReceiptLine>  $existing
     *
     * @throws ApiException
     */
    private function eligibleLine(Collection $existing, string $lineId, int $index): GoodsReceiptLine
    {
        $record = $existing->get($lineId);

        if (! $record instanceof GoodsReceiptLine) {
            // Not found rather than forbidden, and named by parameter because
            // this is a form with rows in it: a line belonging to another receipt
            // and a line that never existed are the same answer.
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That line is not on this receipt.',
                ['parameter' => "lines.{$index}.goods_receipt_line_id"],
            );
        }

        if ($record->valuation_pending_fx) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                "This line's price is already recorded; what it is waiting for is an exchange-rate decision, which this screen does not make.",
                ['parameter' => "lines.{$index}.goods_receipt_line_id", 'reason' => 'line_valuation_pending_fx'],
            );
        }

        if ($record->costed_at !== null) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This line has already been priced. Correcting a posted price is a reasoned adjustment, not a second completion.',
                ['parameter' => "lines.{$index}.goods_receipt_line_id", 'reason' => 'line_already_costed'],
            );
        }

        return $record;
    }

    /**
     * One receipt, one currency (§3.6) — across the lines being completed and
     * the lines already on it.
     *
     * @param  Collection<string, GoodsReceiptLine>  $existing
     * @param  list<array<string, mixed>>  $lines
     *
     * @throws ApiException
     */
    private function guardOneCurrency(Collection $existing, array $lines): string
    {
        $incoming = [];

        foreach ($lines as $line) {
            $incoming[(string) $line['cost_currency_code']] = true;
        }

        foreach ($existing as $line) {
            if ($line->cost_currency_code !== null) {
                $incoming[$line->cost_currency_code] = true;
            }
        }

        if (count($incoming) !== 1) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Every priced line on one receipt is in the same currency — this system never adds unlike currencies.',
                ['parameter' => 'lines', 'currencies' => array_keys($incoming)],
            );
        }

        return (string) array_key_first($incoming);
    }

    /**
     * @param  numeric-string  $claimed
     * @param  numeric-string  $computed
     *
     * @throws ApiException
     */
    private function guardLineTotal(string $claimed, string $computed, int $index): void
    {
        $difference = bcsub($claimed, $computed, self::MONEY_SCALE);

        if (bccomp($difference, '0', self::MONEY_SCALE) !== 0) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That line total does not match the quantity received at that unit price.',
                [
                    'parameter' => "lines.{$index}.line_total_amount",
                    'expected_total_amount' => $computed,
                    'difference_amount' => $difference,
                ],
            );
        }
    }

    /* ── derived state ───────────────────────────────────────────────────── */

    /**
     * Re-read `cost_status` from the lines as they now stand.
     *
     * The same single rule the posting service uses: a line is settled when it
     * carries `costed_at`, and nothing else counts. A line left waiting on an
     * exchange rate keeps its receipt out of `complete`, which is what keeps the
     * period visibly incomplete in the cost report (§3.6).
     */
    private function costStatus(GoodsReceipt $receipt): string
    {
        $total = GoodsReceiptLine::query()->where('goods_receipt_id', $receipt->getKey())->count();
        $settled = GoodsReceiptLine::query()
            ->where('goods_receipt_id', $receipt->getKey())
            ->whereNotNull('costed_at')
            ->count();

        if ($total === 0 || $settled === 0) {
            return 'unpriced';
        }

        return $settled === $total ? 'complete' : 'partial';
    }

    /**
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
            throw new RuntimeException("Receipt price completion received a non-numeric value [{$value}].");
        }

        return $value;
    }
}
