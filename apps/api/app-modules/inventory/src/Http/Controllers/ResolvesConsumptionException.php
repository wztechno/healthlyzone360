<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\OrderConsumptionException;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * Loads the `{exception}` a retry or a resolve acts on, scoped to the caller's
 * organisation (INV1.5).
 *
 * **Not implicit route-model binding.** `OrderConsumptionException` is
 * organisation-scoped, and Laravel substitutes bindings before the tenant context
 * is resolved, so a bound parameter met the scope with no tenant and every Retry
 * and Resolve answered 500 (`MissingTenantContext`). The id arrives as a string
 * and is resolved here, after the context exists — the way
 * `ResolvesProductionOrder` does it.
 *
 * An exception belonging to another organisation is a **404**, never a 403: the
 * scoped query answers "does it exist" and "is it yours" at once.
 */
trait ResolvesConsumptionException
{
    /**
     * @throws ApiException when the exception is not this organisation's
     */
    private function resolveException(string $exception, TenantContext $context): OrderConsumptionException
    {
        $found = OrderConsumptionException::withoutTenancy()
            ->where('organisation_id', $context->organisationId())
            ->whereKey($exception)
            ->first();

        if (! $found instanceof OrderConsumptionException) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $found;
    }
}
