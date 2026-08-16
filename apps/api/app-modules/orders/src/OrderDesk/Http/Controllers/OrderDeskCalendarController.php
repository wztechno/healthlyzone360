<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\OrderDesk\Services\CalendarComposition;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/order-desk/calendar — what leaves this kitchen, day by
 * day, counted three ways that are never added together.
 *
 * **Not the queue with dates on it.** The queue is the open book in the order it
 * has to be worked — two statuses, one clock, a computed sort. This is a *shape
 * of the week*: how much is committed on each day and in each slot, so that
 * somebody deciding whether to take one more delivery for Thursday can see
 * Thursday. The two share a prefix and nothing else.
 *
 * ## Three bases, no total
 *
 * `order`, `scheduled` and `projected` are three different kinds of fact — a row
 * in `orders`, a claimed subscription day with no order yet, and a day computed
 * from a weekday pattern that nothing asserts — and they are **never summed**.
 * `CalendarComposition` says at length why: they overlap in ways no arithmetic
 * expresses, and a kitchen buying ingredients off a total would buy too much.
 * There is no `total` key anywhere in this response, which is the only reliable
 * way to stop one being invented.
 *
 * **`projected` is a forecast and the schema says so.** The projection behind it
 * reads weekdays and remaining balances and never consults
 * `next_generation_date`, so after an outage — while the hourly generator
 * catches up one delivery per tick — it keeps showing the pattern the customer
 * bought rather than the backlog the kitchen is working. It is the right number
 * for planning and the wrong number for promising, and it is labelled.
 *
 * ## Both codes, and why neither would have done alone
 *
 * `order.view_organisation` **and** `subscription.view_organisation` — the
 * desk's first two-code route, and the first response here that unions two
 * books. Reading it with the order code alone would disclose the shape of a
 * kitchen's standing arrangements to somebody the kitchen decided may not see
 * them; that is precisely the distinction
 * `KitchenSubscriptionScheduleController` exists to make, and a calendar that
 * quietly aggregated around it would make the distinction ornamental. Reading it
 * with the subscription code alone would disclose the day's real orders to a
 * production planner who was never given the order book.
 *
 * The stacking is the platform's existing idiom rather than an invention here:
 * the group states the code the desk family shares and the route adds the one
 * only it needs, exactly as `POST /catalogue/recipes/{recipe}/versions/{version}
 * /cost-snapshots` and the B2B offboarding routes do. The alias may repeat
 * because Laravel deduplicates gathered middleware on the *resolved string*, and
 * `RequirePermission:order.view_organisation` is not
 * `RequirePermission:subscription.view_organisation`. Both run, in the order they
 * are declared, and the first to deny is the one whose code the 403 names. The
 * suite pins it from both sides.
 *
 * ## The sixty-day cap is enforced here, not inherited
 *
 * `KitchenSubscriptionScheduleController::MAX_WINDOW_DAYS` bounds *that*
 * endpoint. It is a private constant on another controller in another module and
 * it protects nothing here, so this route carries its own — and it has to, since
 * the cost it is defending against is the same O(subscriptions × days)
 * projection with a query per subscription.
 *
 * Sixty days counted **inclusively**: `from` and `to` are both in the window, so
 * sixty is the largest window that answers and sixty-one is a `422`. `from` and
 * `to` are both required, unlike the schedule endpoint's defaults — a calendar
 * screen always knows which weeks it is showing, and a server-invented fortnight
 * would be a different fortnight from the one on the grid.
 *
 * ## `branch_id` is a query parameter
 *
 * The order-desk convention, and for the reason the queue gives: this is an
 * organisation-wide book that may be *narrowed* to one production site, and a
 * manager holding an organisation-wide membership selects no branch. Unlike the
 * queue it names no clock here — a calendar's days are the days the customer
 * asked for, which are already dates rather than instants, so there is no
 * timezone for a branch to supply.
 */
final class OrderDeskCalendarController
{
    /**
     * The furthest a single request may look, counted inclusively.
     *
     * Sixty days is two months of planning, which is longer than any balance
     * this platform sells will outlast. The number matches
     * `KitchenSubscriptionScheduleController`'s deliberately — the same
     * projection is behind both, and two different limits on one cost would be
     * two different answers to "how far ahead may a kitchen look".
     */
    private const int MAX_WINDOW_DAYS = 60;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly CalendarComposition $calendar,
    ) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            // `after_or_equal` rather than a hand-rolled comparison: a window
            // that ends before it starts is a malformed field, and a client
            // reads `details.fields.to` for it exactly as it does for a
            // misspelled date.
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            'branch_id' => ['nullable', 'uuid'],
        ]);

        $from = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'])->startOfDay();
        $to = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'])->startOfDay();

        $this->refuseOversizedWindow($from, $to);

        $branchId = isset($validated['branch_id']) ? (string) $validated['branch_id'] : null;

        $days = $this->calendar->forOrganisation(
            $this->locator->sellerId(),
            $from,
            $to,
            $branchId,
        );

        return ApiResponse::data(['days' => $days], [
            // Echoed so a screen rendering a grid can prove it is rendering the
            // window it asked for. `day_count` counts *squares*, not anything in
            // them: there is deliberately no count of work anywhere in this
            // response, because that would be the total the three bases must
            // never have.
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'day_count' => count($days),
            'max_window_days' => self::MAX_WINDOW_DAYS,
        ]);
    }

    /**
     * A window longer than the cap is a `422` naming `to`.
     *
     * A `ValidationException` rather than an `ApiException`, so the envelope,
     * the status and the field key are identical to what a rule in the validator
     * would have produced — a client branches on `validation.failed` and reads
     * `details.fields.to` whether the date was misspelled, before `from`, or
     * simply too far away. `ErrorCode::RequestInvalid` would have been a `400`
     * and a different shape for the same class of mistake.
     *
     * @throws ValidationException
     */
    private function refuseOversizedWindow(CarbonImmutable $from, CarbonImmutable $to): void
    {
        if (! $to->greaterThan($from->addDays(self::MAX_WINDOW_DAYS - 1))) {
            return;
        }

        throw ValidationException::withMessages([
            'to' => 'The calendar window may not exceed '.self::MAX_WINDOW_DAYS.' days.',
        ]);
    }
}
