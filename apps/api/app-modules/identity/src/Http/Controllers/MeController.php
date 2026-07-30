<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use App\Models\User;
use Healthy360\Identity\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\Identity\Services\UserContextHydrator;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me — the hydration step of the vertical slice: identity,
 * profile, every workspace the person may act under, the active context with
 * its calculated permissions and entitlements, and any consent still owed.
 *
 * Context resolution order: the X-Organisation-Id / X-Branch-Id headers when
 * present, otherwise the workspace remembered on the profile. A remembered
 * context that no longer validates (membership ended, branch closed) yields
 * a null active_context rather than an error, so a returning client is never
 * locked out of its own /me.
 *
 * Deliberately reachable before email verification: the client needs this
 * payload to render the "verify your email" state.
 */
final class MeController
{
    use ResolvesAuthenticatedUser;

    public function __construct(private readonly UserContextHydrator $hydrator) {}

    public function __invoke(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        [$organisationId, $branchId] = $this->claimedContext($request, $user);

        $payload = $this->hydrator->me($user, $organisationId, $branchId);

        return ApiResponse::data($payload['data'], $payload['meta']);
    }

    /**
     * Headers win as a whole: a client that names an organisation but no
     * branch means "no branch", never "the branch I last used somewhere
     * else".
     *
     * @return array{0: string|null, 1: string|null}
     */
    private function claimedContext(Request $request, User $user): array
    {
        $header = $request->header('X-Organisation-Id');

        if (is_string($header) && trim($header) !== '') {
            return [$header, $request->header('X-Branch-Id')];
        }

        $profile = $user->profile;

        return [$profile?->last_organisation_id, $profile?->last_branch_id];
    }
}
