<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Kitchens\Presenters\MarketplaceLocale;
use Healthy360\Kitchens\Services\MarketplacePlans;
use Healthy360\Kitchens\Services\MarketplaceProjector;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/marketplace/meal-plans/{plan} — anonymous.
 *
 * One published subscription plan: its terms, the configurations a customer can
 * buy and the runs those configurations are offered for.
 *
 * A configuration with no confirmed weekly price is **absent from `variants`**
 * rather than listed without one — the plan-side twin of the meal rule. A plan
 * can only reach this endpoint by passing a publish gate that already required
 * a confirmed price on every active configuration, so an absent configuration
 * means the tariff behind it has since been withdrawn or its channel unassigned,
 * and showing a configuration a customer cannot be quoted for would turn that
 * into a support call.
 */
final class PublicMealPlanShowController
{
    public function __construct(
        private readonly MarketplacePlans $plans,
        private readonly MarketplaceProjector $projector,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $plan): JsonResponse
    {
        $locale = MarketplaceLocale::from($request->header('Accept-Language'));

        $found = $this->plans->visible()
            ->where(fn ($query) => $query->where('slug', $plan)->when(
                preg_match('/^[0-9a-f-]{36}$/i', $plan) === 1,
                fn ($scoped) => $scoped->orWhere('catalogue_items.id', $plan),
            ))
            ->first();

        if (! $found instanceof CatalogueItem) {
            throw new ApiException(ErrorCode::ResourceNotFound, 'No subscription plan with that identifier is on sale.');
        }

        return ApiResponse::data(
            $this->projector->plan($found, $locale),
            ['locale' => $locale],
        );
    }
}
