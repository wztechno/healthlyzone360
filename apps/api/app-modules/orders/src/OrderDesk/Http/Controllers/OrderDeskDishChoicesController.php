<?php

declare(strict_types=1);

namespace Healthy360\Orders\OrderDesk\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\DishOptions;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Orders\OrderDesk\Services\DeskChannelLocator;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/order-desk/items/{item}/choices: the options a dish offers
 * and its portions at the counter's prices, asked when the agent opens a line. A
 * chosen portion is a pack on the line, so the quote prices it as any pack.
 */
final class OrderDeskDishChoicesController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly DishOptions $options,
        private readonly MarketplaceMeals $meals,
        private readonly DeskChannelLocator $channels,
    ) {}

    public function __invoke(string $item): JsonResponse
    {
        $record = $this->locator->item($item);

        return ApiResponse::data([
            'options' => $this->options->forItem((string) $record->getKey()),
            'portions' => $this->meals->portionsOf($record, [$this->channels->forOrganisation((string) $record->organisation_id)]),
        ]);
    }
}
