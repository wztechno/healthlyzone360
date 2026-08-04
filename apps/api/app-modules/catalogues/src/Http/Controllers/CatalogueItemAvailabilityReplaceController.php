<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplaceCatalogueItemAvailabilityRequest;
use Healthy360\Catalogues\Models\CatalogueItemAvailabilityDay;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\MealAvailabilityService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/items/{item}/availability.
 */
final class CatalogueItemAvailabilityReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly MealAvailabilityService $availability,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceCatalogueItemAvailabilityRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->availability->replace($record, $request->days(), $this->requiredLockVersion($request));

        $rows = CatalogueItemAvailabilityDay::query()
            ->where('catalogue_item_id', $updated->getKey())
            ->orderBy('date')
            ->get();

        return ApiResponse::data([
            'item' => $this->presenter->item($updated),
            'availability_days' => $rows->map(fn (CatalogueItemAvailabilityDay $row): array => $this->presenter->availabilityDay($row))->all(),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
