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
use Healthy360\Identity\Contracts\ProgrammeMembershipLookup;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Organisations\Presenters\OrganisationPresenter;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\Exceptions\BranchOutsideMembershipScope;
use Healthy360\Tenancy\Services\ContextValidator;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
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
        private readonly ProgrammeMembershipLookup $programmes,
        private readonly DatabaseTenantContext $database,
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

            // AA1. True only for an account an administrator opened on
            // somebody's behalf, and only until they replace the password they
            // were handed. It sits beside `email_verified` rather than inside
            // `active_context` because it is a fact about the *identity*, not
            // about one organisation: the same person is held on the
            // change-password screen whichever workspace they were heading for.
            //
            // The client reads it in `resolveLandingRoute()` and holds them
            // there; the server does not enforce it, deliberately. A flag that
            // blocked every endpoint would block the one that clears it, and
            // an account with a password two people know is a weaker problem
            // than an account nobody can fix.
            'must_change_password' => (bool) $user->must_change_password,
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

        $roleCodes = $this->roleCodesByMembership($user, $memberships);

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
            // B2. Every membership of the organisation shares this list (B7:
            // org-shared server drafts) — there is no per-user grant to
            // filter by, so "membership" here means "this org is the buyer".
            'corporate_programmes' => $this->programmes->activeProgrammesFor((string) $membership->organisation_id),
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
     * Each membership's role codes.
     *
     * **Read as each organisation in turn.** A membership holds its
     * organisation's own copy of a role (`OrganisationRoles::provision`), and
     * `rls_role_select` admits a tenant row only inside that organisation's
     * context, while /me spans organisations and may have none. So the codes
     * are read inside `during()` for each organisation the person belongs to,
     * on behalf of that person; outside it a role the person holds would read
     * as no role at all.
     *
     * @param  EloquentCollection<int, OrganisationMembership>  $memberships
     * @return array<string, list<string>>
     */
    private function roleCodesByMembership(User $user, EloquentCollection $memberships): array
    {
        $assignments = MembershipRole::withoutTenancy()
            ->whereIn('membership_id', $memberships->map(
                static fn (OrganisationMembership $membership): string => (string) $membership->getKey(),
            )->all())
            ->get();

        $organisationOf = $memberships->mapWithKeys(static fn (OrganisationMembership $membership): array => [
            (string) $membership->getKey() => (string) $membership->organisation_id,
        ]);

        /** @var array<string, string> $roles */
        $roles = [];

        foreach ($assignments->groupBy(fn (MembershipRole $assignment): string => (string) $organisationOf->get((string) $assignment->membership_id)) as $organisationId => $held) {
            $codes = $this->database->during(
                (string) $user->getKey(),
                (string) $organisationId,
                null,
                fn (): Collection => Role::withoutTenancy()
                    ->whereIn('id', $held->pluck('role_id')->all())
                    ->pluck('code', 'id'),
            );

            foreach ($codes as $roleId => $code) {
                $roles[(string) $roleId] = (string) $code;
            }
        }

        $roles = collect($roles);

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
