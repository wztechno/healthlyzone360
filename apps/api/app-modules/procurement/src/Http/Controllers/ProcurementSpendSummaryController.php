<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Procurement\Presenters\ProcurementSpendPresenter;
use Healthy360\Procurement\Services\ProcurementSpendQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * GET /catalogue/procurement/spend-summary — the weekly and monthly purchase
 * check (§3.7, §6).
 *
 * The same goods-receipt ledger the purchases screen browses line by line, rolled
 * up into the periods a manager reconciles in: ISO weeks or calendar months over
 * the branch-local `received_on`. Per period and per currency — never one total
 * across currencies, because this system has no exchange rate (§4.4) — with the
 * item subtotal, the receipt-level charges and the supplier-invoice total kept as
 * separate named values, and the unpriced work visibly counted rather than
 * quietly omitted.
 *
 * The aggregation itself is {@see ProcurementSpendQuery}, shared with the monthly
 * cost report exactly as §3.7 requires, so the two surfaces cannot disagree about
 * a month's spend.
 *
 * ## The window is always bounded, and the bound is the cap
 *
 * A summary with no dates would scan a kitchen's whole trading history and answer
 * with hundreds of week rows nobody asked for. So `from`/`to` are optional and
 * their **absence** means the most recent window rather than everything: 53 weeks
 * or 24 months back from today. An explicit range wider than that window is
 * refused with the cap named, rather than silently truncated at one end — a
 * client that asked for three years and got two would draw a chart with a missing
 * year in it and no way to know.
 *
 * `today` here is the server's own calendar day, not a branch's. It bounds a
 * convenience default and makes no business claim; every explicit range is exact,
 * and the periods themselves are grouped on the branch-local business date.
 *
 * ## Breakdowns are opt-in
 *
 * §3.7 offers supplier and stock-item breakdowns "without N+1", and the way to
 * keep that promise honest is to make them cost one query each *and* to charge
 * that query only to callers who asked: `include=suppliers,items`. The default
 * payload is a period list a screen can render whole.
 *
 * Behind `inventory.view_costs_organisation` at the route (§5): weekly and
 * monthly purchase financials are the cost holder's read, on the same code as the
 * purchases ledger and the monthly cost report. A receiving clerk who may post a
 * delivery gets a 403 here rather than the kitchen's spend.
 */
final class ProcurementSpendSummaryController
{
    /** ISO weeks a single request may span — the payload cap, and the default window. */
    private const int MAX_WEEKS = 53;

    /** Calendar months a single request may span. */
    private const int MAX_MONTHS = 24;

    public function __construct(
        private readonly ProcurementSpendQuery $spend,
        private readonly ProcurementSpendPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $organisationId = $context->organisationId();

        $validated = $request->validate([
            'group_by' => ['required', Rule::in([ProcurementSpendQuery::WEEK, ProcurementSpendQuery::MONTH])],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'branch_id' => [
                'nullable',
                'uuid',
                Rule::exists('organisation_branches', 'id')->where('organisation_id', $organisationId),
            ],
            'supplier_id' => [
                'nullable',
                'uuid',
                Rule::exists('suppliers', 'id')->where('organisation_id', $organisationId),
            ],
            'stock_item_id' => [
                'nullable',
                'uuid',
                Rule::exists('stock_items', 'id')->where('organisation_id', $organisationId),
            ],
            'include' => ['nullable', 'string'],
        ]);

        /** @var string $groupBy */
        $groupBy = $validated['group_by'];
        $range = $this->range($groupBy, $validated['from'] ?? null, $validated['to'] ?? null);

        $periods = $this->spend->forOrganisation(
            $organisationId,
            $groupBy,
            $range['from'],
            $range['to'],
            [
                'branch_id' => $validated['branch_id'] ?? null,
                'supplier_id' => $validated['supplier_id'] ?? null,
                'stock_item_id' => $validated['stock_item_id'] ?? null,
            ],
            $this->include($validated['include'] ?? null),
        );

        return ApiResponse::data([
            'group_by' => $groupBy,
            'from' => $range['from'],
            'to' => $range['to'],
            'periods' => array_map(fn (array $period): array => $this->presenter->period($period), $periods),
        ]);
    }

    /**
     * The window this request actually reads, defaulted and capped.
     *
     * Both bounds are always resolved to a real date and echoed in the response:
     * a client that sent neither has to be able to label the chart it just drew,
     * and a client that sent one has to know what the other became.
     *
     * @return array{from: string, to: string}
     *
     * @throws ApiException
     */
    private function range(string $groupBy, ?string $from, ?string $to): array
    {
        $today = CarbonImmutable::now('UTC')->startOfDay();
        $end = $to === null ? $today : CarbonImmutable::parse($to, 'UTC')->startOfDay();

        $start = $from === null
            ? ($groupBy === ProcurementSpendQuery::WEEK
                ? $end->subWeeks(self::MAX_WEEKS - 1)
                : $end->subMonthsNoOverflow(self::MAX_MONTHS - 1)->startOfMonth())
            : CarbonImmutable::parse($from, 'UTC')->startOfDay();

        $limit = $groupBy === ProcurementSpendQuery::WEEK
            ? $start->addWeeks(self::MAX_WEEKS)
            : $start->addMonthsNoOverflow(self::MAX_MONTHS);

        if ($end >= $limit) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                $groupBy === ProcurementSpendQuery::WEEK
                    ? 'A weekly summary covers at most 53 weeks at a time. Narrow the date range.'
                    : 'A monthly summary covers at most 24 months at a time. Narrow the date range.',
                [
                    'parameter' => 'to',
                    'max_periods' => $groupBy === ProcurementSpendQuery::WEEK ? self::MAX_WEEKS : self::MAX_MONTHS,
                ],
            );
        }

        return ['from' => $start->toDateString(), 'to' => $end->toDateString()];
    }

    /**
     * The breakdowns this request asked for, from a comma-separated `include`.
     *
     * An unrecognised token is refused rather than ignored: a client asking for
     * `include=vendors` and receiving a payload with no breakdown in it would
     * have no way to tell a typo from an empty result.
     *
     * @return list<string>
     *
     * @throws ApiException
     */
    private function include(?string $include): array
    {
        if ($include === null || trim($include) === '') {
            return [];
        }

        $allowed = [ProcurementSpendQuery::INCLUDE_SUPPLIERS, ProcurementSpendQuery::INCLUDE_ITEMS];
        $requested = [];

        foreach (explode(',', $include) as $token) {
            $trimmed = trim($token);

            if ($trimmed === '') {
                continue;
            }

            if (! in_array($trimmed, $allowed, true)) {
                throw new ApiException(
                    ErrorCode::ValidationFailed,
                    'That breakdown does not exist on the spend summary.',
                    ['parameter' => 'include', 'allowed' => $allowed],
                );
            }

            $requested[] = $trimmed;
        }

        return array_values(array_unique($requested));
    }
}
