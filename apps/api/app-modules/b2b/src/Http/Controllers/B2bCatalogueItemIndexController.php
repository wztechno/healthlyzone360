<?php

declare(strict_types=1);

namespace Healthy360\B2b\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\B2b\Presenters\B2bCatalogueItemPresenter;
use Healthy360\B2b\Services\B2bCatalogueBrowse;
use Healthy360\Customers\Services\ShopperResolver;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/b2b/catalogue/items — articles the corporate buyer may purchase.
 */
final class B2bCatalogueItemIndexController
{
    public function __construct(
        private readonly ShopperResolver $shoppers,
        private readonly B2bCatalogueBrowse $catalogue,
        private readonly B2bCatalogueItemPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $buyer = $this->shoppers->resolve();
        $language = $request->query('language', 'en');
        $on = CarbonImmutable::now()->startOfDay();

        $rows = $this->catalogue->items($buyer, $on);

        $data = array_map(
            fn (array $row): array => $this->presenter->item(
                $row['item'],
                $row['sales_channel_id'],
                $row['price'],
                is_string($language) ? $language : 'en',
            ),
            $rows,
        );

        return ApiResponse::data(['items' => $data]);
    }
}
