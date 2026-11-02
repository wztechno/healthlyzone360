<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Orders\Models\CashSettlement;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderPaymentReceipts;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use stdClass;

/**
 * What the road still owes the kitchen, and writing down that it came back.
 *
 * ## A driver and a courier differ in where the receipt comes from
 *
 * A **driver** already wrote a receipt at the door (`DeliveredOrderFulfilment`), so
 * a hand-in only records that the cash reached the kitchen. A **courier** writes
 * nothing at the door, so settling is what writes their orders' receipts, each for
 * what the order still owes. The customer paid in full, so the receipt is the full
 * balance, and the courier's fee is carried on the settlement. Each run's fee is the
 * one keyed at handover.
 *
 * ## What is refused
 *
 * Nothing may be settled twice, or from two parties at once, and nobody hands in
 * more than was due. Eligibility is re-read under a lock on the runs, so a screen
 * that was stale, or a second press, is refused and writes nothing.
 *
 * A short hand-in records its reason and waits for a manager's sign-off. The app
 * takes no pay decision: nothing else follows from it.
 *
 * A driver's run from before settlement existed carries `predates_settlement` and
 * is not waiting: its cash came back by hand long ago, and nothing recorded it.
 */
final readonly class CashSettlements
{
    /**
     * A run's cash: the driver's receipts for it, less the corrections that reach
     * them. A correction comes off whatever else was received first, the desk's
     * deposit say, because that money never passed through the driver's hands. Only
     * what is left over can be a mistake in what they collected.
     */
    private const string COLLECTED_SQL = <<<'SQL'
        coalesce((
            select sum(receipts.amount_minor)
            from order_payment_receipts as receipts
            where receipts.order_id = orders.id
              and receipts.confirmed_by = jobs.driver_user_id
              and receipts.method <> 'wish'
        ), 0) - greatest(coalesce((
            select sum(corrections.amount_minor)
            from order_refunds as corrections
            where corrections.order_id = orders.id
              and corrections.kind = 'receipt_correction'
              and corrections.status = 'completed'
        ), 0) - coalesce((
            select sum(others.amount_minor)
            from order_payment_receipts as others
            where others.order_id = orders.id
              and (others.confirmed_by is distinct from jobs.driver_user_id or others.method = 'wish')
        ), 0), 0)
        SQL;

    /** What an order delivered by a courier still owes. */
    private const string DUE_SQL = <<<'SQL'
        orders.total_minor - coalesce((
            select sum(receipts.amount_minor)
            from order_payment_receipts as receipts
            where receipts.order_id = orders.id
        ), 0) + coalesce((
            select sum(corrections.amount_minor)
            from order_refunds as corrections
            where corrections.order_id = orders.id
              and corrections.kind = 'receipt_correction'
              and corrections.status = 'completed'
        ), 0)
        SQL;

    public function __construct(
        private OrderPaymentReceipts $receipts,
        private AuditRecorder $audit,
        private StaffAlerts $alerts,
    ) {}

    /**
     * Every driver with cash not yet handed in, each with their runs.
     *
     * @return list<array{driver_user_id: string, display_name: string|null, currency_code: string, collected_minor: int, runs: list<array{job_id: string, order_id: string, order_number: string, delivered_at: string|null, amount_minor: int}>}>
     */
    public function drivers(string $organisationId): array
    {
        $rows = $this->driverRuns($organisationId, null)->get();
        $groups = [];

        foreach ($rows as $row) {
            $key = $row->driver_user_id.'|'.$row->currency_code;

            $groups[$key] ??= [
                'driver_user_id' => (string) $row->driver_user_id,
                'display_name' => is_string($row->display_name) ? $row->display_name : null,
                'currency_code' => (string) $row->currency_code,
                'collected_minor' => 0,
                'runs' => [],
            ];

            $groups[$key]['collected_minor'] += (int) $row->amount_minor;
            $groups[$key]['runs'][] = $this->run($row);
        }

        return array_values($groups);
    }

    /**
     * Every courier with delivered orders still owing, each with their runs.
     *
     * @return list<array{courier_name: string, currency_code: string, due_minor: int, fee_minor: int, runs: list<array{job_id: string, order_id: string, order_number: string, delivered_at: string|null, amount_minor: int, fee_minor: int, reference: string|null}>}>
     */
    public function couriers(string $organisationId): array
    {
        $rows = $this->courierRuns($organisationId, null)->get();
        $groups = [];

        foreach ($rows as $row) {
            $key = $row->courier_name.'|'.$row->currency_code;

            $groups[$key] ??= [
                'courier_name' => (string) $row->courier_name,
                'currency_code' => (string) $row->currency_code,
                'due_minor' => 0,
                'fee_minor' => 0,
                'runs' => [],
            ];

            $groups[$key]['due_minor'] += (int) $row->amount_minor;
            $groups[$key]['fee_minor'] += (int) $row->fee_minor;
            $groups[$key]['runs'][] = [
                ...$this->run($row),
                'fee_minor' => (int) $row->fee_minor,
                'reference' => is_string($row->courier_reference) ? $row->courier_reference : null,
            ];
        }

        return array_values($groups);
    }

    /**
     * Settle these runs against what was handed in.
     *
     * @param  list<string>  $jobIds
     *
     * @throws ApiException
     * @throws ValidationException
     */
    public function settle(string $organisationId, array $jobIds, int $handedInMinor, ?string $shortReason, string $actorUserId): CashSettlement
    {
        $settlement = DB::transaction(function () use ($organisationId, $jobIds, $handedInMinor, $shortReason, $actorUserId): CashSettlement {
            DB::table('delivery_jobs')->where('organisation_id', $organisationId)->whereIn('id', $jobIds)->lockForUpdate()->get(['id']);

            $driver = $this->driverRuns($organisationId, $jobIds)->get();
            $courier = $this->courierRuns($organisationId, $jobIds)->get();
            $rows = $driver->isNotEmpty() ? $driver : $courier;

            if ($rows->count() !== count($jobIds) || ($driver->isNotEmpty() && $courier->isNotEmpty())) {
                throw new ApiException(ErrorCode::ResourceConflict, 'These runs are no longer waiting to be settled. Reload and try again.');
            }

            $isCourier = $driver->isEmpty();
            $party = $isCourier ? 'courier_name' : 'driver_user_id';

            if ($rows->unique($party)->count() > 1 || $rows->unique('currency_code')->count() > 1) {
                throw ValidationException::withMessages(['job_ids' => 'One hand-in covers one driver or courier, in one currency.']);
            }

            $expected = (int) $rows->sum('amount_minor');
            $fee = $isCourier ? (int) $rows->sum('fee_minor') : 0;
            $short = $expected - $fee - $handedInMinor;

            if ($short < 0) {
                throw ValidationException::withMessages(['handed_in_minor' => 'That is more than these runs brought in.']);
            }

            if ($short > 0 && ($shortReason === null || trim($shortReason) === '')) {
                throw ValidationException::withMessages(['short_reason' => 'Say why the hand-in is short.']);
            }

            /** @var stdClass $first */
            $first = $rows->first();

            $settlement = new CashSettlement;
            $settlement->organisation_id = $organisationId;
            $settlement->kind = $isCourier ? 'courier' : 'driver';
            $settlement->driver_user_id = $isCourier ? null : (string) $first->driver_user_id;
            $settlement->courier_name = $isCourier ? (string) $first->courier_name : null;
            $settlement->currency_code = (string) $first->currency_code;
            $settlement->expected_minor = $expected;
            $settlement->fee_minor = $fee;
            $settlement->handed_in_minor = $handedInMinor;
            $settlement->short_minor = $short;
            $settlement->short_reason = $short > 0 ? trim((string) $shortReason) : null;
            $settlement->recorded_by = $actorUserId;
            $settlement->recorded_at = CarbonImmutable::now();
            $settlement->save();

            DB::table('delivery_jobs')->whereIn('id', $jobIds)->update(['cash_settlement_id' => $settlement->getKey()]);

            if ($isCourier) {
                $this->writeCourierReceipts($rows, $actorUserId);
            }

            return $settlement;
        });

        $this->audit->record(
            'order.cash_settled',
            actorUserId: $actorUserId,
            subjectType: 'cash_settlement',
            subjectId: (string) $settlement->getKey(),
            metadata: [
                'kind' => $settlement->kind,
                'run_count' => count($jobIds),
                'expected_minor' => $settlement->expected_minor,
                'fee_minor' => $settlement->fee_minor,
                'handed_in_minor' => $settlement->handed_in_minor,
                'short_minor' => $settlement->short_minor,
                'currency' => $settlement->currency_code,
            ],
        );

        if ($settlement->short_minor > 0) {
            $this->alerts->send(StaffAlertType::ShortHandIn, $organisationId, (string) $settlement->getKey(), [
                'order_number' => '',
                'total_minor' => $settlement->short_minor,
                'currency_code' => $settlement->currency_code,
            ]);
        }

        return $settlement;
    }

    /**
     * A manager accepts a short hand-in. Only a short one waits for this, and once.
     *
     * @throws ApiException
     */
    public function signOff(CashSettlement $settlement, string $actorUserId): CashSettlement
    {
        $signed = CashSettlement::query()->whereKey($settlement->getKey())
            ->where('short_minor', '>', 0)
            ->whereNull('signed_off_at')
            ->update(['signed_off_by' => $actorUserId, 'signed_off_at' => now()]);

        if ($signed === 0) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This hand-in has nothing waiting for a sign-off.');
        }

        $this->audit->record(
            'order.cash_short_signed_off',
            actorUserId: $actorUserId,
            subjectType: 'cash_settlement',
            subjectId: (string) $settlement->getKey(),
            metadata: ['short_minor' => $settlement->short_minor, 'currency' => $settlement->currency_code],
        );

        return $settlement->refresh();
    }

    /**
     * @param  list<string>|null  $jobIds  null for every run waiting
     */
    private function driverRuns(string $organisationId, ?array $jobIds): Builder
    {
        return $this->runs($organisationId, $jobIds)
            ->leftJoin('user_profiles', 'user_profiles.user_id', '=', 'jobs.driver_user_id')
            ->whereNotNull('jobs.driver_user_id')
            ->whereNull('jobs.courier_name')
            ->whereRaw('('.self::COLLECTED_SQL.') > 0')
            ->select(['jobs.id as job_id', 'jobs.driver_user_id', 'jobs.delivered_at', 'orders.id as order_id', 'orders.order_number', 'orders.currency_code'])
            ->selectRaw('('.self::COLLECTED_SQL.') as amount_minor')
            ->selectRaw("nullif(trim(coalesce(user_profiles.given_name, '') || ' ' || coalesce(user_profiles.family_name, '')), '') as display_name");
    }

    /**
     * @param  list<string>|null  $jobIds  null for every run waiting
     */
    private function courierRuns(string $organisationId, ?array $jobIds): Builder
    {
        return $this->runs($organisationId, $jobIds)
            ->whereNotNull('jobs.courier_name')
            ->where('orders.payment_method', '<>', 'wish')
            ->whereRaw('('.self::DUE_SQL.') > 0')
            ->select(['jobs.id as job_id', 'jobs.courier_name', 'jobs.courier_reference', 'jobs.delivered_at', 'orders.id as order_id', 'orders.order_number', 'orders.currency_code'])
            ->selectRaw('coalesce(jobs.courier_fee_minor, 0) as fee_minor')
            ->selectRaw('('.self::DUE_SQL.') as amount_minor');
    }

    /**
     * Delivered runs no hand-in has covered, oldest first. Read as tables, as
     * `OrderDeskQueue` reads runs, with the organisation named on each.
     *
     * @param  list<string>|null  $jobIds
     */
    private function runs(string $organisationId, ?array $jobIds): Builder
    {
        return DB::table('delivery_jobs as jobs')
            ->join('orders', 'orders.id', '=', 'jobs.order_id')
            ->where('jobs.organisation_id', $organisationId)
            ->where('orders.organisation_id', $organisationId)
            ->where('jobs.status', 'delivered')
            ->whereNull('jobs.cash_settlement_id')
            ->where('jobs.predates_settlement', false)
            ->when($jobIds !== null, fn (Builder $query): Builder => $query->whereIn('jobs.id', $jobIds ?? []))
            ->orderBy('jobs.delivered_at')
            ->orderBy('jobs.id');
    }

    /**
     * @return array{job_id: string, order_id: string, order_number: string, delivered_at: string|null, amount_minor: int}
     */
    private function run(stdClass $row): array
    {
        return [
            'job_id' => (string) $row->job_id,
            'order_id' => (string) $row->order_id,
            'order_number' => (string) $row->order_number,
            'delivered_at' => is_string($row->delivered_at) ? CarbonImmutable::parse($row->delivered_at)->toIso8601String() : null,
            'amount_minor' => (int) $row->amount_minor,
        ];
    }

    /**
     * Each order's lock is taken as `OrderPaymentReceiptStoreController` takes it,
     * so the balance read above cannot have moved a receipt into this one.
     *
     * @param  Collection<int, stdClass>  $rows
     *
     * @throws ApiException
     */
    private function writeCourierReceipts(Collection $rows, string $actorUserId): void
    {
        foreach ($rows as $row) {
            $order = Order::query()->whereKey((string) $row->order_id)->lockForUpdate()->first();

            if (! $order instanceof Order) {
                throw new ApiException(ErrorCode::ResourceNotFound);
            }

            $due = $order->total_minor - $order->receivedMinor();

            if ($due !== (int) $row->amount_minor) {
                throw new ApiException(ErrorCode::ResourceConflict, 'A payment was recorded on one of these orders. Reload and try again.');
            }

            $reference = is_string($row->courier_reference) ? $row->courier_reference : null;

            $this->receipts->audit($this->receipts->write($order, $order->payment_method, $due, $actorUserId, $reference));
        }
    }
}
