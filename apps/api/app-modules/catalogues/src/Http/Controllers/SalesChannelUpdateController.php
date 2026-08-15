<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\UpdateSalesChannelRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\SalesChannelService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/sales-channels/{channel} — behind `precondition`.
 */
final class SalesChannelUpdateController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly SalesChannelService $channels,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateSalesChannelRequest $request, string $channel): JsonResponse
    {
        $record = $this->locator->channel($channel);
        $updated = $this->channels->update($record, $request->validated(), $this->requiredLockVersion($request));

        return ApiResponse::data(['sales_channel' => $this->presenter->salesChannel($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
