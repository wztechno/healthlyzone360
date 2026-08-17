<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanMenuService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/plans/{item}/menu — the plan's fixed menu.
 *
 * The read half of the PUT beside it, and it sits behind the same
 * `plan.manage_organisation` its sibling `GET …/variants` does rather than the
 * `catalogue.view_organisation` the profile read uses. The boundary the routes
 * file draws is between what a customer will be shown and what a merchandiser
 * decides; this endpoint is the second. Its only client is the menu editor, its
 * `ETag` is the item's because that is what a PUT here has to carry, and the
 * customer-facing rendering of "what is for dinner on Thursday" is a marketplace
 * surface built on its own presenter, not this one.
 *
 * **`cycle` is served even when it is empty.** `cycle_days: null` is the whole
 * "this plan has no menu" fact, and it is the same answer whether the plan has
 * no profile at all or a profile with no menu on it — a client asking what is
 * on the menu should not have to handle two shapes of nothing.
 *
 * Entries come back ordered the way a chef reads them: day, then sitting in the
 * order of the day rather than alphabetically, then the second lunch after the
 * first.
 */
final class PlanMenuIndexController
{
    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanMenuService $menu,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);
        $entries = $this->menu->entriesFor($plan);
        $meals = $this->menu->mealsFor($entries);

        return ApiResponse::data([
            'item' => $this->items->item($plan),
            'cycle' => $this->menu->cycleFor($plan),
            'entries' => array_map(
                fn ($entry): array => $this->presenter->menuEntry($entry, $meals[$entry->meal_catalogue_item_id] ?? null),
                $entries,
            ),
        ], ['count' => count($entries)])->withHeaders(['ETag' => '"'.$plan->lock_version.'"']);
    }
}
