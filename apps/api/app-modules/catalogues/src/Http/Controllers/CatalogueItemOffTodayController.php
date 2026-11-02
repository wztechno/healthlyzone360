<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Services\MealAvailabilityService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

/**
 * PUT and DELETE /api/v1/catalogue/items/{item}/off-today — one press takes a dish
 * off the kitchen's day, and one press puts it back.
 *
 * For today only, on the kitchen's own wall clock. `PUT /items/{item}/availability`
 * replaces a whole calendar and asks for a lock version, which is the right shape
 * for planning a week and the wrong one for a chef out of salmon at noon. Nothing
 * here is about a version: two people pressing it mean the same thing.
 */
final class CatalogueItemOffTodayController
{
    public function __construct(
        private readonly MealAvailabilityService $availability,
        private readonly TenantContext $context,
    ) {}

    /**
     * @throws ApiException
     */
    public function store(string $item): JsonResponse
    {
        return $this->set($item, true);
    }

    /**
     * @throws ApiException
     */
    public function destroy(string $item): JsonResponse
    {
        return $this->set($item, false);
    }

    /**
     * @throws ApiException
     */
    private function set(string $item, bool $off): JsonResponse
    {
        $found = Str::isUuid($item)
            ? CatalogueItem::query()
                ->whereKey($item)
                ->where('organisation_id', $this->context->organisationId())
                ->first()
            : null;

        if (! $found instanceof CatalogueItem) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'That item could not be read.');
        }

        return ApiResponse::data(['date' => $this->availability->setOffToday($found, $off), 'off_today' => $off]);
    }
}
