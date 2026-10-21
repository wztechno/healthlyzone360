<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Orders\Contracts\BuyerAllergenCheck;
use Healthy360\Subscriptions\Http\Requests\AllergenConflictIndexRequest;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/me/allergen-conflicts — which of these meals clash with my
 * declared allergies?
 *
 * The question a subscription configurator asks at its Review step, answered
 * by the rule checkout and generation use (`BuyerAllergenCheck` →
 * `MealSafety`). A subscription carries no meals at creation, so there is no
 * placement to refuse; generation swaps an unsafe pick at the change cut-off.
 * This is what lets the customer hear about it before they subscribe rather
 * than never.
 *
 * Only the customer's own verdict, never their declarations: the answer names
 * the meal and the allergen on its label, both of which are public.
 */
final class AllergenConflictIndexController
{
    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly BuyerAllergenCheck $allergens,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(AllergenConflictIndexRequest $request): JsonResponse
    {
        $account = $this->locator->shopper($request);

        return ApiResponse::data([
            'conflicts' => $this->allergens->conflicts($account, $request->mealIds()),
        ]);
    }
}
