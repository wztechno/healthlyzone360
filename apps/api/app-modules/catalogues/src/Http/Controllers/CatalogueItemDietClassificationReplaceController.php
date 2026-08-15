<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplaceCatalogueItemDietClassificationsRequest;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/items/{item}/diet-classifications.
 *
 * A separate endpoint rather than a field on the item update — a deliberate
 * divergence from the admin contract, which embeds `dietClassifications` in
 * create and update. Tagging is a decision of its own, often taken by somebody
 * other than the person who wrote the description, and its own set-replace
 * keeps "I retagged this" and "I rewrote this" as separate audited events.
 */
final class CatalogueItemDietClassificationReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly CatalogueItemService $items,
        private readonly CatalogueItemAdminPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceCatalogueItemDietClassificationsRequest $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);
        $updated = $this->items->setDietClassifications($record, $request->codes(), $this->requiredLockVersion($request));

        $codes = array_values(DietClassification::query()
            ->whereIn('id', CatalogueItemDietClassification::query()
                ->where('catalogue_item_id', $updated->getKey())
                ->select('diet_classification_id'))
            ->orderBy('display_order')
            ->orderBy('code')
            ->pluck('code')
            ->all());

        return ApiResponse::data([
            'item' => $this->presenter->item($updated),
            'diet_classifications' => $codes,
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
