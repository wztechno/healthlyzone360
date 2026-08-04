<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Kitchens\Http\Concerns\ReadsMarketplaceFilters;
use Healthy360\Kitchens\Presenters\MarketplaceLocale;
use Healthy360\Kitchens\Services\MarketplacePlans;
use Healthy360\Kitchens\Services\MarketplaceProjector;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/marketplace/meal-plans — anonymous.
 *
 * The subscription catalogue: published plans of active kitchens.
 *
 * **It is expected to be empty today, and that is the correct answer.** The
 * imported Healthy360 workbook kitchen is entirely draft by design, and the demonstration
 * kitchen's plan is deliberately left unpublishable — one configuration carries
 * no confirmed price, which is precisely what the publish gate refuses. An
 * empty page here is the gate working, not a missing feature, and it is why the
 * consumer plan pages stay mock-backed after M1.
 */
final class PublicMealPlanIndexController
{
    use ReadsMarketplaceFilters;

    public function __construct(
        private readonly MarketplacePlans $plans,
        private readonly MarketplaceProjector $projector,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $locale = MarketplaceLocale::from($request->header('Accept-Language'));
        $query = $this->plans->visible();

        $term = $this->stringParameter($request, 'query');

        if ($term !== null) {
            $this->plans->whereTextMatches($query, $term);
        }

        $kitchenIds = $this->listParameter($request, 'kitchen_ids', 25);

        if ($kitchenIds !== null) {
            $query->whereIn('organisation_id', $kitchenIds);
        }

        $duration = $this->stringParameter($request, 'duration', 60);

        if ($duration !== null) {
            $this->plans->whereOffersDuration($query, $duration);
        }

        $mealsPerDay = $this->integerParameter($request, 'meals_per_day', 1);

        if ($mealsPerDay !== null) {
            $this->plans->whereMealsPerDay($query, $mealsPerDay);
        }

        $limit = CursorPage::limit($request);
        CursorPage::constrain($query, $limit, CursorPage::cursor($request));

        $page = CursorPage::page($query->get(), $limit);

        return ApiResponse::data(
            $page['items']->map(fn (CatalogueItem $plan): array => $this->projector->plan($plan, $locale))->all(),
            $page['meta'] + [
                'locale' => $locale,
                'unsupported_filters' => $this->unsupportedFilters($request),
            ],
        );
    }
}
