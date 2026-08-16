<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Concerns;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * The organisation a requirement forecast is for, stated explicitly.
 *
 * The rest of this module's controllers lean on `OrganisationScoped` models and
 * never name the organisation at all. The forecast cannot: it is written to be
 * callable from a job, so every read inside it is `withoutTenancy()` with the
 * organisation passed in (H5), and something has to pass it in. This is the
 * smallest thing that can — the same shape `OrderLocator::sellerId()` gives the
 * desk's own controllers, on this side of the module boundary because Inventory
 * does not import the orders module's service layer for one accessor.
 */
trait ResolvesForecastScope
{
    /**
     * @throws ApiException
     */
    private function forecastOrganisationId(TenantContext $context): string
    {
        $organisationId = $context->organisationId();

        if ($organisationId === null) {
            // Unreachable behind `org.context`, which refuses before the route
            // runs. Present so that a forecast can never silently answer for
            // nobody — the one failure mode a buy list must not have.
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        return $organisationId;
    }
}
