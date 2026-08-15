<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Services;

use App\Models\User;
use Healthy360\AccessControl\Services\PermissionCache;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Closure\Blockers\ActiveOrganisationMembershipsBlocker;
use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;
use Healthy360\Customers\Closure\Models\ClosedAccountTombstone;
use Healthy360\Customers\Closure\Results\ClosureReport;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Customers\Guest\Services\MarketingSuppressionRegistry;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Enums\UserStatus;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Models\UserDevice;
use Healthy360\Identity\Services\ContactValueHasher;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Verification\Models\OtpChallenge;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * The erasure itself.
 *
 * Split out of `ClosureService` because the two answer to different callers.
 * The service is a journey — asked, proven, scheduled, cancellable — and lives
 * on a request. This is a single act performed by a queue worker with nobody
 * watching, and it must be safe to run twice.
 *
 * ## What it does, and the order it does it in
 *
 * Order is not incidental. Each step depends on something the next one destroys.
 *
 *  1. **Read what has to survive first.** The tombstone hashes are computed
 *     from contact points that are about to be deleted, and the confirmation
 *     email is addressed from the same rows. A step that needed a value after
 *     the value was gone would be a step that quietly stopped working.
 *  2. **Cut off access**, before anything is rewritten: tokens, devices,
 *     sessions. A worker that anonymised first would leave a live bearer token
 *     pointed at a half-erased account for as long as the transaction ran.
 *  3. **Release obligations**: consents withdrawn, memberships ended, each one
 *     audited on its own because an organisation losing a member is that
 *     organisation's event and not a line item in somebody else's closure.
 *  4. **Delete the identifying rows** — contacts, addresses, challenges, the
 *     dietary cluster — mirroring `GuestDeletionService::purge()` step for
 *     step, including the marketing suppression hashes that stop the erasure
 *     undoing itself on the next import.
 *  5. **Anonymise what cannot be deleted**: the `users` row (the join target
 *     for everything retained), its profile, and the customer account.
 *  6. **Redact the retained orders** through the port, and **write the
 *     tombstone**.
 *
 * ## Idempotence
 *
 * The tombstone is the guard, and the unique index on `user_id` is what makes
 * it one. A second run finds it and returns `ClosureReport::alreadyClosed()`
 * without touching a row — which matters because a queue retry after a timeout
 * is the normal case, not the exceptional one.
 *
 * ## Two things that are retained rather than deleted, on purpose
 *
 * **Orders**, because a commercial and tax record has a retention of its own —
 * the delivery address is redacted through `OrderAnonymisation` and the money,
 * the dates and the delivery *area* survive.
 *
 * **Signature evidence.** A passcode challenge that a signed B2B agreement
 * points at is protected by a `RESTRICT` foreign key, and rightly: it is the
 * proof that a named person signed a contract, and a contract's counterparty
 * does not lose their evidence because the signatory later closed a personal
 * account. So challenges are stripped of everything identifying *first* and
 * deleted *second*, one at a time inside savepoints — what the database
 * refuses to release is evidence something else still needs, and it has already
 * been emptied of anything that names a person. The same treatment falls
 * through to the contact point that anchors it. Nothing here knows what a B2B
 * agreement is; it asks the database and believes the answer.
 */
final class AccountAnonymiser
{
    /**
     * The domain anonymised addresses are minted under.
     *
     * `.invalid` is reserved by RFC 2606 precisely so it can never resolve:
     * mail to it cannot leave the building, and a bug that tried to contact a
     * closed account fails at the first hop instead of reaching a real inbox
     * somebody else now owns.
     */
    public const string ANONYMISED_DOMAIN = 'anonymised.invalid';

    /** What replaces a name. NOT NULL columns cannot simply be emptied. */
    public const string REDACTED_NAME = '[redacted]';

    /** What replaces a masked destination on a retained challenge. */
    public const string REDACTED_MASK = '[redacted]';

    public function __construct(
        private readonly ContactValueHasher $hasher,
        private readonly MarketingSuppressionRegistry $suppressions,
        private readonly ConsentLedger $consents,
        private readonly PermissionCache $permissions,
        private readonly ActiveOrganisationMembershipsBlocker $memberships,
        private readonly OrderAnonymisation $orders,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * Erase everything identifying about this identity, and keep what must be
     * kept.
     */
    public function anonymise(User $user, ?CustomerAccount $account, AccountClosureRequest $request): ClosureReport
    {
        $userId = (string) $user->getKey();

        if (ClosedAccountTombstone::query()->where('user_id', $userId)->exists()) {
            return ClosureReport::alreadyClosed();
        }

        /** @var Collection<int, ContactPoint> $contacts */
        $contacts = $this->contactQuery($user, $account)->get();

        $emailHash = $this->loginEmailHash($user);
        $phoneHashes = $this->phoneHashes($contacts);

        $suppressed = 0;

        foreach ($contacts as $contact) {
            $this->suppressions->suppressContact($contact, SuppressionSource::Deletion);
            $suppressed++;
        }

        $consentsWithdrawn = $this->withdrawEveryConsent($user);
        $membershipsEnded = $this->endMemberships($user);

        $tokensRevoked = $user->tokens()->delete();
        $devicesRevoked = $this->revokeDevices($user);
        $sessionsRevoked = DB::table('sessions')->where('user_id', $userId)->delete();

        $ordersRetained = $account instanceof CustomerAccount
            ? $this->orders->retainedOrderCount((string) $account->getKey())
            : 0;

        $ordersAnonymised = null;

        if ($account instanceof CustomerAccount && $this->orders->isAvailable()) {
            $ordersAnonymised = $this->orders->anonymiseFor((string) $account->getKey());
        }

        $challengesDeleted = $this->purgeChallenges($user, $account);

        $report = DB::transaction(function () use (
            $user,
            $account,
            $request,
            $userId,
            $contacts,
            $emailHash,
            $phoneHashes,
            $suppressed,
            $consentsWithdrawn,
            $membershipsEnded,
            $tokensRevoked,
            $devicesRevoked,
            $sessionsRevoked,
            $ordersRetained,
            $ordersAnonymised,
            $challengesDeleted,
        ): ClosureReport {
            $addressesDeleted = 0;
            $dietaryDeleted = 0;

            if ($account instanceof CustomerAccount) {
                $addressesDeleted = CustomerAddress::query()
                    ->where('customer_account_id', $account->getKey())
                    ->delete();

                // Special-category data, and the row that matters most in this
                // list: an allergy declaration is the most sensitive thing
                // anybody tells this platform. Its declarations and exclusions
                // cascade with it.
                $dietaryDeleted = CustomerDietaryProfile::query()
                    ->where('customer_account_id', $account->getKey())
                    ->delete();
            }

            $contactsDeleted = $this->purgeContacts($contacts);

            $this->anonymiseUser($user);
            $this->anonymiseProfile($user);

            if ($account instanceof CustomerAccount) {
                $account->forceFill([
                    'display_name' => null,
                    'status' => CustomerAccountStatus::Closed,
                    // Both stamped together: the schema demands closed_at for a
                    // closed row and demands it before anonymised_at.
                    'closed_at' => $account->closed_at ?? now(),
                    'anonymised_at' => now(),
                    'guest_expires_at' => null,
                    'last_activity_at' => now(),
                ])->save();
            }

            ClosedAccountTombstone::query()->create([
                'user_id' => $userId,
                'customer_account_id' => $account?->getKey(),
                'closure_request_id' => $request->getKey(),
                'closed_at' => now(),
                'email_hash' => $emailHash,
                'phone_hashes' => $phoneHashes,
                'reason_code' => $request->reason_code->value,
            ]);

            return new ClosureReport(
                tokensRevoked: $tokensRevoked,
                devicesRevoked: $devicesRevoked,
                sessionsRevoked: $sessionsRevoked,
                consentsWithdrawn: $consentsWithdrawn,
                membershipsEnded: $membershipsEnded,
                contactsDeleted: $contactsDeleted,
                addressesDeleted: $addressesDeleted,
                challengesDeleted: $challengesDeleted,
                dietaryProfilesDeleted: $dietaryDeleted,
                suppressionsWritten: $suppressed,
                ordersRetained: $ordersRetained,
                ordersAnonymised: $ordersAnonymised,
                userAnonymised: true,
                accountAnonymised: $account instanceof CustomerAccount,
                tombstoneWritten: true,
            );
        });

        // Counts only, never identities. An erasure that logged what it erased
        // has rebuilt in the audit trail exactly what it removed from the
        // tables.
        $this->audit->record(
            'account.anonymised',
            subjectType: 'user',
            subjectId: $userId,
            metadata: $report->toArray() + ['closure_request' => (string) $request->getKey()],
        );

        return $report;
    }

    /**
     * Contacts belonging to this identity and to its account.
     *
     * Both owners, because `contact_points` is owned by exactly one of them and
     * a person who converted from a guest holds rows under each. A query on one
     * column would leave the other set behind — an address surviving an erasure
     * because of which table it happened to hang off.
     *
     * @return Builder<ContactPoint>
     */
    private function contactQuery(User $user, ?CustomerAccount $account): Builder
    {
        return ContactPoint::query()->where(function ($query) use ($user, $account): void {
            $query->where('user_id', $user->getKey());

            if ($account instanceof CustomerAccount) {
                $query->orWhere('customer_account_id', $account->getKey());
            }
        });
    }

    /**
     * The digest the tombstone stores for the login address.
     *
     * Taken from `users.email` rather than from a contact point, because the
     * email column is canonical for authentication (plan §10) and is the value
     * a re-registration would be checked against. Hashed with the same pepper
     * `contact_points.value_hash` uses, so the two are comparable and neither
     * is reversible.
     */
    private function loginEmailHash(User $user): string
    {
        return $this->hasher->hash(mb_strtolower(trim((string) $user->email)));
    }

    /**
     * @param  Collection<int, ContactPoint>  $contacts
     * @return list<string>
     */
    private function phoneHashes(Collection $contacts): array
    {
        return array_values(array_unique($contacts
            ->filter(static fn (ContactPoint $contact): bool => $contact->channel === ContactChannel::Phone)
            ->map(static fn (ContactPoint $contact): string => (string) $contact->value_hash)
            ->all()));
    }

    /**
     * Withdraw every consent this identity holds.
     *
     * The whole catalogue rather than the marketing subset: a closure is the
     * end of every lawful basis at once, and enumerating "the ones that
     * matter" here would mean this list drifting from the seeder's the first
     * time a definition is added.
     *
     * **The channel argument is inert and deliberately not a lie.**
     * `ConsentLedger::withdraw()` discards it — a withdrawal is a status
     * transition and writes no channel — so `account_closure` names what
     * actually happened rather than borrowing one of the three values
     * `consent_grants.channel` permits. If that parameter is ever wired to the
     * column, this call and the CHECK vocabulary have to be reconciled, and a
     * loud failure is the right way to find that out.
     */
    private function withdrawEveryConsent(User $user): int
    {
        /** @var list<string> $codes */
        $codes = $this->consents->currentDefinitions()->pluck('code')->all();

        if ($codes === []) {
            return 0;
        }

        return $this->consents->withdraw($user, $codes, 'account_closure');
    }

    /**
     * End every live membership, auditing each one separately.
     *
     * **Separately, and that is the point.** A kitchen losing a member of staff
     * is that organisation's event: it belongs in that organisation's audit
     * trail, stamped with that organisation's identifier, and folding all of
     * them into one closure record would make it invisible to the only people
     * who need to see it.
     *
     * Saved through the model rather than a bulk `update()` so
     * `PermissionVersionObserver` fires; the cache is then bumped explicitly as
     * well, because a step this important should be visible in the code that
     * depends on it rather than inherited from an observer three modules away.
     */
    private function endMemberships(User $user): int
    {
        $ended = 0;

        /** @var Collection<int, OrganisationMembership> $memberships */
        $memberships = $this->memberships->liveMembershipQuery((string) $user->getKey())->get();

        foreach ($memberships as $membership) {
            $organisationId = (string) $membership->organisation_id;

            $membership->forceFill(['status' => MembershipStatus::Ended->value])->save();

            $this->permissions->bumpVersion($organisationId);

            $this->audit->record(
                'account.membership_ended',
                subjectType: 'organisation_membership',
                subjectId: (string) $membership->getKey(),
                metadata: [
                    'organisation_id' => $organisationId,
                    'ended_by' => 'account_closure',
                ],
            );

            $ended++;
        }

        return $ended;
    }

    /**
     * Revoke every device and forget what it was called.
     *
     * `device_name` is somebody's own words — "Ali's iPhone" — so revoking
     * without rewriting it would leave a person's name on a row that survives
     * the closure. The backing tokens have already gone with
     * `$user->tokens()->delete()`; this is the device record catching up.
     */
    private function revokeDevices(User $user): int
    {
        return UserDevice::query()
            ->where('user_id', $user->getKey())
            ->whereNull('revoked_at')
            ->update([
                'device_name' => self::REDACTED_NAME,
                'revoked_at' => now(),
                'updated_at' => now(),
            ]);
    }

    /**
     * Strip every passcode challenge, then delete the ones the database will
     * release.
     *
     * Redaction comes first and unconditionally, so the outcome does not depend
     * on whether the delete succeeds. `destination_masked` is the only column
     * here that says anything about a person; `code_hash` is a credential
     * derivative that means nothing once the challenge is finished, and
     * `request_ip_hash` is dropped because an IP digest is still a fact about
     * where somebody was.
     *
     * The per-row savepoint is the whole trick: a challenge a signed agreement
     * points at is protected by `RESTRICT`, and one failed delete must not
     * abort a closure. Nothing in this method knows which challenges those are
     * — it asks Postgres by trying, which is the only definition that cannot
     * drift from the schema.
     */
    private function purgeChallenges(User $user, ?CustomerAccount $account): int
    {
        $query = OtpChallenge::query()->where(function ($inner) use ($user, $account): void {
            $inner->where('user_id', $user->getKey());

            if ($account instanceof CustomerAccount) {
                $inner->orWhere('customer_account_id', $account->getKey());
            }
        });

        (clone $query)->update([
            'destination_masked' => self::REDACTED_MASK,
            'request_ip_hash' => null,
            'updated_at' => now(),
        ]);

        /** @var list<string> $ids */
        $ids = (clone $query)->pluck('id')->all();
        $deleted = 0;

        foreach ($ids as $id) {
            try {
                DB::transaction(static fn (): int => OtpChallenge::query()->whereKey($id)->delete());
                $deleted++;
            } catch (QueryException) {
                // Retained signature evidence, already emptied of anything
                // identifying. See the class docblock.
            }
        }

        return $deleted;
    }

    /**
     * Delete the contact points, redacting in place the ones that cannot go.
     *
     * A contact point anchors the challenges issued against it, so one that
     * still anchors retained signature evidence cannot be deleted without
     * cascading into it. Those rows are emptied instead: the plaintext value
     * and its digest are both replaced with a value derived from fresh
     * randomness — not from the address, so nothing can be recovered by
     * rehashing a guess — the label goes, and the row is retired so no
     * uniqueness index treats it as a live claim on an address somebody else
     * may now register.
     *
     * @param  Collection<int, ContactPoint>  $contacts
     */
    private function purgeContacts(Collection $contacts): int
    {
        $deleted = 0;

        foreach ($contacts as $contact) {
            try {
                DB::transaction(static fn (): ?bool => $contact->delete());
                $deleted++;
            } catch (QueryException $exception) {
                // Why, never who. A retained contact point is a decision the
                // database made on somebody else's behalf, and an operator
                // reading this needs the constraint that made it — not the
                // address it protects.
                Log::warning('Closure retained a contact point the database would not release; it has been redacted in place.', [
                    'sqlstate' => $exception->getCode(),
                ]);

                $contact->forceFill([
                    'value_normalised' => self::REDACTED_NAME,
                    'value_hash' => hash('sha256', Str::uuid()->toString()),
                    'label' => null,
                    'is_login_identity' => false,
                    'is_primary' => false,
                    'verified_at' => null,
                    'retired_at' => now(),
                ])->save();
            }
        }

        return $deleted;
    }

    /**
     * Free the email address and close the login.
     *
     * **Freeing the address is the deliberate part** (D-042). `users.email` is
     * unique, so a closed account holding its old address forever would deny
     * that address to the person who owns it — including to the same person,
     * who is entitled to come back. The replacement is minted from a fresh
     * UUID under a domain that cannot resolve, and the tombstone's digest is
     * what still answers "did this address ever have an account here".
     *
     * The password is replaced rather than nulled because the column is NOT
     * NULL, and it is replaced with randomness rather than a constant so that
     * no two closed accounts share a hash — a table of identical password
     * hashes is a signature, and signatures get recognised.
     *
     * Both timestamps are stamped in one write: `users_anonymised_at_check`
     * refuses `anonymised_at` without `closed_at`.
     */
    private function anonymiseUser(User $user): void
    {
        $user->forceFill([
            'email' => 'closed+'.Str::uuid()->toString().'@'.self::ANONYMISED_DOMAIN,
            'email_verified_at' => null,
            // Cast `hashed`, so the random string is hashed on write and the
            // plaintext is never stored anywhere, including here.
            'password' => Str::random(64),
            'remember_token' => null,
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'status' => UserStatus::Closed,
            'closed_at' => $user->closed_at ?? now(),
            'anonymised_at' => now(),
        ])->save();
    }

    /**
     * Empty the profile.
     *
     * `given_name`, `family_name` and `preferred_language_code` are NOT NULL,
     * so the first two are overwritten rather than cleared — a reader should be
     * able to tell "erased" from "never filled in". The language stays: it
     * names a text, not a person, and it is a real foreign key.
     *
     * `timezone` goes back to the column default rather than being kept.
     * A timezone is a coarse location, and coarse is not the same as
     * anonymous.
     */
    private function anonymiseProfile(User $user): void
    {
        DB::table('user_profiles')
            ->where('user_id', $user->getKey())
            ->update([
                'given_name' => self::REDACTED_NAME,
                'family_name' => self::REDACTED_NAME,
                'date_of_birth' => null,
                'country_code' => null,
                'timezone' => 'UTC',
                'last_organisation_id' => null,
                'last_branch_id' => null,
                'updated_at' => now(),
            ]);
    }
}
