<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Orders\Models\DailyClose;
use Healthy360\Organisations\Services\OrganisationTimezone;
use Healthy360\Support\Alerts\StaffAlerts;
use Healthy360\Support\Alerts\StaffAlertType;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * What should be in the till, and writing down what was.
 *
 * ## One till per currency, and a shift is everything since the last close
 *
 * There is nothing to open: the shift runs from the last close, or from the start
 * of the local day for a kitchen's first. Closing twice in a day makes two shifts.
 * Receipts and hand-ins carry no branch, so there is one till per kitchen.
 *
 * ## The cash comes from the rows the settlement and the cash report read
 *
 * Nothing new is recorded. The expected figure is the float, plus:
 *
 * - **Counter cash**: non-Whish receipts in the shift, the same rows the cash
 *   report lists, less the ones that never reached the till. A driver's receipt is
 *   written at the door and a courier's when their batch settles, and both arrive
 *   as a hand-in instead.
 * - **Hand-ins**: `cash_settlements.handed_in_minor`, net of a courier's fee and
 *   any short amount, because that is what came through the door.
 * - **Cash refunds**: non-Whish refunds completed in the shift, taken out of the
 *   till. A receipt correction counts only when the receipt it corrects is in the
 *   same shift. An older one was never in this till, and its own close already
 *   came up short for it.
 *
 * ## What is refused
 *
 * A short close needs a reason and waits for a manager's sign-off. The app takes
 * no pay decision: nothing else follows from it. A count above expected is written
 * down too, with no sign-off, because the ruling only covers short. A shift with
 * nothing in it is refused, which is what stops a second press writing a second
 * shift: the lock makes it wait, and it then finds nothing to close.
 */
final readonly class DailyCloses
{
    /** A cash method: Whish never touches the till. */
    private const string NOT_WHISH = 'wish';

    /** How far back to look for a currency this kitchen has been handling. */
    private const int CURRENCY_LOOKBACK_DAYS = 31;

    /** The receipts that were cash in the till rather than on the road. */
    private const string AT_THE_COUNTER = <<<'SQL'
        not exists (
            select 1
            from delivery_jobs as jobs
            left join cash_settlements as settled on settled.id = jobs.cash_settlement_id
            where jobs.order_id = order_payment_receipts.order_id
              and (
                order_payment_receipts.confirmed_by = jobs.driver_user_id
                or (jobs.courier_name is not null and order_payment_receipts.confirmed_at >= settled.recorded_at)
              )
        )
        SQL;

    public function __construct(
        private OrganisationTimezone $timezones,
        private StaffAlerts $alerts,
        private AuditRecorder $audit,
    ) {}

    /**
     * Each currency with money moving since its last close.
     *
     * @return array{timezone: string, open: list<array{currency_code: string, business_date: string, opened_at: string, suggested_float_minor: int, counter_cash_minor: int, handed_in_minor: int, cash_refunds_minor: int}>}
     */
    public function open(string $organisationId): array
    {
        $timezone = $this->timezones->forOrganisationId($organisationId);
        $now = CarbonImmutable::now();
        $open = [];

        foreach ($this->currencies($organisationId, $now) as $currency) {
            $shift = $this->shift($organisationId, $currency, $timezone);
            $figures = $this->figures($organisationId, $currency, $shift['opened_at'], $now);

            if ($figures['counter_cash_minor'] === 0 && $figures['handed_in_minor'] === 0 && $figures['cash_refunds_minor'] === 0) {
                continue;
            }

            $open[] = [
                'currency_code' => $currency,
                'business_date' => $shift['opened_at']->setTimezone($timezone)->toDateString(),
                'opened_at' => $shift['opened_at']->toIso8601String(),
                'suggested_float_minor' => $shift['float_minor'],
                ...$figures,
            ];
        }

        return ['timezone' => $timezone, 'open' => $open];
    }

    /**
     * Close the shift in this currency against what was counted.
     *
     * The advisory lock makes the second of two presses wait, then find the shift
     * closed. The figures are read here and not taken from the screen, so a sale
     * made while somebody was counting lands in this close.
     *
     * @throws ApiException
     * @throws ValidationException
     */
    public function close(string $organisationId, string $currencyCode, int $openingFloatMinor, int $countedMinor, ?string $reason, string $actorUserId): DailyClose
    {
        $timezone = $this->timezones->forOrganisationId($organisationId);

        $close = DB::transaction(function () use ($organisationId, $currencyCode, $openingFloatMinor, $countedMinor, $reason, $actorUserId, $timezone): DailyClose {
            DB::statement('select pg_advisory_xact_lock(hashtextextended(?, 0))', ["daily-close:{$organisationId}:{$currencyCode}"]);

            $now = CarbonImmutable::now();
            $shift = $this->shift($organisationId, $currencyCode, $timezone);
            $figures = $this->figures($organisationId, $currencyCode, $shift['opened_at'], $now);

            if (array_sum($figures) === 0) {
                throw new ApiException(ErrorCode::ResourceConflict, 'No cash has moved since the last close. Reload and try again.');
            }

            $expected = $openingFloatMinor + $figures['counter_cash_minor'] + $figures['handed_in_minor'] - $figures['cash_refunds_minor'];
            $variance = $countedMinor - $expected;
            $reason = $reason === null || trim($reason) === '' ? null : trim($reason);

            if ($variance < 0 && $reason === null) {
                throw ValidationException::withMessages(['variance_reason' => 'Say why the count is short.']);
            }

            $close = new DailyClose;
            $close->organisation_id = $organisationId;
            $close->currency_code = $currencyCode;
            $close->business_date = $shift['opened_at']->setTimezone($timezone)->startOfDay();
            $close->opened_at = $shift['opened_at'];
            $close->closed_at = $now;
            $close->opening_float_minor = $openingFloatMinor;
            $close->counter_cash_minor = $figures['counter_cash_minor'];
            $close->handed_in_minor = $figures['handed_in_minor'];
            $close->cash_refunds_minor = $figures['cash_refunds_minor'];
            $close->expected_minor = $expected;
            $close->counted_minor = $countedMinor;
            $close->variance_minor = $variance;
            $close->variance_reason = $reason;
            $close->recorded_by = $actorUserId;
            $close->save();

            return $close;
        });

        $this->audit->record(
            'order.daily_closed',
            actorUserId: $actorUserId,
            subjectType: 'daily_close',
            subjectId: (string) $close->getKey(),
            metadata: [
                'expected_minor' => $close->expected_minor,
                'counted_minor' => $close->counted_minor,
                'variance_minor' => $close->variance_minor,
                'currency' => $close->currency_code,
            ],
        );

        if ($close->variance_minor < 0) {
            $this->alerts->send(StaffAlertType::ShortClose, $organisationId, (string) $close->getKey(), [
                'order_number' => $close->business_date->toDateString(),
                'total_minor' => abs($close->variance_minor),
                'currency_code' => $close->currency_code,
            ]);
        }

        return $close;
    }

    /**
     * A manager accepts a short close. Only a short one waits for this, and once.
     *
     * @throws ApiException
     */
    public function signOff(DailyClose $close, string $actorUserId): DailyClose
    {
        $signed = DailyClose::query()->whereKey($close->getKey())
            ->where('variance_minor', '<', 0)
            ->whereNull('signed_off_at')
            ->update(['signed_off_by' => $actorUserId, 'signed_off_at' => now()]);

        if ($signed === 0) {
            throw new ApiException(ErrorCode::ResourceConflict, 'This close has nothing waiting for a sign-off.');
        }

        $this->audit->record(
            'order.daily_close_signed_off',
            actorUserId: $actorUserId,
            subjectType: 'daily_close',
            subjectId: (string) $close->getKey(),
            metadata: ['variance_minor' => $close->variance_minor, 'currency' => $close->currency_code],
        );

        return $close->refresh();
    }

    /**
     * The currencies money moved in lately, and any closed before.
     *
     * @return list<string>
     */
    private function currencies(string $organisationId, CarbonImmutable $now): array
    {
        $since = $now->subDays(self::CURRENCY_LOOKBACK_DAYS);

        return DB::table('order_payment_receipts')
            ->where('organisation_id', $organisationId)->where('confirmed_at', '>=', $since)->select('currency_code')
            ->union(DB::table('cash_settlements')->where('organisation_id', $organisationId)->where('recorded_at', '>=', $since)->select('currency_code'))
            ->union(DB::table('daily_closes')->where('organisation_id', $organisationId)->select('currency_code'))
            ->orderBy('currency_code')
            ->pluck('currency_code')
            ->map(static fn (mixed $code): string => (string) $code)
            ->all();
    }

    /**
     * When the open shift started, and the float last counted in, which is what a
     * kitchen with a standing float starts with again.
     *
     * @return array{opened_at: CarbonImmutable, float_minor: int}
     */
    private function shift(string $organisationId, string $currencyCode, string $timezone): array
    {
        $last = DailyClose::query()
            ->where('organisation_id', $organisationId)
            ->where('currency_code', $currencyCode)
            ->orderByDesc('closed_at')
            ->first(['closed_at', 'opening_float_minor']);

        return $last instanceof DailyClose
            ? ['opened_at' => $last->closed_at, 'float_minor' => $last->opening_float_minor]
            : ['opened_at' => CarbonImmutable::now($timezone)->startOfDay()->utc(), 'float_minor' => 0];
    }

    /**
     * The window is half-open, as the cash report's is, so a row on a close's own
     * instant lands in the next shift and never in both.
     *
     * @return array{counter_cash_minor: int, handed_in_minor: int, cash_refunds_minor: int}
     */
    private function figures(string $organisationId, string $currencyCode, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $receipts = fn (): Builder => DB::table('order_payment_receipts')
            ->where('order_payment_receipts.organisation_id', $organisationId)
            ->where('order_payment_receipts.currency_code', $currencyCode)
            ->where('order_payment_receipts.method', '<>', self::NOT_WHISH)
            ->where('order_payment_receipts.confirmed_at', '>=', $from)
            ->where('order_payment_receipts.confirmed_at', '<', $to)
            ->whereRaw(self::AT_THE_COUNTER);

        $handedIn = DB::table('cash_settlements')
            ->where('organisation_id', $organisationId)
            ->where('currency_code', $currencyCode)
            ->where('recorded_at', '>=', $from)
            ->where('recorded_at', '<', $to)
            ->sum('handed_in_minor');

        $refunds = DB::table('order_refunds')
            ->where('organisation_id', $organisationId)
            ->where('currency_code', $currencyCode)
            ->where('status', 'completed')
            ->where('method', '<>', self::NOT_WHISH)
            ->where('decided_at', '>=', $from)
            ->where('decided_at', '<', $to)
            ->where(fn (Builder $query): Builder => $query->where('kind', 'refund')->orWhere(
                fn (Builder $corrections): Builder => $corrections->where('kind', 'receipt_correction')
                    ->whereIn('order_id', $receipts()->select('order_payment_receipts.order_id')),
            ))
            ->sum('amount_minor');

        return [
            'counter_cash_minor' => (int) $receipts()->sum('order_payment_receipts.amount_minor'),
            'handed_in_minor' => (int) $handedIn,
            'cash_refunds_minor' => (int) $refunds,
        ];
    }
}
