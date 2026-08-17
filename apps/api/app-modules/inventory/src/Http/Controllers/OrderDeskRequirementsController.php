<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Http\Concerns\ResolvesForecastScope;
use Healthy360\Inventory\Services\RequirementForecast;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * GET /api/v1/catalogue/order-desk/requirements — what one branch must buy to
 * cook a window, and the part of that window nobody could work out.
 *
 * **An order-desk path served by the inventory module.** The URL belongs to the
 * desk family because that is where a buyer looks; the code belongs here because
 * the arithmetic does. {@see RequirementForecast} argues the placement at
 * length, and the short version is that Orders → Inventory is a cycle the
 * architecture test rejects, while Inventory → Orders is a declared edge the
 * deduction path already uses.
 *
 * ## `branch_id` is required, and it is the one parameter that had to be
 *
 * Every other order-desk endpoint takes `branch_id` as an *optional* narrowing,
 * because an organisation-wide agent selects no branch and an organisation-wide
 * book is a real answer. This one refuses without it, and the reason is that
 * half of its response is `available` — and there is no honest organisation-wide
 * value for that. Stock is a quantity on a shelf at a site. Summing three
 * branches' shelves would tell a buyer they have enough flour while the kitchen
 * that needs it has none, which is the one mistake a buy list must never make.
 * So the branch is not a filter here, it is the question.
 *
 * What the branch does **not** narrow is the demand. That stays the whole
 * organisation's book, for the reasons the service gives: a `stock_item` is an
 * organisation-level row while a `stock_level` is a branch's, and both `orders`
 * and `subscriptions` carry nullable branch columns that any narrowing rule
 * would have had to invent a policy for. The consequence is stated in the
 * schema: for a multi-site organisation this over-states one site's share, and
 * it is never short.
 *
 * ## Thirty-one days
 *
 * Shorter than the calendar's sixty, deliberately. The calendar is a *view* of
 * commitments and looking two months ahead costs nothing but a projection; this
 * is a **buy list**, and a buy list beyond a month is speculation — the orders
 * that will fill week seven have not been taken, the menus may be rewritten, and
 * a number that precise about a month that vague invites somebody to act on it.
 * Thirty-one is a calendar month however long the month is, so "buy for
 * September" is one request rather than one and a remainder.
 *
 * The input is bounded twice over in any case: the projection behind the third
 * population has its own sixty-day ceiling on the surfaces that expose it, so the
 * cap here is about the honesty of the answer rather than the cost of computing
 * it.
 *
 * Requires `inventory.view_organisation` — the read code for everything about
 * stock, and the code the desk agent role holds. Not `inventory.view_costs_organisation`:
 * there is no money anywhere in this response, on purpose. A buy list is
 * quantities, and pricing them is the purchasing surface's job.
 */
final class OrderDeskRequirementsController
{
    use ResolvesForecastScope;

    /**
     * The furthest a single buy list may look, counted inclusively.
     *
     * Thirty-one so that a whole calendar month always fits in one request.
     */
    private const int MAX_WINDOW_DAYS = 31;

    public function __construct(private readonly RequirementForecast $forecast) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'from' => ['required', 'date_format:Y-m-d'],
            // `after_or_equal` rather than a hand-rolled comparison, so a window
            // that ends before it starts reaches the client as
            // `details.fields.to` exactly like a misspelled date — the calendar's
            // convention, one endpoint over.
            'to' => ['required', 'date_format:Y-m-d', 'after_or_equal:from'],
            // Required, unlike every sibling. See the class docblock: this is
            // the shelf being asked about, not a filter over one.
            'branch_id' => ['required', 'uuid'],
        ]);

        $from = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['from'])->startOfDay();
        $to = CarbonImmutable::createFromFormat('Y-m-d', (string) $validated['to'])->startOfDay();

        $this->refuseOversizedWindow($from, $to);

        $result = $this->forecast->forOrganisation(
            $this->forecastOrganisationId($context),
            $from,
            $to,
            (string) $validated['branch_id'],
        );

        return ApiResponse::data([
            'requirements' => $result->requirements,
            // Never folded into the rows above. A hole is not a zero — see the
            // service — and keeping the two halves apart on the wire is what
            // stops a client adding them.
            'not_computable' => [
                'days' => $result->notComputableDays,
                'reasons' => (object) $result->reasons,
            ],
        ], [
            // Echoed so a screen can prove it is showing the window and the
            // shelf it asked about, which matters more here than on a calendar:
            // two branches' buy lists look alike and mean entirely different
            // things.
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'branch_id' => (string) $validated['branch_id'],
            'max_window_days' => self::MAX_WINDOW_DAYS,
        ]);
    }

    /**
     * A window longer than the cap is a `422` naming `to`.
     *
     * A `ValidationException` rather than an `ApiException`, so the envelope, the
     * status and the field key match what a rule in the validator would have
     * produced — the calendar's argument, applied to the same class of mistake.
     *
     * @throws ValidationException
     */
    private function refuseOversizedWindow(CarbonImmutable $from, CarbonImmutable $to): void
    {
        if (! $to->greaterThan($from->addDays(self::MAX_WINDOW_DAYS - 1))) {
            return;
        }

        throw ValidationException::withMessages([
            'to' => 'A requirement window may not exceed '.self::MAX_WINDOW_DAYS.' days. Beyond a month a buy list is speculation.',
        ]);
    }
}
