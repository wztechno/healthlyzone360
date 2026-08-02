<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Kitchens\Presenters\MarketplaceLocale;
use Healthy360\Kitchens\Services\MarketplaceMeals;
use Healthy360\Kitchens\Services\MarketplaceProjector;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/marketplace/meals/{meal} — anonymous.
 *
 * One meal, with its allergen declaration and the fortnight of dates it can be
 * ordered for.
 *
 * **An unpriced meal answers `404`**, exactly as an unpublished one does. That
 * is the same rule the list applies by omitting it, stated for a single
 * resource: a meal nobody has priced is not on sale, and a detail page that
 * rendered one would have to invent a price or show a gap where the buy button
 * goes. The kitchen sees the truth on its own readiness screen, which is where
 * the distinction between "not published" and "not priced" is actionable.
 */
final class PublicMealShowController
{
    public function __construct(
        private readonly MarketplaceMeals $meals,
        private readonly MarketplaceProjector $projector,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $meal): JsonResponse
    {
        $locale = MarketplaceLocale::from($request->header('Accept-Language'));

        $found = $this->meals->visible()
            ->where(fn ($query) => $query->where('slug', $meal)->when(
                preg_match('/^[0-9a-f-]{36}$/i', $meal) === 1,
                fn ($scoped) => $scoped->orWhere('catalogue_items.id', $meal),
            ))
            ->first();

        $projected = $found instanceof CatalogueItem
            ? $this->projector->meal($found, $locale)
            : null;

        if ($projected === null) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'No meal with that identifier is on sale.');
        }

        return ApiResponse::data($projected, ['locale' => $locale]);
    }
}
