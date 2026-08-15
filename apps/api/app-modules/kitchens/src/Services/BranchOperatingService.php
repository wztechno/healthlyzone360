<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * One branch's operating week — read and replaced whole.
 *
 * **The week is the unit of change**, which is why this is a PUT of seven rows
 * rather than seven addressable days. A kitchen changing its hours is changing
 * its hours: "we now close at six, and Sundays are off" is one decision, and
 * applying half of it produces a schedule nobody agreed to. Replacing the set
 * atomically also removes the only interesting concurrency hazard, which is
 * why these rows carry no `lock_version` — there is no half-week for a
 * validator to protect.
 *
 * **The branch comes from the request context, never from the body.** The
 * routes stack `branch.context`, which validates `X-Branch-Id` against the
 * caller's membership scope; a `branch_id` in the payload would be a second,
 * unvalidated way to name a branch, and the two would eventually disagree.
 * `branch.context` permits *no* branch — an organisation-wide membership may
 * legitimately select none — so this service refuses that case explicitly with
 * `context.branch_required` rather than guessing.
 *
 * **A closed day is a row.** A body that omits a weekday leaves that day
 * unconfigured, which is a different fact from being closed; a body that sends
 * it with no times says "closed". Both are storable, and only that
 * distinction lets a checkout say "we are shut on Sundays" rather than "we
 * cannot answer".
 *
 * The three CHECKs on the table are restated here as per-row messages, because
 * a constraint violation tells an operator which index failed and this tells
 * them which day is wrong.
 */
final readonly class BranchOperatingService
{
    /**
     * ISO-8601, matching `delivery_windows.weekdays` and
     * `CarbonImmutable::dayOfWeekIso`.
     */
    public const array WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * The current branch's week, in weekday order, with unconfigured days
     * absent rather than invented.
     *
     * @return list<BranchOpeningHour>
     *
     * @throws ApiException
     */
    public function week(): array
    {
        $branchId = $this->requireBranch();

        /** @var list<BranchOpeningHour> $rows */
        $rows = BranchOpeningHour::query()
            ->where('branch_id', $branchId)
            ->orderBy('weekday')
            ->get()
            ->all();

        return $rows;
    }

    /**
     * Replace the whole week.
     *
     * @param  list<array<string, mixed>>  $days  as validated by the request; re-checked here because
     *                                            the per-row rules are statements about a whole day
     * @return list<BranchOpeningHour>
     *
     * @throws ApiException
     */
    public function replace(array $days): array
    {
        $branchId = $this->requireBranch();
        $organisationId = $this->requireOrganisation();
        $prepared = $this->prepared($days);

        DB::transaction(function () use ($branchId, $organisationId, $prepared): void {
            BranchOpeningHour::withoutTenancy()->where('branch_id', $branchId)->delete();

            foreach ($prepared as $day) {
                $row = new BranchOpeningHour;
                $row->organisation_id = $organisationId;
                $row->branch_id = $branchId;
                $row->weekday = $day['weekday'];
                $row->opens_at = $day['opens_at'];
                $row->closes_at = $day['closes_at'];
                $row->order_cut_off_at = $day['order_cut_off_at'];
                $row->created_by = $this->context->userId();
                $row->save();
            }
        });

        $openDays = array_values(array_filter($prepared, static fn (array $day): bool => $day['opens_at'] !== null));

        $this->audit->record(
            'kitchen.branch_operating_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation_branch',
            subjectId: $branchId,
            metadata: [
                'changed_fields' => ['opening_hours'],
                'configured_day_count' => count($prepared),
                'open_day_count' => count($openDays),
                'closed_weekdays' => array_values(array_map(
                    static fn (array $day): int => $day['weekday'],
                    array_filter($prepared, static fn (array $day): bool => $day['opens_at'] === null),
                )),
                'cut_off_day_count' => count(array_filter($prepared, static fn (array $day): bool => $day['order_cut_off_at'] !== null)),
            ],
        );

        return $this->week();
    }

    /**
     * @param  list<array<string, mixed>>  $days  as validated by the request; re-checked here because
     *                                            the per-row rules are statements about a whole day
     * @return list<array{weekday: int, opens_at: string|null, closes_at: string|null, order_cut_off_at: string|null}>
     *
     * @throws ApiException
     */
    private function prepared(array $days): array
    {
        $prepared = [];
        $seen = [];

        foreach ($days as $index => $day) {
            $weekday = $day['weekday'] ?? null;

            if (! is_int($weekday) || ! in_array($weekday, self::WEEKDAYS, true)) {
                throw $this->invalid("days.{$index}.weekday", 'A weekday is an ISO number: 1 for Monday through 7 for Sunday.');
            }

            if (in_array($weekday, $seen, true)) {
                throw $this->invalid(
                    "days.{$index}.weekday",
                    'This weekday appears twice. A branch keeps one set of hours per day — two is a contradiction, not a split shift.',
                );
            }

            $seen[] = $weekday;

            $opensAt = $this->validatedTime($day['opens_at'] ?? null, "days.{$index}.opens_at");
            $closesAt = $this->validatedTime($day['closes_at'] ?? null, "days.{$index}.closes_at");
            $cutOffAt = $this->validatedTime($day['order_cut_off_at'] ?? null, "days.{$index}.order_cut_off_at");

            if (($opensAt === null) !== ($closesAt === null)) {
                throw $this->invalid(
                    $opensAt === null ? "days.{$index}.opens_at" : "days.{$index}.closes_at",
                    'A day is open with both times or closed with neither. Half a day is not something a customer can be told.',
                );
            }

            if ($opensAt !== null && $closesAt !== null && $closesAt <= $opensAt) {
                throw $this->invalid(
                    "days.{$index}.closes_at",
                    'A branch has to close after it opens. Overnight service is not supported yet.',
                );
            }

            if ($cutOffAt !== null && $opensAt === null) {
                throw $this->invalid(
                    "days.{$index}.order_cut_off_at",
                    'A closed day has no order cut-off. Give the day opening hours, or leave the cut-off out.',
                );
            }

            $prepared[] = [
                'weekday' => $weekday,
                'opens_at' => $opensAt,
                'closes_at' => $closesAt,
                'order_cut_off_at' => $cutOffAt,
            ];
        }

        usort($prepared, static fn (array $a, array $b): int => $a['weekday'] <=> $b['weekday']);

        return $prepared;
    }

    /**
     * @throws ApiException
     */
    private function validatedTime(mixed $value, string $field): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_string($value) || preg_match('/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/', $value) !== 1) {
            throw $this->invalid($field, 'A time is written HH:MM on a 24-hour clock, in the branch\'s own timezone.');
        }

        return mb_strlen($value) === 5 ? $value.':00' : $value;
    }

    /**
     * @throws ApiException
     */
    private function requireBranch(): string
    {
        $branchId = $this->context->branchId();

        if ($branchId === null) {
            throw new ApiException(
                ErrorCode::ContextBranchRequired,
                details: ['required_headers' => ['X-Branch-Id']],
            );
        }

        // The context resolver has already proven the branch is inside the
        // caller's membership scope. This is the second half — that it is
        // still a branch of the selected organisation — which matters because
        // a context can outlive a branch being moved or closed.
        $belongs = OrganisationBranch::withoutTenancy()
            ->whereKey($branchId)
            ->where('organisation_id', $this->requireOrganisation())
            ->exists();

        if (! $belongs) {
            throw new ApiException(ErrorCode::ContextBranchOutOfScope);
        }

        return $branchId;
    }

    /**
     * @throws ApiException
     */
    private function requireOrganisation(): string
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        return $organisationId;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
