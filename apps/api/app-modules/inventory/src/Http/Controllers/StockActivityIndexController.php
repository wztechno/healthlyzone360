<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/stock-activity — every stock movement in a window, who made
 * it and what it was worth, so an owner can investigate a number.
 *
 * Read-only, and it reads the ledger as it stands: a row with no actor is shown as
 * it is, because the ledger is never rewritten.
 *
 * ## What counts as waste
 *
 * `waste` holds two kinds of food: `waste` movements, and everything cooked for an
 * order cancelled as `wasted`, whose deduction stands with no reversal. A movement
 * that could not be valued adds nothing to a total and is counted in
 * `unvalued_waste_count`, so a total can never read as complete when it is not.
 *
 * A waste row names its reason; one from before the reason column reads as `other`.
 * `order_id` is set wherever `order_number` is, so a reader can open the order.
 *
 * `cost_minor` is `cost_amount` to the nearest minor unit: the ledger holds six
 * places and a reader wants money.
 *
 * Bounded, as the order desk queue is bounded: a window that holds more than
 * {@see self::LIMIT} rows says so in `meta.truncated`.
 */
final class StockActivityIndexController
{
    private const int LIMIT = 500;

    private const int MAX_DAYS = 31;

    public function __construct(private readonly TenantContext $context) {}

    /**
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $from = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'], 'UTC')->startOfDay();
        $to = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'], 'UTC')->startOfDay();

        if ($to->greaterThan($from->addDays(self::MAX_DAYS - 1))) {
            throw ValidationException::withMessages(['to' => 'The window may not exceed '.self::MAX_DAYS.' days.']);
        }

        $organisationId = (string) $this->context->organisationId();

        $rows = $this->movements($organisationId, $from, $to)
            ->select(['m.id', 'm.created_at', 'm.reason', 'm.quantity_delta', 'm.notes', 'm.cost_currency_code', 'm.reference_type', 'm.waste_reason', 'items.name_en', 'items.unit_code', 'orders.id as order_id', 'orders.order_number', 'orders.cancellation_disposition'])
            ->selectRaw('round(m.cost_amount * 100) as cost_minor')
            ->selectRaw("nullif(trim(coalesce(profiles.given_name, '') || ' ' || coalesce(profiles.family_name, '')), '') as actor_name")
            ->selectRaw('m.actor_user_id is not null as attributed')
            ->orderByDesc('m.created_at')
            ->orderByDesc('m.id')
            ->limit(self::LIMIT + 1)
            ->get();

        $truncated = $rows->count() > self::LIMIT;

        return ApiResponse::data([
            'movements' => $rows->take(self::LIMIT)->map(static fn (object $row): array => [
                'id' => (string) $row->id,
                'at' => CarbonImmutable::parse((string) $row->created_at)->toIso8601String(),
                'item_name' => (string) $row->name_en,
                'unit' => (string) $row->unit_code,
                'reason' => (string) $row->reason,
                'quantity_delta' => (string) $row->quantity_delta,
                'cost_minor' => $row->cost_minor === null ? null : (int) $row->cost_minor,
                'currency_code' => $row->cost_currency_code,
                'notes' => $row->notes,
                'waste_reason' => $row->reason === 'waste' ? ($row->waste_reason ?? 'other') : null,
                'order_id' => $row->order_id === null ? null : (string) $row->order_id,
                'order_number' => $row->order_number,
                'wasted_order' => $row->reason === 'consume' && $row->cancellation_disposition === 'wasted',
                'attributed' => (bool) $row->attributed,
                'actor_name' => $row->actor_name,
            ])->values()->all(),
            'waste' => $this->waste($organisationId, $from, $to),
            'unvalued_waste_count' => (clone $this->movements($organisationId, $from, $to))
                ->where('m.reason', 'waste')
                ->whereNull('m.cost_amount')
                ->count(),
        ], ['truncated' => $truncated]);
    }

    private function movements(string $organisationId, CarbonImmutable $from, CarbonImmutable $to): Builder
    {
        return DB::table('stock_movements as m')
            ->join('stock_items as items', 'items.id', '=', 'm.stock_item_id')
            ->leftJoin('user_profiles as profiles', 'profiles.user_id', '=', 'm.actor_user_id')
            ->leftJoin('orders', function ($join): void {
                $join->on('orders.id', '=', 'm.reference_id')
                    ->whereIn('m.reference_type', ['order', 'order_reversal']);
            })
            ->where('m.organisation_id', $organisationId)
            ->where('m.created_at', '>=', $from)
            ->where('m.created_at', '<', $to->addDay());
    }

    /**
     * Per currency, never across: the rule the cash report keeps, for its reason.
     *
     * @return list<array{currency_code: string, amount_minor: int}>
     */
    private function waste(string $organisationId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        return $this->movements($organisationId, $from, $to)
            ->whereNotNull('m.cost_amount')
            ->where(static function (Builder $query): void {
                $query->where('m.reason', 'waste')
                    ->orWhere(static function (Builder $query): void {
                        $query->where('m.reason', 'consume')
                            ->where('orders.cancellation_disposition', 'wasted')
                            ->whereNotExists(static fn (Builder $reversal): Builder => $reversal->selectRaw('1')
                                ->from('stock_movements as reversal')
                                ->where('reversal.reference_type', 'order_reversal')
                                ->whereColumn('reversal.reference_id', 'm.reference_id')
                                ->whereColumn('reversal.order_line_id', 'm.order_line_id')
                                ->whereColumn('reversal.stock_item_id', 'm.stock_item_id'));
                    });
            })
            ->selectRaw('m.cost_currency_code as currency_code')
            ->selectRaw('round(sum(abs(m.cost_amount)) * 100) as amount_minor')
            ->groupBy('m.cost_currency_code')
            ->orderBy('m.cost_currency_code')
            ->get()
            ->map(static fn (object $row): array => [
                'currency_code' => (string) $row->currency_code,
                'amount_minor' => (int) $row->amount_minor,
            ])
            ->values()
            ->all();
    }
}
