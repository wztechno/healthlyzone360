<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Organisations\Services\OrganisationTimezone;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * What the kitchen owes its suppliers, one delivery at a time.
 *
 * Nothing here moves money. It writes down that somebody paid by hand, and it holds
 * that back while a price is waiting for approval, or while the amount is unknown.
 *
 * The amount is the invoice total when one was keyed, otherwise the lines' total,
 * and null while any line has no price. One payment settles one receipt: there are
 * no part payments, supplier statements or ageing buckets.
 *
 * ponytail: the list is capped at {@see self::LIMIT} unpaid rows, oldest due first.
 * Add paging when a kitchen really owes for more deliveries than that.
 */
final readonly class Payables
{
    private const int LIMIT = 200;

    private const int RECENTLY_PAID = 30;

    private const int MONEY_SCALE = 6;

    public function __construct(
        private OrganisationTimezone $timezones,
        private AuditRecorder $audit,
    ) {}

    /**
     * @return array{today: string, totals: list<array{currency_code: string, amount: string}>, unpaid: list<array<string, mixed>>, paid: list<array<string, mixed>>}
     */
    public function list(string $organisationId): array
    {
        $today = CarbonImmutable::now($this->timezones->forOrganisationId($organisationId))->toDateString();

        $unpaid = $this->rows()
            ->where(fn (Builder $query): Builder => $query->where('payment_status', 'unpaid')->orWhere('price_approval_status', 'pending'))
            ->orderByRaw('due_on asc nulls last')
            ->orderBy('received_on')
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (GoodsReceipt $receipt): array => $this->row($receipt, $today));

        $paid = $this->rows()
            ->where('payment_status', 'paid')
            ->orderByDesc('paid_at')
            ->limit(self::RECENTLY_PAID)
            ->get()
            ->map(fn (GoodsReceipt $receipt): array => $this->row($receipt, $today));

        return [
            'today' => $today,
            'totals' => $this->totals($unpaid),
            'unpaid' => array_values($unpaid->all()),
            'paid' => array_values($paid->all()),
        ];
    }

    /**
     * @throws ApiException
     */
    public function approvePrice(GoodsReceipt $receipt, string $actorUserId): void
    {
        $approved = GoodsReceipt::query()->whereKey($receipt->getKey())
            ->where('price_approval_status', 'pending')
            ->update(['price_approval_status' => 'approved', 'price_approved_by' => $actorUserId, 'price_approved_at' => now()]);

        if ($approved === 0) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This delivery has no price waiting for approval.');
        }

        $this->record('procurement.price_approved', $receipt, $actorUserId);
    }

    /**
     * Refused while a price waits or a line has none: both are money nobody has
     * agreed yet. The status is re-checked in the update, so a second press and a
     * new pending price both fall through to the refusal.
     *
     * @throws ApiException
     */
    public function markPaid(GoodsReceipt $receipt, ?string $reference, string $actorUserId): void
    {
        if ($receipt->lines()->whereNull('unit_price_amount')->exists()) {
            throw new ApiException(ErrorCode::ResourceConflict, 'A line on this delivery has no price yet.');
        }

        $paid = GoodsReceipt::query()->whereKey($receipt->getKey())
            ->where('payment_status', 'unpaid')
            ->where(fn (Builder $query): Builder => $query->whereNull('price_approval_status')->orWhere('price_approval_status', 'approved'))
            ->update([
                'payment_status' => 'paid',
                'paid_at' => now(),
                'paid_by' => $actorUserId,
                'paid_reference' => $reference === null || trim($reference) === '' ? null : trim($reference),
            ]);

        if ($paid === 0) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This delivery is already paid, or its price is still waiting for approval.');
        }

        $this->record('procurement.payable_paid', $receipt, $actorUserId);
    }

    public function setDueDate(GoodsReceipt $receipt, ?string $dueOn, string $actorUserId): void
    {
        $receipt->due_on = $dueOn === null ? null : CarbonImmutable::parse($dueOn);
        $receipt->save();

        $this->record('procurement.payable_due_changed', $receipt, $actorUserId);
    }

    /**
     * @return Builder<GoodsReceipt>
     */
    private function rows(): Builder
    {
        return GoodsReceipt::query()->with(['lines.stockItem', 'supplier']);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(GoodsReceipt $receipt, string $today): array
    {
        $lines = $receipt->lines;
        $priced = $lines->every(static fn (GoodsReceiptLine $line): bool => $line->unit_price_amount !== null);

        return [
            'id' => (string) $receipt->getKey(),
            'supplier_name_en' => $receipt->supplier?->name_en,
            'supplier_name_ar' => $receipt->supplier?->name_ar,
            'document_ref' => $receipt->document_ref,
            'supplier_invoice_ref' => $receipt->supplier_invoice_ref,
            'received_on' => $receipt->received_on?->toDateString(),
            'due_on' => $receipt->due_on?->toDateString(),
            'is_overdue' => $receipt->payment_status === 'unpaid' && $receipt->due_on !== null && $receipt->due_on->toDateString() < $today,
            'payment_status' => $receipt->payment_status,
            'paid_at' => $receipt->paid_at?->toIso8601String(),
            'paid_reference' => $receipt->paid_reference,
            'price_approval_status' => $receipt->price_approval_status,
            'amount' => $priced ? $this->amount($receipt, $lines) : null,
            'currency_code' => $lines->pluck('cost_currency_code')->filter()->first(),
            'price_rises' => $lines
                ->filter(static fn (GoodsReceiptLine $line): bool => $line->price_variance_percent !== null && bccomp((string) $line->price_variance_percent, '0', 2) > 0)
                ->sortByDesc(static fn (GoodsReceiptLine $line): float => (float) $line->price_variance_percent)
                ->map(static fn (GoodsReceiptLine $line): array => [
                    'name_en' => $line->stockItem?->name_en,
                    'last_unit_price_amount' => (string) $line->last_unit_price_amount,
                    'unit_price_amount' => (string) $line->unit_price_amount,
                    'price_variance_percent' => (string) $line->price_variance_percent,
                ])
                ->values()
                ->all(),
        ];
    }

    /**
     * @param  Collection<int, GoodsReceiptLine>  $lines
     */
    private function amount(GoodsReceipt $receipt, Collection $lines): string
    {
        if ($receipt->invoice_total_amount !== null) {
            return (string) $receipt->invoice_total_amount;
        }

        $total = '0';

        foreach ($lines as $line) {
            // A line not yet priced adds nothing; bcmath refuses the empty string a null casts to.
            $total = bcadd($total, $line->line_total_amount ?? '0', self::MONEY_SCALE);
        }

        return $total;
    }

    /**
     * What is owed per currency. Never across two: there is no exchange rate here.
     *
     * @param  Collection<int, array<string, mixed>>  $rows
     * @return list<array{currency_code: string, amount: string}>
     */
    private function totals(Collection $rows): array
    {
        $totals = [];

        foreach ($rows as $row) {
            if ($row['payment_status'] !== 'unpaid' || $row['amount'] === null || $row['currency_code'] === null) {
                continue;
            }

            $currency = (string) $row['currency_code'];
            $totals[$currency] = bcadd($totals[$currency] ?? '0', $this->numeric((string) $row['amount']), self::MONEY_SCALE);
        }

        return array_map(
            static fn (string $currency, string $amount): array => ['currency_code' => $currency, 'amount' => $amount],
            array_keys($totals),
            array_values($totals),
        );
    }

    /**
     * Identifiers only: an audit row is read under a different code from the money.
     */
    private function record(string $action, GoodsReceipt $receipt, string $actorUserId): void
    {
        $this->audit->record(
            $action,
            actorUserId: $actorUserId,
            subjectType: 'goods_receipt',
            subjectId: (string) $receipt->getKey(),
            metadata: ['supplier_id' => $receipt->supplier_id],
        );
    }

    /**
     * bcmath handed a non-numeric string fails or reads it as zero; an amount
     * that is not a number is a fault to report, not a payable to drop.
     *
     * @return numeric-string
     */
    private function numeric(string $value): string
    {
        if (! is_numeric($value)) {
            throw new RuntimeException("Payables read a non-numeric amount [{$value}].");
        }

        return $value;
    }
}
