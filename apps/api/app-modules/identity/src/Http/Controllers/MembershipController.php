<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use Healthy360\Identity\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\Identity\Services\UserContextHydrator;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/memberships — the workspace picker's data source: the same
 * collection /api/v1/me embeds, without hydrating a context. Cheaper for
 * clients that only need to let a person choose where to work.
 */
final class MembershipController
{
    use ResolvesAuthenticatedUser;

    public function __construct(private readonly UserContextHydrator $hydrator) {}

    public function __invoke(Request $request): JsonResponse
    {
        $memberships = $this->hydrator->memberships($this->currentUser($request));

        return ApiResponse::data($memberships, ['count' => count($memberships)]);
    }
}
