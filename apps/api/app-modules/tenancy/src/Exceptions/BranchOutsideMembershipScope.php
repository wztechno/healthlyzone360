<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;

/**
 * The declared branch context is not an active branch of the selected
 * organisation, or falls outside the authenticated user's membership scope.
 */
class BranchOutsideMembershipScope extends Exception
{
    public function render(): JsonResponse
    {
        return new JsonResponse([
            'error' => [
                'code' => 'context.branch_out_of_scope',
                'message' => 'The requested branch is not within your membership scope.',
            ],
        ], 403);
    }
}
