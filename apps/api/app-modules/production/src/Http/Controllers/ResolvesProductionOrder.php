<?php

declare(strict_types=1);

namespace Healthy360\Production\Http\Controllers;

use Healthy360\Production\Models\ProductionOrder;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * The three things every production endpoint does before it does anything else
 * (PROD1).
 *
 * **Resolving is a tenancy boundary, not a lookup.** A batch belonging to another
 * kitchen is a **404**, never a 403: telling somebody that a production order
 * exists and is not theirs is itself a disclosure — it confirms a competitor runs
 * batches, and how many. The scoped query answers both questions at once.
 *
 * **Costs are a separate authority from the desk.** `withCosts()` asks the
 * checker rather than the route, because the money is redacted *inside* the
 * payload. A chef reads every quantity on a batch and no money at all, and a 403
 * at the door would blank the screen for somebody entitled to most of it.
 *
 * **`If-Match` is checked here rather than in a middleware** for the reason the
 * middleware itself cannot: it can insist the header is present, and only the row
 * knows whether the number in it is still current.
 */
trait ResolvesProductionOrder
{
    /**
     * @throws ApiException when the batch is not this organisation's
     */
    private function resolveOrder(string $productionOrder, TenantContext $context): ProductionOrder
    {
        /** @var ProductionOrder|null $order */
        $order = ProductionOrder::query()
            ->withoutGlobalScopes()
            // The names the surface renders, resolved with the row rather than
            // per field: a batch detail asking for its ingredient's name
            // separately is one more round trip for a string.
            ->with(['productionItem:id,name_en', 'plannedYieldUnit:id,code'])
            ->where('organisation_id', $context->organisationId())
            ->whereKey($productionOrder)
            ->first();

        if (! $order instanceof ProductionOrder) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $order;
    }

    private function withCosts(): bool
    {
        return Gate::allows('production.view_costs_organisation');
    }

    /**
     * @throws StaleLockVersion when the client's version is not the row's
     */
    private function assertFresh(Request $request, ProductionOrder $order): void
    {
        $expected = RequirePrecondition::lockVersion($request);

        // A wildcard (`If-Match: *`) means "as long as it exists", and it does —
        // the resolve above already answered that.
        if ($expected !== null && $expected !== $order->lock_version) {
            throw new StaleLockVersion($order->lock_version);
        }
    }
}
