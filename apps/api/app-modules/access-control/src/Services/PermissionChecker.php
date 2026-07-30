<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Services;

use App\Models\User;
use Healthy360\AccessControl\Enums\AccessDenialReason;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Policies\OrganisationScopedPolicy;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

/**
 * The six-step RBAC decision (plan §10) — allow-only, no deny rules:
 *
 *  1. Is the user authenticated?                     → unauthenticated
 *  2. Is the organisation membership active?         → membership_inactive
 *  3. Is the branch inside the membership scope?     → branch_out_of_scope
 *  4. Does an assigned role grant the permission?    → permission_not_granted
 *  5. Does the resource belong to the organisation?  → resource_outside_organisation
 *  6. Does the policy permit the action?             → policy_denied
 *
 * Feature entitlement, consent, relationships and step-up authentication are
 * deliberately NOT evaluated here — they are separate services with their own
 * distinct denial reasons.
 */
final class PermissionChecker
{
    public function __construct(private readonly PermissionCache $cache) {}

    public function check(?User $user, string $permission, ?Model $resource, TenantContext $context): AccessDecision
    {
        // Step 1 — authentication.
        if ($user === null || ! $user->exists) {
            return AccessDecision::deny(AccessDenialReason::Unauthenticated);
        }

        // Step 2 — active organisation membership in the selected context.
        $membership = $this->membershipFor($user, $context);

        if ($membership === null || ! $membership->isActive()) {
            return AccessDecision::deny(AccessDenialReason::MembershipInactive);
        }

        // Step 3 — branch inside the membership scope. A branch-scoped
        // membership is only valid when the context is set to that branch.
        if ($membership->branch_id !== null && $membership->branch_id !== $context->branchId()) {
            return AccessDecision::deny(AccessDenialReason::BranchOutOfScope);
        }

        // Step 4 — allow-only union of role permissions across the
        // membership's currently effective role assignments.
        if (! in_array($permission, $this->calculatedPermissions($user, $membership, $context), true)) {
            return AccessDecision::deny(AccessDenialReason::PermissionNotGranted);
        }

        // Step 5 — the resource must belong to the selected organisation.
        if ($resource !== null && ! $this->resourceBelongsToOrganisation($resource, $context)) {
            return AccessDecision::deny(AccessDenialReason::ResourceOutsideOrganisation);
        }

        // Step 6 — bespoke policy conditions (evaluated directly, not through
        // the Gate, to avoid recursion with policies that delegate here).
        if ($resource !== null) {
            $policy = Gate::getPolicyFor($resource);

            if ($policy instanceof OrganisationScopedPolicy
                && ! $policy->additionalConditions($user, $permission, $resource)) {
                return AccessDecision::deny(AccessDenialReason::PolicyDenied);
            }
        }

        return AccessDecision::allow();
    }

    /**
     * The cached, calculated permission codes for the user in the given
     * context (plan §10: cached per user × organisation × branch, invalidated
     * via the permission-version counter).
     *
     * @return list<string>
     */
    public function calculatedPermissions(User $user, OrganisationMembership $membership, TenantContext $context): array
    {
        $organisationId = $membership->organisation_id;

        return $this->cache->remember(
            (string) $user->getKey(),
            $organisationId,
            $context->branchId(),
            function () use ($membership): array {
                $effectiveRoleIds = MembershipRole::withoutTenancy()
                    ->where('membership_id', $membership->getKey())
                    ->where(function ($query): void {
                        $query->whereNull('starts_at')->orWhere('starts_at', '<=', now());
                    })
                    ->where(function ($query): void {
                        $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
                    })
                    ->pluck('role_id');

                /** @var list<string> */
                return Permission::query()
                    ->whereIn('id', RolePermission::withoutTenancy()
                        ->whereIn('role_id', $effectiveRoleIds)
                        ->select('permission_id'))
                    ->where('is_assignable', true)
                    ->pluck('code')
                    ->all();
            },
        );
    }

    private function membershipFor(User $user, TenantContext $context): ?OrganisationMembership
    {
        if (! $context->hasOrganisation()) {
            return null;
        }

        if ($context->userId() === (string) $user->getKey()) {
            return $context->membership();
        }

        return OrganisationMembership::withoutTenancy()
            ->where('organisation_id', $context->organisationId())
            ->where('user_id', $user->getKey())
            ->first();
    }

    private function resourceBelongsToOrganisation(Model $resource, TenantContext $context): bool
    {
        if ($resource instanceof Organisation) {
            return (string) $resource->getKey() === $context->organisationId();
        }

        $organisationId = $resource->getAttribute('organisation_id');

        // Platform-global rows (template roles, reference data) belong to
        // every context.
        if ($organisationId === null) {
            return true;
        }

        return (string) $organisationId === $context->organisationId();
    }
}
