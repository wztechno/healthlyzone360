<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Services\DuplicateStockShelves;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /catalogue/inventory/duplicates — the shelves that repeat a name and need a
 * person, with the reason. Read live, unpaged: a kitchen has a handful of these.
 * The clear ones are `kitchen:merge-duplicate-stock`'s, and this list never shows
 * them as work to do.
 */
final class DuplicateStockIndexController
{
    public function __construct(private readonly DuplicateStockShelves $duplicates) {}

    public function __invoke(TenantContext $context): JsonResponse
    {
        return ApiResponse::data($this->duplicates->scan((string) $context->organisationId())['reviews']);
    }
}
