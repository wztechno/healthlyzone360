<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Turns route parameters into records the caller is allowed to see, or into a
 * 404.
 *
 * Route-model binding is not used, matching `RecipeLocator` and the
 * ingredients module's locator before it, and for the same reason: the tenant
 * scope only means anything once `org.context` has run, and resolving a scoped
 * model in the router's binding middleware would either fail closed before the
 * context exists or bypass the scope entirely.
 *
 * An item is addressable by identifier **or by slug**. Both because both are
 * natural: a client that walked the list holds identifiers, and a marketplace
 * integration or a support engineer holds "harissa-paste-500g". A slug is
 * unique per organisation and immutable, so there is no ambiguity to resolve
 * and no risk of the two answers drifting apart.
 */
final class CatalogueLocator
{
    /**
     * @throws ApiException
     */
    public function item(string $id): CatalogueItem
    {
        $query = CatalogueItem::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('slug', $id);

        $item = $query->first();

        if (! $item instanceof CatalogueItem) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $item;
    }

    /**
     * @throws ApiException
     */
    public function channel(string $id): SalesChannel
    {
        $query = SalesChannel::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('code', $id);

        $channel = $query->first();

        if (! $channel instanceof SalesChannel) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $channel;
    }

    /**
     * A UUID is recognised by shape rather than by trying the key first and
     * falling back: a slug that happened to look like a UUID would otherwise
     * be looked up twice, and a malformed identifier would reach the database
     * as a `uuid = 'not-a-uuid'` comparison, which PostgreSQL answers with an
     * error rather than an empty set.
     */
    private function looksLikeUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
