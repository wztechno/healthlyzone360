<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Support\Facades\DB;

/**
 * Opening an account for somebody who is standing in front of you.
 *
 * Every other account on this platform is opened by the person who owns it:
 * registration, guest checkout, an invitation accepted from a mailbox only
 * they can read. This is the one path where a member of staff creates an
 * identity *about* somebody else — and it exists because the alternative, for a
 * kitchen hand with no email address, is no account at all.
 *
 * It is the invitation flow's sibling rather than its replacement. A colleague
 * with a mailbox should still be invited: they choose their own password, and
 * nobody but them ever knows it. This is for the case where that is impossible.
 *
 * ## Three departures, each one deliberate
 *
 * **The account is created email-verified.** Staff areas require a verified
 * address (`ROUTE_REQUIREMENTS`), and a provisioned address is frequently one
 * that receives no mail — so waiting for a verification link would create an
 * account that can never enter the workspace it was made for. The
 * justification is the one the registry already accepts for
 * `order.create_on_behalf_organisation`: the member of staff standing in front
 * of the customer *is* the verification the checklist was asking for. Here the
 * administrator vouches, and the audit trail records who.
 *
 * **The password must be changed at first sign-in.** `must_change_password` is
 * set here and cleared by `POST /auth/update-password`. What the administrator
 * knows is therefore a credential good for exactly one sign-in, which is the
 * least it can be while still being handed over in person.
 *
 * **No consent grants, and no customer account.** `CreateNewUser` writes both,
 * because a person registering themselves is accepting terms and opening a
 * basket. Neither is true here: a kitchen cannot accept terms on an employee's
 * behalf — that is the one thing a proxy registration must not do — and a line
 * cook is not a shopper. The consent is collected from them, by them, when
 * they first sign in.
 *
 * ## One transaction, and the same writes the granter makes
 *
 * User, profile, login contact point, membership and role in one statement's
 * worth of atomicity. A half-provisioned identity — an account with no
 * membership, a membership with no role — is exactly the shape somebody would
 * discover at six in the morning, and the membership writes mirror
 * `MembershipGranter` deliberately so that a provisioned member is
 * indistinguishable from an invited one.
 */
final readonly class StaffProvisioning
{
    public function __construct(
        private ContactPointRegistry $contacts,
        private StaffLoginIdentity $identity,
        private PermissionCache $cache,
    ) {}

    /**
     * @param  array{
     *     email: string,
     *     given_name: string,
     *     family_name: string,
     *     password: string,
     *     preferred_language_code: string|null,
     *     role_ids: list<string>,
     *     branch_id: string|null
     * }  $input
     *
     * @throws ApiException
     */
    public function provision(Organisation $organisation, array $input, User $actor): OrganisationMembership
    {
        $this->identity->assertAvailable($input['email']);

        $roles = $this->resolveRoles($input['role_ids']);
        $branch = $this->resolveBranch($input['branch_id']);

        return DB::transaction(function () use ($organisation, $input, $actor, $roles, $branch): OrganisationMembership {
            // `User` is `#[Fillable(['email', 'password'])]`, so the other two
            // columns are set with `forceFill` rather than passed to `create`,
            // where mass-assignment protection would drop them silently — an
            // account that looked provisioned and was neither verified nor
            // obliged to rotate its password.
            $user = new User;
            $user->forceFill([
                'email' => $input['email'],
                'password' => $input['password'],
                // Vouched for by the administrator rather than proved by a
                // link. See the class comment — a staff area demands a verified
                // address, and a provisioned address often receives no mail.
                'email_verified_at' => now(),
                'must_change_password' => true,
            ])->save();

            UserProfile::query()->create([
                'user_id' => $user->getKey(),
                'given_name' => $input['given_name'],
                'family_name' => $input['family_name'],
                'preferred_language_code' => $input['preferred_language_code'] ?? $organisation->default_language_code,
                'country_code' => $organisation->country_code,
                'timezone' => 'UTC',
                'numbering_system' => 'latn',
                // The administrator, not the account itself: this identity did
                // not create itself, and the row should say so.
                'created_by' => $actor->getKey(),
            ]);

            $contact = $this->contacts->rememberForUser(
                user: $user,
                channel: ContactChannel::Email,
                value: $input['email'],
                isLoginIdentity: true,
                isPrimary: true,
                // `staff`, one of the four the column documents. It is the
                // only durable record of *how* this identity came to exist,
                // and the one a later review reads to tell a self-registered
                // account from a provisioned one.
                source: 'staff',
            );

            // The mirror is stamped too, and for the same reason the account
            // is: leaving it unverified beside a verified `users` row would
            // make the two disagree about the same fact.
            $this->contacts->markVerified($contact);

            $membership = OrganisationMembership::withoutTenancy()->create([
                'organisation_id' => $organisation->getKey(),
                'user_id' => $user->getKey(),
                'branch_id' => $branch?->getKey(),
                'status' => MembershipStatus::Active,
                'joined_at' => now(),
                'created_by' => $actor->getKey(),
                'lock_version' => 0,
            ]);

            foreach ($roles as $role) {
                MembershipRole::withoutTenancy()->create([
                    'organisation_id' => $organisation->getKey(),
                    'membership_id' => $membership->getKey(),
                    'role_id' => $role->getKey(),
                    'created_by' => $actor->getKey(),
                ]);
            }

            $this->cache->bumpVersion((string) $organisation->getKey());

            return $membership;
        });
    }

    /**
     * Every named role must be one this organisation may assign.
     *
     * Read through the tenant scope, so a cross-tenant identifier never becomes
     * a readable row — and a platform template resolves happily, because
     * assigning one is the ordinary case.
     *
     * @param  list<string>  $roleIds
     * @return list<Role>
     *
     * @throws ApiException
     */
    private function resolveRoles(array $roleIds): array
    {
        if ($roleIds === []) {
            return [];
        }

        $roles = Role::query()->whereIn('id', $roleIds)->get();
        $found = $roles->map(static fn (Role $role): string => (string) $role->getKey())->all();
        $refused = array_values(array_diff($roleIds, $found));

        if ($refused !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Those roles are not available in this organisation.',
                [
                    'fields' => ['role_ids' => ['Those roles are not available in this organisation.']],
                    'refused_role_ids' => $refused,
                ],
            );
        }

        return $roles->all();
    }

    /**
     * @throws ApiException
     */
    private function resolveBranch(?string $branchId): ?OrganisationBranch
    {
        if ($branchId === null) {
            return null;
        }

        $branch = OrganisationBranch::query()->whereKey($branchId)->first();

        if (! $branch instanceof OrganisationBranch) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'That branch does not exist in this organisation.',
                ['fields' => ['branch_id' => ['That branch does not exist in this organisation.']]],
            );
        }

        return $branch;
    }
}
