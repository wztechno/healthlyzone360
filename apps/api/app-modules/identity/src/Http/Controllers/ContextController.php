<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use Healthy360\Identity\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\Identity\Http\Requests\UpdateContextRequest;
use Healthy360\Identity\Services\UserContextHydrator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\Services\ContextValidator;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/me/context — organisation and branch selection.
 *
 * The same server-side validation the X-Organisation-Id / X-Branch-Id headers
 * go through (Tenancy\ContextValidator), so selection cannot reach a context
 * that per-request headers would reject. On success the choice is remembered
 * on the profile and the hydrated context is returned, which is what the
 * workspace shell renders next.
 */
final class ContextController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly ContextValidator $validator,
        private readonly UserContextHydrator $hydrator,
    ) {}

    public function __invoke(UpdateContextRequest $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $organisationId = (string) $request->string('organisation_id');
        $branchId = $request->input('branch_id');

        // Raises context.organisation_forbidden / context.branch_out_of_scope
        // before anything is persisted.
        $membership = $this->validator->membership($user, $organisationId);
        $resolvedBranchId = $this->validator->branch($membership, is_string($branchId) ? $branchId : null);

        $user->profile?->forceFill([
            'last_organisation_id' => $membership->organisation_id,
            'last_branch_id' => $resolvedBranchId,
        ])->save();

        return ApiResponse::data([
            'active_context' => $this->hydrator->activeContext($user, $organisationId, $resolvedBranchId),
        ]);
    }
}
