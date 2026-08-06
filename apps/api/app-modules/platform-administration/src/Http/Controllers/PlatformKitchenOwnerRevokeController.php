<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Http\Controllers;

use Healthy360\PlatformAdministration\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\PlatformAdministration\Services\KitchenOrganisationLocator;
use Healthy360\PlatformAdministration\Services\KitchenOwners;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/v1/platform/organisations/kitchens/{organisation}/owners/{membership}/revoke
 * — end an owner's membership.
 *
 * **The last owner may be revoked.** A kitchen whose only owner has left, or
 * whose owner is the reason the platform is intervening, has to be able to
 * have that membership ended before a replacement exists; a rule that refused
 * would leave the console unable to do the one thing it was opened to do.
 *
 * `remaining_owners` comes back so the screen can say so. That is the whole
 * design: report the consequence, let the operator decide, and do not pretend
 * a guard rail is a policy.
 *
 * A `POST .../revoke` rather than `DELETE .../owners/{membership}`, because
 * nothing is deleted. The membership row survives as `ended` — it is the
 * record that this person was an owner, and the audit entry beside it refers
 * to something that has to still be there.
 */
final class PlatformKitchenOwnerRevokeController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly KitchenOrganisationLocator $locator,
        private readonly KitchenOwners $owners,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $organisation, string $membership): JsonResponse
    {
        $kitchen = $this->locator->kitchen($organisation);

        $result = $this->owners->revoke($kitchen, $membership, $this->currentUser($request));

        return ApiResponse::data([
            'membership' => [
                'id' => (string) $result['membership']->getKey(),
                'user_id' => (string) $result['membership']->user_id,
                'status' => $result['membership']->status->value,
            ],
            'remaining_owners' => $result['remaining_owners'],
        ]);
    }
}
