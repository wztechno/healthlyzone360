<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Http\Requests\ReplaceDietaryProfileRequest;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerFoodExclusion;
use Healthy360\Customers\Presenters\DietaryProfilePresenter;
use Healthy360\Customers\Services\CustomerAccountLifecycle;
use Healthy360\Customers\Services\DietaryProfileService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/me/dietary-profile — the whole declaration, every time.
 *
 * **A replace, not a merge, and a `PUT` rather than a `PATCH` because of it.**
 * A person removing an allergy from the list means they no longer have it, and
 * under a merge there would be no way to say so through the ordinary path — the
 * set would only ever grow. So the client sends the complete set and the
 * service swaps it inside one transaction: a half-applied allergy list is the
 * one state this table must never be observed in.
 *
 * **Declaring is an act and the act is recorded**, whether or not anything was
 * named. `declared_at` is stamped for an empty list too, because "I have none"
 * is an answer and it is the answer the activation gate is waiting for. Nothing
 * else in the codebase writes that column, which is why this is one endpoint
 * rather than three.
 *
 * This is the **store of record** (appendix E). The onboarding wizard pre-fills
 * from it and writes back to it, and the meal configurator prefers it over
 * anything typed into a basket: one answer in one place, so a customer who
 * declared a sesame allergy here never has to declare it again, and no
 * configurator holds a copy that will eventually disagree.
 *
 * 200 rather than 201 on first write. The profile is a singleton of the
 * account — it has no identifier a client navigates to and cannot be created
 * twice — so "created" would be reporting on a row rather than on the fact the
 * caller cares about, which is that their declaration now stands.
 */
final class DietaryProfileReplaceController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly DietaryProfileService $profiles,
        private readonly CustomerAccountLifecycle $lifecycle,
        private readonly DietaryProfilePresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceDietaryProfileRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $account = $this->customerAccount($user);

        $payload = $request->payload();

        $profile = $this->profiles->declare(
            account: $account,
            allergens: $payload['allergens'],
            exclusions: $payload['exclusions'] ?? [],
            dietClassificationId: $payload['diet_classification_id'] ?? null,
            religiousRequirement: $payload['religious_requirement'] ?? null,
            notes: $payload['notes'] ?? null,
            actorUserId: (string) $user->getKey(),
        );

        $this->lifecycle->touch($account);

        /** @var list<CustomerAllergenDeclaration> $allergens */
        $allergens = array_values($profile->allergenDeclarations()->orderBy('allergen_code')->get()->all());

        /** @var list<CustomerFoodExclusion> $exclusions */
        $exclusions = array_values($profile->foodExclusions()->orderBy('created_at')->get()->all());

        return ApiResponse::data([
            'dietary_profile' => $this->presenter->profile($profile, $allergens, $exclusions),
        ]);
    }
}
