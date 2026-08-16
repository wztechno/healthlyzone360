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
 * GET /api/v1/catalogue/order-desk/requirements/shortfall-count — how many
 * things the next week is short of, for the badge on the hub.
 *
 * ## `branch_id` is optional here and required next door, and that is the point
 *
 * The list endpoint refuses without a branch because there is no honest
 * organisation-wide `available`. That refusal is right for a screen somebody
 * navigated to and wrong for a badge nobody asked for: a hub tile that returned
 * `422` because the manager holds an organisation-wide membership would be an
 * error where there is no mistake.
 *
 * So the absent branch is answered rather than refused — with `null`, and
 * `branch_id: null` beside it so the answer says what it is about. **`null` is
 * not zero and the badge must not render it as one.** Zero shortfalls is good
 * news; not knowing is not news at all. This is the platform's em-dash rule
 * applied to a badge: the surface shows the count when there is one and shows
 * *nothing* when there is not, and it never shows a reassuring zero it did not
 * earn. `kitchen-home-screen`'s KPI tiles already collapse a pending or
 * unavailable count to `null` and render an em dash for it; this endpoint hands
 * them the same `null` for the same reason.
 *
 * ## Seven days, fixed, and not a parameter
 *
 * A badge takes no arguments. Its whole job is to be the same number every time
 * anybody glances at it, and a window a caller chose would make two people
 * looking at the same hub disagree about how bad things are. Seven days from
 * today, counted inclusively — today plus the six after it — because that is the
 * horizon a kitchen buys on: long enough that a delivery can still be arranged,
 * short enough that the demand behind it is mostly real orders rather than
 * projection.
 *
 * "Today" is the application clock rather than the branch's. `organisation_branches.timezone`
 * is unvalidated free text (a queue-slice finding), and a badge is not worth a
 * `500` on a kitchen that typed its timezone wrong; the number moves by at most
 * one day's demand at the edges either way.
 *
 * ## What is counted
 *
 * Rows whose `short` is strictly greater than zero — ingredients the shelf
 * cannot cover — and nothing else. Not `not_computable`: a hole is a different
 * problem with a different remedy (write the recipe, publish the menu) and
 * folding it into a shortfall count would send a buyer looking for something to
 * order. The requirements screen shows both, separately, which is where somebody
 * who clicked the badge is going.
 *
 * Requires `inventory.view_organisation`, the same code as the list.
 */
final class OrderDeskShortfallCountController
{
    use ResolvesForecastScope;

    /**
     * The badge's window, counted inclusively from today.
     */
    private const int WINDOW_DAYS = 7;

    /**
     * The scale a shortfall is judged at — `stock_levels.quantity`'s own, so a
     * rounding tail five decimal places down can never light a badge (H3).
     */
    private const int COMPARISON_SCALE = 4;

    public function __construct(private readonly RequirementForecast $forecast) {}

    /**
     * @throws ApiException
     * @throws ValidationException
     */
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'branch_id' => ['nullable', 'uuid'],
        ]);

        $branchId = isset($validated['branch_id']) ? (string) $validated['branch_id'] : null;

        if ($branchId === null) {
            return ApiResponse::data(['shortfall_count' => null, 'branch_id' => null]);
        }

        $from = CarbonImmutable::now()->startOfDay();
        $to = $from->addDays(self::WINDOW_DAYS - 1);

        $result = $this->forecast->forOrganisation(
            $this->forecastOrganisationId($context),
            $from,
            $to,
            $branchId,
        );

        $short = 0;

        foreach ($result->requirements as $row) {
            if (bccomp($row['short'], '0', self::COMPARISON_SCALE) > 0) {
                $short++;
            }
        }

        return ApiResponse::data([
            'shortfall_count' => $short,
            'branch_id' => $branchId,
        ], [
            // The window is echoed rather than documented-and-hoped: a badge
            // whose meaning is "the next seven days" should be able to say which
            // seven when somebody asks it.
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'window_days' => self::WINDOW_DAYS,
        ]);
    }
}
