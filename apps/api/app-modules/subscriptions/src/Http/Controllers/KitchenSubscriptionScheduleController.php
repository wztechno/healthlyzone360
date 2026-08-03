<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\ScheduleProjection;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/subscription-schedule — what the kitchen has coming.
 *
 * **The endpoint that makes one-day-ahead generation affordable.** §4 generates
 * a single delivery ahead so the order book is truthful, and the obvious
 * objection is that a kitchen then cannot see next week. It sees next week
 * here: `ScheduleProjection` lays the delivery rows that exist over the weekday
 * patterns of every active subscription, bounded by each one's remaining
 * balance. Nothing in that path writes anything, which is the whole guarantee —
 * a projection that materialised rows would be the phantom orders the design
 * exists to avoid, and would have to be un-materialised on every skip, pause
 * and cancellation.
 *
 * **Every row says whether it is `actual` or `projected`.** A kitchen planning
 * production needs both and must never confuse them: an actual day has an order
 * behind it, and a projected one is a customer who has not yet had the chance to
 * skip. `daily_counts` in `meta` is the number a production plan is built from,
 * with the skipped and cancelled days already excluded.
 *
 * **Under `/catalogue` and organisation-scoped, not branch-scoped**, exactly as
 * the order book is. A kitchen manager holding an organisation-wide membership
 * selects no branch, and an endpoint reading `X-Branch-Id` would show them
 * nothing until they picked one. Narrowing to a production site is the
 * `branch_id` *query* filter — a narrowing of a view the caller already has,
 * never a widening of one they do not.
 *
 * **`subscription.view_organisation`, a permission that has existed since the
 * foundation and had no endpoint until now.** Not `order.view_organisation`: a
 * subscription is a standing commercial arrangement with a captured price, and
 * the people who read the day's order list are not automatically the people who
 * should see who is committed to what and for how long. Not
 * `plan.manage_organisation` either — that is the authority to *design* plans,
 * and a production planner needs to read the schedule without being able to
 * change what the kitchen sells.
 *
 * **The window is bounded at 60 days.** The projection is O(subscriptions ×
 * days) with a per-subscription query, so an unbounded `to` is a request a
 * client can make that the kitchen cannot afford. Sixty days is two months of
 * planning, which is more than any balance this platform sells will outlast.
 *
 * No customer names, no addresses, no allergen lists — see
 * `SubscriptionPresenter::scheduleRow()`. A planner counts portions per window
 * per day; every one of those fields would be personal data on a screen that
 * does not need it, and the `customer_account_id` is there so a kitchen chasing
 * one delivery can open it on a surface that has the purpose-of-use path.
 */
final class KitchenSubscriptionScheduleController
{
    /**
     * The furthest ahead a single request may look.
     */
    private const int MAX_WINDOW_DAYS = 60;

    public function __construct(
        private readonly ScheduleProjection $projection,
        private readonly SubscriptionPresenter $presenter,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            // Unreachable behind `org.context`, and present so that a routing
            // mistake fails closed rather than projecting every kitchen's book.
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        $validated = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'branch_id' => ['nullable', 'uuid'],
        ]);

        $from = isset($validated['from'])
            ? CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'])->startOfDay()
            : CarbonImmutable::now()->startOfDay();

        $to = isset($validated['to'])
            ? CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'])->startOfDay()
            : $from->addDays(13);

        if ($to->greaterThan($from->addDays(self::MAX_WINDOW_DAYS))) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The schedule window may not exceed '.self::MAX_WINDOW_DAYS.' days.',
                ['max_window_days' => self::MAX_WINDOW_DAYS],
            );
        }

        $branchId = isset($validated['branch_id']) ? (string) $validated['branch_id'] : null;

        $rows = $this->projection->forOrganisation($organisationId, $from, $to, $branchId);

        return ApiResponse::data(
            array_map(fn (array $row): array => $this->presenter->scheduleRow($row), $rows),
            [
                'from' => $from->toDateString(),
                'to' => $to->toDateString(),
                'count' => count($rows),
                'daily_counts' => $this->projection->dailyCounts($organisationId, $from, $to, $branchId),
            ],
        );
    }
}
