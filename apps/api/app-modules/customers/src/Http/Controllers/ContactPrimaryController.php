<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Controllers;

use Healthy360\Customers\Http\Concerns\ResolvesCustomerAccount;
use Healthy360\Customers\Presenters\CustomerContactPresenter;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/me/contacts/{contact}/primary — nominate where things are sent.
 *
 * A POST sub-resource action rather than a `PATCH is_primary`, for the reason
 * every promotion in this codebase is one: setting the flag means clearing it
 * on the incumbent, and the partial unique index refuses a second primary, so a
 * caller performing it as a field write would collide with itself. The
 * transaction that demotes and promotes together is the registry's, and this is
 * the endpoint that asks for it.
 *
 * **Behind `step-up`**, which is the interesting part. Changing the primary
 * destination is how an attacker holding a hijacked session redirects the codes
 * that would otherwise stop them — it is the same class of act as cutting off a
 * device, and it is guarded the same way.
 *
 * The promotion is expressed as a `rememberForUser()` on the contact's own
 * canonical value, which converges on the existing row and promotes it. That is
 * not a trick: the registry is the single write path for contact points, and
 * reaching around it to set a column would put the "one primary per channel"
 * invariant in a second place. Normalisation is idempotent, so re-normalising a
 * stored value yields the same value and the same row.
 *
 * A retired contact is not a candidate — the locator excludes them — so
 * promoting a withdrawn destination is `resource.not_found` rather than a
 * silent resurrection.
 */
final class ContactPrimaryController
{
    use ResolvesCustomerAccount;

    public function __construct(
        private readonly ContactPointRegistry $contacts,
        private readonly CustomerContactPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $contact): JsonResponse
    {
        $user = $this->currentUser($request);
        $record = $this->contactFor($user, $contact);

        $promoted = $this->contacts->rememberForUser(
            user: $user,
            channel: $record->channel,
            value: $record->value_normalised,
            isPrimary: true,
        );

        return ApiResponse::data(['contact' => $this->presenter->contact($promoted)]);
    }
}
