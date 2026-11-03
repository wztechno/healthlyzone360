<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use DateTimeZone;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Organisations\Enums\BranchStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Services\OrganisationTimezone;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/kitchen/branches — open another branch of this kitchen.
 *
 * Behind `branch.manage_current`, and refused to somebody whose membership is
 * bound to one branch: they run that branch, not the kitchen's map. The country
 * is the kitchen's and the timezone defaults to its own, because a chain crossing
 * a border is not this product yet.
 */
final class BranchStoreController
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly OrganisationTimezone $timezones,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'city' => ['nullable', 'string', 'max:120'],
            'address' => ['nullable', 'string', 'max:255'],
            'timezone' => ['nullable', Rule::in(DateTimeZone::listIdentifiers())],
        ]);

        $organisationId = (string) $this->context->organisationId();

        $boundToOneBranch = OrganisationMembership::query()
            ->where('organisation_id', $organisationId)
            ->where('user_id', $this->context->userId())
            ->whereNotNull('branch_id')
            ->exists();

        if ($boundToOneBranch) {
            throw new ApiException(ErrorCode::ContextBranchOutOfScope);
        }

        $kitchen = Organisation::query()->whereKey($organisationId)->sole();

        $branch = OrganisationBranch::withoutTenancy()->create([
            'organisation_id' => $organisationId,
            'name' => trim($validated['name']),
            'country_code' => $kitchen->country_code,
            'city' => $validated['city'] ?? null,
            'address' => $validated['address'] ?? null,
            'timezone' => $validated['timezone'] ?? $this->timezones->forOrganisation($kitchen),
            'status' => BranchStatus::Active,
            'created_by' => $this->context->userId(),
        ]);

        $this->audit->record(
            'branch.created',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation_branch',
            subjectId: (string) $branch->getKey(),
            metadata: ['name' => $branch->name],
        );

        return ApiResponse::data([
            'id' => (string) $branch->getKey(),
            'name' => $branch->name,
            'city' => $branch->city,
            'timezone' => $branch->timezone,
        ], [], 201);
    }
}
