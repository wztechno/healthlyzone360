<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Features\Services\FeatureEntitlementChecker;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Presenters\OrganisationPresenter;
use Healthy360\Tenancy\Exceptions\BranchOutsideMembershipScope;
use Healthy360\Tenancy\Services\ContextValidator;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Collection;

/**
 * Builds the current-user payload behind /api/v1/me — the hydration step of
 * the foundation vertical slice (plan §1).
 *
 * Every organisation-scoped read here goes through withoutTenancy(): /me
 * deliberately spans organisations (one global identity, many memberships)
 * and each query is constrained to the authenticated user's own rows, so it
 * is an explicit cross-tenant path rather than an ambient one.
 */
final class UserContextHydrator
{
    public function __construct(
        private readonly ContextValidator $validator,
        private readonly TenantContext $tenant,
        private readonly PermissionChecker $checker,
        private readonly PermissionCache $permissionCache,
        private readonly FeatureEntitlementChecker $entitlements,
        private readonly ConsentLedger $consents,
        private readonly OrganisationPresenter $organisations,
    ) {}

    /**
     * @return array{
     *     data: array<string, mixed>,
     *     meta: array{permissions_version: string}
     * }
     */
    public function me(User $user, ?string $organisationId, ?string $branchId): array
    {
        $context = $this->activeContext($user, $organisationId, $branchId);

        return [
            'data' => [
                'user' => $this->user($user),
                'profile' => $this->profile($user),
                'memberships' => $this->memberships($user),
                'active_context' => $context,
                'pending_consents' => $this->consents->pendingFor($user),
            ],
            'meta' => [
                'permissions_version' => $this->permissionCache->signature($this->tenant->organisationId()),
            ],
        ];
    }

    /**
     * @return array{id: string, email: string, email_verified: bool, two_factor_enabled: bool}
     */
    public function user(User $user): array
    {
        return [
            'id' => (string) $user->getKey(),
            'email' => $user->email,
            'email_verified' => $user->hasVerifiedEmail(),
            'two_factor_enabled' => $user->hasEnabledTwoFactorAuthentication(),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function profile(User $user): ?array
    {
        $profile = $user->profile;

        if (! $profile instanceof UserProfile) {
            return null;
        }

        return [
            'given_name' => $profile->given_name,
            'family_name' => $profile->family_name,
            'preferred_language_code' => $profile->preferred_language_code,
            'country_code' => $profile->country_code,
            'timezone' => $profile->timezone,
            'numbering_system' => $profile->numbering_system,
            'date_of_birth' => $profile->date_of_birth?->toDateString(),
        ];
    }

    /**
     * Memberships the user may act under, newest first. Ended memberships are
     * omitted: they are history, not a workspace the client can offer.
     *
     * @return list<array<string, mixed>>
     */
    public function memberships(User $user): array
    {
        $memberships = OrganisationMembership::withoutTenancy()
            ->where('user_id', $user->getKey())
            ->where('status', '!=', MembershipStatus::Ended)
            ->orderByDesc('joined_at')
            ->get();

        if ($memberships->isEmpty()) {
            return [];
        }

        $organisations = Organisation::query()
            ->with('type')
            ->whereIn('id', $memberships->pluck('organisation_id')->all())
            ->get()
            ->keyBy(fn (Organisation $organisation): string => (string) $organisation->getKey());

        $roleCodes = $this->roleCodesByMembership(array_values($memberships
            ->map(static fn (OrganisationMembership $membership): string => (string) $membership->getKey())
            ->all()));

        return array_values($memberships
            ->map(function (OrganisationMembership $membership) use ($organisations, $roleCodes): ?array {
                $organisation = $organisations->get((string) $membership->organisation_id);

                if (! $organisation instanceof Organisation) {
                    return null;
                }

                return [
                    'id' => (string) $membership->getKey(),
                    'status' => $membership->status->value,
                    'branch_id' => $membership->branch_id,
                    'joined_at' => $membership->joined_at?->toIso8601String(),
                    'organisation' => $this->organisations->organisation($organisation),
                    'roles' => $roleCodes[(string) $membership->getKey()] ?? [],
                ];
            })
            ->filter()
            ->all());
    }

    /**
     * Resolve, validate and hydrate the working context. Returns null when
     * nothing valid was claimed — an unusable remembered context degrades to
     * "no context" instead of failing the request.
     *
     * @return array<string, mixed>|null
     */
    public function activeContext(User $user, ?string $organisationId, ?string $branchId): ?array
    {
        $membership = $this->validator->findMembership($user, $organisationId);

        if ($membership === null) {
            return null;
        }

        $organisation = Organisation::query()->with('type')->find($membership->organisation_id);

        if (! $organisation instanceof Organisation) {
            return null;
        }

        $resolvedBranchId = $this->resolveBranch($membership, $branchId);

        $this->tenant->setOrganisation(
            (string) $user->getKey(),
            (string) $membership->organisation_id,
            $membership,
        );

        if ($resolvedBranchId !== null) {
            $this->tenant->setBranch($resolvedBranchId);
        }

        $branch = $resolvedBranchId === null
            ? null
            : OrganisationBranch::withoutTenancy()->find($resolvedBranchId);

        return [
            'organisation' => $this->organisations->organisation($organisation),
            'branch' => $branch instanceof OrganisationBranch ? $this->organisations->branch($branch) : null,
            'membership_id' => (string) $membership->getKey(),
            'permissions' => $this->checker->calculatedPermissions($user, $membership, $this->tenant),
            'entitlements' => $this->entitlements->entitledCodes((string) $membership->organisation_id),
        ];
    }

    /**
     * A remembered or header-supplied branch that no longer validates is
     * dropped rather than raised: only an explicit PUT /me/context is allowed
     * to fail on a bad branch.
     */
    private function resolveBranch(OrganisationMembership $membership, ?string $branchId): ?string
    {
        try {
            return $this->validator->branch($membership, $branchId);
        } catch (BranchOutsideMembershipScope) {
            return $membership->branch_id;
        }
    }

    /**
     * @param  list<string>  $membershipIds
     * @return array<string, list<string>>
     */
    private function roleCodesByMembership(array $membershipIds): array
    {
        $assignments = MembershipRole::withoutTenancy()
            ->whereIn('membership_id', $membershipIds)
            ->get();

        $roles = Role::withoutTenancy()
            ->whereIn('id', $assignments->pluck('role_id')->all())
            ->pluck('code', 'id');

        return $assignments
            ->groupBy('membership_id')
            ->map(fn (Collection $group): array => array_values($group
                ->map(fn (MembershipRole $assignment): ?string => $roles->get($assignment->role_id))
                ->filter()
                ->unique()
                ->all()))
            ->all();
    }
}
