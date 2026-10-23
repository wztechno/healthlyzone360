<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanProfileService;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/plans/{item}/profile.
 *
 * **`profile` is null when nobody has written one**, rather than a fabricated
 * set of defaults. "No commercial decision has been made about this plan" is
 * exactly the state the publish gate refuses, and a surface that filled it in
 * would leave a kitchen wondering why publication keeps failing on terms it can
 * see on screen.
 *
 * The `ETag` is the **item's**, because that is the validator a subsequent PUT
 * has to carry: the profile has no `lock_version` of its own, being the
 * commercial face of the item rather than a separate thing to lock.
 *
 * `diet_classifications` travels beside the terms, as codes, exactly as the
 * item read serves them: a plan's diet tags are written through the item's
 * own `diet-classifications` resource, and an editor opening a plan should not
 * have to make a second read to show what it is tagged as.
 */
final class PlanProfileShowController
{
    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanProfileService $profiles,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);
        $profile = $this->profiles->forItem($plan);

        return ApiResponse::data([
            'item' => $this->items->item($plan),
            'profile' => $profile === null ? null : $this->presenter->profile($profile),
            'diet_classifications' => $this->dietClassifications($plan),
        ])->withHeaders(['ETag' => '"'.$plan->lock_version.'"']);
    }

    /**
     * The same ordering `CatalogueItemShowController` uses, so the two reads
     * never disagree about which tag comes first.
     *
     * @return list<string>
     */
    private function dietClassifications(CatalogueItem $plan): array
    {
        return array_values(DietClassification::query()
            ->whereIn('id', CatalogueItemDietClassification::query()
                ->where('catalogue_item_id', $plan->getKey())
                ->select('diet_classification_id'))
            ->orderBy('display_order')
            ->orderBy('code')
            ->pluck('code')
            ->all());
    }
}
