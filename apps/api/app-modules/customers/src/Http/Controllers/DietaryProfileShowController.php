<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Customers\Presenters\DietaryProfilePresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/dietary-profile — what this person has said they eat.
 *
 * **A read that reads.** `DietaryProfileService::profileFor()` creates the row
 * when it is missing, which is right for the write path and wrong here: a GET
 * that inserts is untrue to its verb, would fail the day a reader is pointed at
 * a replica, and would leave an empty profile row behind for every person who
 * merely opened the screen. The absent profile is presented instead, with
 * `has_declared: false` — which is exactly what is true about them.
 *
 * That flag, and not an empty allergen list, is what a client must branch on.
 * An unanswered question and a confident "I have none" are different facts and
 * only the second may activate an account that is about to be sent food. They
 * are distinguishable here because they are distinguishable in the table.
 *
 * No customer account is a `has_declared: false` profile rather than a refusal:
 * somebody who has not started onboarding has genuinely declared nothing, and a
 * 403 in place of that answer would tell a client less than the truth does.
 */
final class DietaryProfileShowController
{
    use ResolvesCustomerAccount;

    public function __construct(private readonly DietaryProfilePresenter $presenter) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccountOrNull($user);

        $profile = $account?->dietaryProfile()->first();

        if (! $profile instanceof CustomerDietaryProfile) {
            return ApiResponse::data(['dietary_profile' => $this->presenter->profile(null)]);
        }

        /** @var list<CustomerAllergenDeclaration> $allergens */
        $allergens = array_values($profile->allergenDeclarations()->orderBy('allergen_code')->get()->all());

        /** @var list<CustomerFoodExclusion> $exclusions */
        $exclusions = array_values($profile->foodExclusions()->orderBy('created_at')->get()->all());

        return ApiResponse::data([
            'dietary_profile' => $this->presenter->profile($profile, $allergens, $exclusions),
        ]);
    }
}
