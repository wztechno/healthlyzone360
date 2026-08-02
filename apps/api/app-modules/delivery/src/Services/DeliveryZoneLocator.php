<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Services;

use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Turns a route parameter into a zone or a window the caller is allowed to
 * see, or into a 404.
 *
 * Route-model binding is not used, matching `PriceListLocator` and the
 * locators before it: the tenant scope only means anything once `org.context`
 * has run, and resolving a scoped model in the router's binding middleware
 * would either fail closed before the context exists or bypass the scope
 * entirely.
 *
 * Both are addressable by identifier **or by code**. A client that walked the
 * list holds an identifier; an operator, a runbook or an importer holds
 * `beirut-inner`.
 */
final class DeliveryZoneLocator
{
    /**
     * @throws ApiException
     */
    public function zone(string $id): DeliveryZone
    {
        $query = DeliveryZone::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('code', $id);

        $zone = $query->first();

        if (! $zone instanceof DeliveryZone) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $zone;
    }

    /**
     * @throws ApiException
     */
    public function window(string $id): DeliveryWindow
    {
        $query = DeliveryWindow::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('code', $id);

        $window = $query->first();

        if (! $window instanceof DeliveryWindow) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $window;
    }

    /**
     * A UUID is recognised by shape rather than by trying the key first and
     * falling back: a code that happened to look like a UUID would otherwise
     * be looked up twice, and a malformed identifier would reach the database
     * as a `uuid = 'not-a-uuid'` comparison, which PostgreSQL answers with an
     * error rather than an empty set.
     */
    private function looksLikeUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
