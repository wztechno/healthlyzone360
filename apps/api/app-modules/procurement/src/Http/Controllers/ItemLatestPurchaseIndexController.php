<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Presenters\SupplierPresenter;
use Healthy360\Procurement\Services\LastPurchasePriceQuery;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * GET /catalogue/procurement/item-purchases/latest?stock_item_ids[]=… — the
 * newest purchase of each named shelf, across every supplier (§3.4).
 *
 * **This endpoint exists because of a module boundary, and it is worth saying
 * so plainly.** The stock screen wants a "last purchase" column, but the stock
 * list is served by Inventory, and Inventory may not import Procurement — that
 * direction is the cycle `ModuleRegistryTest` refuses. So the price is served
 * from Procurement, keyed by `stock_item_id`, and the client joins the two
 * lists it already holds. A batch read rather than a per-row one for the same
 * reason the supplier page has one: sixty visible shelves must cost one
 * request, not sixty.
 *
 * Two hundred ids is the cap — comfortably more than a screen renders at once,
 * and small enough that the `IN` list stays a bounded statement rather than
 * something a malformed client can turn into a table scan.
 *
 * Behind `inventory.view_organisation`, with the money behind
 * `inventory.view_costs_organisation` on the presenter's usual terms: without
 * the cost code the amount and its currency are `null` and `costs_redacted` is
 * `true`, while the date, quantity, unit and supplier remain. The alternative —
 * a `403` — would blank the whole column for a person who may legitimately see
 * *that* something was last bought on Tuesday, and would make "hidden" and
 * "never bought" indistinguishable on screen.
 *
 * Items with no priced receipt are simply absent from the answer rather than
 * present with nulls: "never bought" is the absence of a purchase, and a row of
 * nulls would be a purchase-shaped object claiming otherwise.
 */
final class ItemLatestPurchaseIndexController
{
    /** More than any screen renders at once, and a bound a malformed client cannot exceed. */
    private const int MAX_ITEMS = 200;

    public function __construct(private readonly SupplierPresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(
        Request $request,
        LastPurchasePriceQuery $lastPurchases,
        TenantContext $context,
    ): JsonResponse {
        $validated = $request->validate([
            'stock_item_ids' => ['required', 'array', 'max:'.self::MAX_ITEMS],
            'stock_item_ids.*' => ['uuid'],
        ]);

        /** @var list<string> $stockItemIds */
        $stockItemIds = array_values(array_unique(array_map(
            static fn (mixed $id): string => (string) $id,
            $validated['stock_item_ids'],
        )));

        $showCosts = Gate::allows('inventory.view_costs_organisation');

        $prices = $lastPurchases->perItem($context->organisationId(), $stockItemIds);

        $purchases = [];

        foreach ($prices as $stockItemId => $row) {
            $purchases[] = $this->presenter->itemLatestPurchase($stockItemId, $row, $showCosts);
        }

        return ApiResponse::data(
            ['purchases' => $purchases],
            [
                'count' => count($purchases),
                'requested_count' => count($stockItemIds),
                'costs_redacted' => ! $showCosts,
            ],
        );
    }
}
