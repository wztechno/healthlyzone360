<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Turns a route parameter into a price list the caller is allowed to see, or
 * into a 404.
 *
 * Route-model binding is not used, matching `CatalogueLocator` and the
 * locators before it: the tenant scope only means anything once `org.context`
 * has run, and resolving a scoped model in the router's binding middleware
 * would either fail closed before the context exists or bypass the scope
 * entirely.
 *
 * A list is addressable by identifier **or by code**, like a sales channel:
 * a client that walked the list holds identifiers, and an operator or an
 * importer holds `greenlife-b2b-usd`. The code is unique per organisation, so
 * there is no ambiguity to resolve.
 */
final class PriceListLocator
{
    /**
     * @throws ApiException
     */
    public function priceList(string $id): PriceList
    {
        $query = PriceList::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('code', $id);

        $priceList = $query->first();

        if (! $priceList instanceof PriceList) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $priceList;
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
