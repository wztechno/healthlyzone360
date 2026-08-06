<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Kitchens\Http\Concerns\ReadsMarketplaceFilters;
use Healthy360\Kitchens\Presenters\MarketplaceLocale;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Kitchens\Services\MarketplacePage;
use Healthy360\Kitchens\Services\MarketplaceProjector;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\CursorPage;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/marketplace/meals — anonymous.
 *
 * The meal catalogue. Published meals **and products**, offered through a
 * consumer listing channel, carrying a confirmed price — the conditions
 * `MarketplaceMeals` documents. Filter with `item_types=meal`, `product`, or
 * both (comma-separated); omit the parameter to receive both kinds.
 *
 * **`exclude_allergens` is an exclusion, never an inclusion.** A person filters
 * by what they must avoid, and the two are not symmetrical: "show me dishes
 * with peanuts" is a preference, "never show me dishes with peanuts" is a
 * safety instruction. The exclusion is applied over the derived allergen list
 * at both containment levels, so a dish a kitchen cannot rule an allergen out
 * of is excluded along with the ones that certainly contain it.
 *
 * The allergen and price rules cannot be expressed in SQL — one is a
 * derivation, the other a tariff walk — so the page is assembled by
 * `MarketplacePage`, which keeps the keyset honest while rows are rejected
 * after the query has run.
 */
final class PublicMealIndexController
{
    use ReadsMarketplaceFilters;

    public function __construct(
        private readonly MarketplaceMeals $meals,
        private readonly MarketplaceProjector $projector,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $locale = MarketplaceLocale::from($request->header('Accept-Language'));
        $query = $this->meals->visible();

        $term = $this->stringParameter($request, 'query');

        if ($term !== null) {
            $this->meals->whereTextMatches($query, $term);
        }

        $kitchenIds = $this->listParameter($request, 'kitchen_ids', 25);

        if ($kitchenIds !== null) {
            $query->whereIn('organisation_id', $kitchenIds);
        }

        $diets = $this->listParameter($request, 'diet_classifications', 12);

        if ($diets !== null) {
            $this->meals->whereDietClassifications($query, $diets);
        }

        $itemTypes = $this->listParameter($request, 'item_types', 2);

        if ($itemTypes !== null) {
            $unknown = array_values(array_diff($itemTypes, MarketplaceMeals::LISTING_ITEM_TYPES));

            if ($unknown !== []) {
                throw new ApiException(
                    ErrorCode::RequestInvalid,
                    'item_types accepts only meal and product.',
                    ['parameter' => 'item_types', 'unknown' => $unknown],
                );
            }

            $this->meals->whereItemTypes($query, $itemTypes);
        }

        $excludeAllergens = $this->listParameter($request, 'exclude_allergens', 20) ?? [];
        $availableOn = $this->dateParameter($request, 'available_on');
        $priceMax = $this->integerParameter($request, 'price_max');

        $limit = CursorPage::limit($request);

        $page = MarketplacePage::walk(
            $query,
            $limit,
            CursorPage::cursor($request),
            function (CatalogueItem $meal) use ($locale, $excludeAllergens, $availableOn, $priceMax): ?array {
                $projected = $this->projector->meal($meal, $locale, $excludeAllergens, $availableOn);

                if ($projected === null) {
                    return null;
                }

                // Applied here rather than in SQL for the same reason the price
                // exists at all: the number came from a tariff walk, and a
                // subquery that guessed at it would be a second pricing rule.
                if ($priceMax !== null && $projected['price']['amount'] > $priceMax) {
                    return null;
                }

                return $projected;
            },
        );

        return ApiResponse::data($page['items'], $page['meta'] + [
            'locale' => $locale,
            'unsupported_filters' => $this->unsupportedFilters($request),
        ]);
    }
}
