<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Enums\FulfilmentType;
use Healthy360\Orders\OrderDesk\Http\Concerns\ResolvesDeskParty;
use Healthy360\Orders\OrderDesk\Http\Requests\QuoteOrderDeskRequest;
use Healthy360\Orders\OrderDesk\Services\DeskChannelLocator;
use Healthy360\Orders\OrderDesk\Services\DeskQuote;
use Healthy360\Orders\Services\OrderLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/order-desk/quote — what this sale would cost, and
 * everything standing in the way of it.
 *
 * **A POST that writes nothing**, for the reason `POST /catalogue/checkout/
 * preview` is one: the question has a basket in it, and a basket does not fit in
 * a query string. Nothing is created, nothing is reserved, and running it twice
 * is running it once.
 *
 * ## Refusals are the answer, not a failure
 *
 * **This endpoint returns `200` with the problems in the body.** It is the one
 * place on the platform where that is right. A withdrawn article, an unpriced
 * one, an address nobody delivers to, a cut-off that passed at three — each
 * arrives as a `reason` code beside the lines that *did* price, and the agent
 * sees both halves at once. A 422 would give them one at a time and lose the
 * total, which is the number the customer is waiting for.
 *
 * A desk agent's next sentence after a refusal is almost always "drop the soup
 * and it comes to eleven dollars", so the totals are summed over the refusal-free
 * lines and offered anyway. `quotable` is the field that stops that being a lie:
 * it is false whenever **any** refusal exists, line-level or order-level,
 * because `OrderPlacementService::composeNow()` refuses a whole placement when
 * any reason is collected. A quote showing a confident total for a basket the
 * placement would then reject is a number the agent reads out loud and then has
 * to take back.
 *
 * ## `order.view_organisation`, and deliberately not the placement code
 *
 * Quoting is reading: it names no customer it did not already know, creates
 * nothing, and commits the kitchen to nothing. Anybody who may see the day's
 * orders may ask what a basket would come to — a trainee at the counter working
 * out a price for somebody, a manager checking a tariff. The authority to
 * actually *sell* is `order.create_on_behalf_organisation` and it sits on the
 * sibling route, which is the split the desk role exists around.
 *
 * ## Both parties by identifier, never by inference
 *
 * See `ResolvesDeskParty`. `ShopperResolver` would answer with the *agent's* own
 * account, or with the kitchen's corporate buyer — and a quote priced against a
 * B2B buyer's negotiated tariff is a number nobody at this counter is entitled
 * to. The customer only matters here because `LineProbe` passes them to
 * `PriceResolver` for buyer-scoped tariffs; naming a regular is what makes their
 * price the one they are quoted.
 *
 * ## The desk channel is resolved first, and its absence is a 409
 *
 * Before anything is priced. A kitchen with no `desk` channel cannot quote at
 * all, and `DeskChannelLocator`'s `resource.conflict` says so in one sentence —
 * rather than `channel_unavailable` landing on all twelve lines, which reads as
 * "none of this food is available" when the truth is "the counter was never
 * opened".
 */
final class OrderDeskQuoteController
{
    use ResolvesDeskParty;

    public function __construct(
        private readonly OrderLocator $locator,
        private readonly DeskChannelLocator $channels,
        private readonly DeskQuote $quotes,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(QuoteOrderDeskRequest $request): JsonResponse
    {
        $payload = $request->payload();

        $organisationId = $this->locator->sellerId();
        $channel = $this->channels->forOrganisation($organisationId);

        $account = $this->deskAccount($payload['customer_account_id']);
        $address = $this->deskAddress($account, $payload['customer_address_id']);
        $branchId = $this->deskBranchId($organisationId, $payload['branch_id']);

        $requestedDate = $payload['requested_delivery_date'];

        $quote = $this->quotes->for(
            $channel,
            FulfilmentType::from($payload['fulfilment_type']),
            $payload['lines'],
            $account,
            $address,
            $branchId,
            $requestedDate === null
                ? null
                : CarbonImmutable::createFromFormat('Y-m-d', $requestedDate)->startOfDay(),
        );

        return ApiResponse::data(['quote' => $quote]);
    }
}
