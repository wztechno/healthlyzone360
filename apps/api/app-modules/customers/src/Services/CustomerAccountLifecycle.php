<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use App\Models\User;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Exceptions\AccountTransitionRejected;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Identity\Models\UserProfile;
use Illuminate\Support\Facades\DB;
use Random\RandomException;

/**
 * Creating a customer account and moving it through its states.
 *
 * The state machine lives in `CustomerAccountStatus::canTransitionTo()` and
 * the *effects* live here, which is the split that keeps both readable: the
 * enum says what is legal, this says what happens. Every transition stamps its
 * own timestamp column, because `updated_at` cannot answer "when did this
 * account activate" and that is a question orders, subscriptions and retention
 * all ask.
 *
 * **Activation is not a transition a caller may request directly.**
 * `activate()` consults the evaluator and refuses if anything is outstanding.
 * There is deliberately no bypass: an account that is active without meeting
 * the requirements is an account that can order food without a deliverable
 * address or an answered allergy question.
 */
final class CustomerAccountLifecycle
{
    public function __construct(
        private readonly CustomerAccountNumbers $numbers,
        private readonly AccountActivationEvaluator $evaluator,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * Open a provisional consumer account for a person.
     *
     * Idempotent: the partial unique index allows one `b2c` account per user,
     * and this converges on the existing one rather than colliding with it. A
     * person who starts onboarding twice has one account.
     *
     * @throws RandomException
     */
    public function openConsumerAccount(
        User $user,
        CustomerAccountOrigin $origin = CustomerAccountOrigin::SelfService,
        ?string $displayName = null,
    ): CustomerAccount {
        return DB::transaction(function () use ($user, $origin, $displayName): CustomerAccount {
            $existing = CustomerAccount::query()
                ->where('user_id', $user->getKey())
                ->where('account_type', CustomerAccountType::B2c)
                ->lockForUpdate()
                ->first();

            if ($existing instanceof CustomerAccount) {
                return $existing;
            }

            // Queried rather than read through the relation accessor: a user
            // may legitimately have no profile row (an account created before
            // the profile write, a test fixture), and opening a customer
            // account must not depend on one existing.
            $profile = UserProfile::query()->where('user_id', $user->getKey())->first();

            $account = CustomerAccount::query()->create([
                'account_number' => $this->numbers->next(),
                'account_type' => CustomerAccountType::B2c,
                'user_id' => $user->getKey(),
                'organisation_id' => null,
                'status' => CustomerAccountStatus::Provisional,
                'origin' => $origin,
                // `->` rather than `?->` on the left of `??`: the coalesce
                // already suppresses a property read on null, and the nullsafe
                // operator on top of it is noise.
                'display_name' => $displayName ?? trim(($profile->given_name ?? '').' '.($profile->family_name ?? '')) ?: null,
                'preferred_language_code' => $profile?->preferred_language_code,
                'country_code' => $profile?->country_code,
                // Stamped from configuration at creation and never
                // recomputed: an account opened under a 30-day window must not
                // silently acquire a shorter one when the setting changes.
                'provisional_expires_at' => now()->addDays(max(1, (int) config('verification.provisional_account_ttl_days', 30))),
                'last_activity_at' => now(),
                'created_by' => $user->getKey(),
            ]);

            $this->audit->record(
                'customer.account_opened',
                actorUserId: (string) $user->getKey(),
                subjectType: 'customer_account',
                subjectId: (string) $account->getKey(),
                metadata: [
                    'account_type' => $account->account_type->value,
                    'origin' => $origin->value,
                    'status' => $account->status->value,
                ],
            );

            return $account;
        });
    }

    /**
     * Open a consumer account for somebody a member of staff is writing down.
     *
     * The cold caller: a person rings a kitchen having never used the platform,
     * and there is no account for the order to be placed against. Every other
     * way an account comes into being is the customer doing it — registering,
     * checking out as a guest, being provisioned with a corporate buyer — and
     * this is the one path where the record is made *about* somebody who is not
     * at a keyboard.
     *
     * **A `b2c` account with no user**, which the shape CHECK admits from
     * 2026_08_16_003006 onwards under `origin = 'staff'`. Not a guest: a guest
     * is temporary by construction and the expiry sweeps would reap a kitchen's
     * Thursday regular between two orders. The account is durable and claimable
     * — the day this person registers, G1's conversion attaches a user to a row
     * that already holds their number, their address and their order history.
     *
     * **`provisional_expires_at` stays NULL**, which is the second half of the
     * same argument. That column is what `PurgeAbandonedProvisionalAccounts`
     * reads, and an account somebody at a desk took the trouble to write down is
     * not an abandoned sign-up. The purge is guarded twice over —
     * `CustomerAccountOrigin::isPurgeable()` excludes `staff`, and the job also
     * requires a non-null deadline — so neither guard is load-bearing alone.
     *
     * **Provisional, and it stays provisional.** Activation is the evaluator's
     * verdict and a cold caller satisfies none of it: no verified email, no
     * declared dietary answer. That is not an obstacle to selling to them,
     * because the desk's placement path names `placed_on_behalf_by` and skips
     * the checklist — the member of staff in front of the customer *is* the
     * verification it was asking for. Marking the account active here would be
     * the same bypass, written once, in the wrong place, where every other
     * surface would inherit it.
     *
     * Not idempotent, and deliberately unlike `openConsumerAccount()`. There is
     * no user to converge on and no unique index to converge against: two
     * callers with the same name are two customers, and a search-first workflow
     * plus an `Idempotency-Key` on the endpoint is what stops a double tap
     * becoming two rows.
     *
     * @throws RandomException
     */
    public function openStaffProvisionedAccount(
        string $displayName,
        string $actorUserId,
        ?string $preferredLanguageCode = null,
        ?string $countryCode = null,
    ): CustomerAccount {
        return DB::transaction(function () use ($displayName, $actorUserId, $preferredLanguageCode, $countryCode): CustomerAccount {
            $account = CustomerAccount::query()->create([
                'account_number' => $this->numbers->next(),
                'account_type' => CustomerAccountType::B2c,
                'user_id' => null,
                'organisation_id' => null,
                'status' => CustomerAccountStatus::Provisional,
                'origin' => CustomerAccountOrigin::Staff,
                'display_name' => $displayName,
                'preferred_language_code' => $preferredLanguageCode,
                'country_code' => $countryCode,
                'provisional_expires_at' => null,
                'last_activity_at' => now(),
                'created_by' => $actorUserId,
            ]);

            // The same event `openConsumerAccount()` records, with the same
            // three metadata keys, so that "how did this account come to exist"
            // is one query over one code rather than a union of two. The origin
            // is what tells the two apart, and it is already in the metadata.
            $this->audit->record(
                'customer.account_opened',
                actorUserId: $actorUserId,
                subjectType: 'customer_account',
                subjectId: (string) $account->getKey(),
                metadata: [
                    'account_type' => $account->account_type->value,
                    'origin' => CustomerAccountOrigin::Staff->value,
                    'status' => $account->status->value,
                ],
            );

            return $account;
        });
    }

    /**
     * Activate, if the evaluator agrees.
     *
     * @throws AccountTransitionRejected
     */
    public function activate(CustomerAccount $account, ?string $actorUserId = null): CustomerAccount
    {
        if ($account->status === CustomerAccountStatus::Active) {
            return $account;
        }

        $this->assertCanMove($account, CustomerAccountStatus::Active);

        $outstanding = $this->evaluator->outstanding($account);

        if ($outstanding !== []) {
            throw AccountTransitionRejected::notReady(array_map(
                static fn (array $reason): string => $reason['code'],
                $outstanding,
            ));
        }

        return $this->move($account, CustomerAccountStatus::Active, ['activated_at' => now(), 'suspended_at' => null], $actorUserId);
    }

    /**
     * @throws AccountTransitionRejected
     */
    public function suspend(CustomerAccount $account, string $reason, ?string $actorUserId = null): CustomerAccount
    {
        $this->assertCanMove($account, CustomerAccountStatus::Suspended);

        return $this->move($account, CustomerAccountStatus::Suspended, ['suspended_at' => now()], $actorUserId, ['reason' => $reason]);
    }

    /**
     * @throws AccountTransitionRejected
     */
    public function reinstate(CustomerAccount $account, ?string $actorUserId = null): CustomerAccount
    {
        $this->assertCanMove($account, CustomerAccountStatus::Active);

        return $this->move($account, CustomerAccountStatus::Active, ['activated_at' => $account->activated_at ?? now(), 'suspended_at' => null], $actorUserId);
    }

    /**
     * Close the account. Terminal — the enum refuses every move out of it.
     *
     * Anonymisation is **not** performed here. It is J2's, it runs after a
     * retention period, and collapsing the two would make "closed but still
     * identifiable" — the normal state during a grace window —
     * unrepresentable.
     *
     * @throws AccountTransitionRejected
     */
    public function close(CustomerAccount $account, string $reason, ?string $actorUserId = null): CustomerAccount
    {
        $this->assertCanMove($account, CustomerAccountStatus::Closed);

        return $this->move($account, CustomerAccountStatus::Closed, ['closed_at' => now()], $actorUserId, ['reason' => $reason]);
    }

    /**
     * Note that somebody used the account, so the abandonment purge can tell a
     * dormant account from a forgotten one.
     */
    public function touch(CustomerAccount $account): void
    {
        $account->forceFill(['last_activity_at' => now()])->save();
    }

    /**
     * @throws AccountTransitionRejected
     */
    private function assertCanMove(CustomerAccount $account, CustomerAccountStatus $to): void
    {
        if (! $account->status->canTransitionTo($to)) {
            throw AccountTransitionRejected::illegal($account->status, $to);
        }
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @param  array<string, scalar|list<scalar>|null>  $metadata
     */
    private function move(
        CustomerAccount $account,
        CustomerAccountStatus $to,
        array $attributes,
        ?string $actorUserId,
        array $metadata = [],
    ): CustomerAccount {
        $from = $account->status;

        $account->forceFill(['status' => $to, 'updated_by' => $actorUserId] + $attributes)->save();

        $this->audit->record(
            'customer.account_status_changed',
            actorUserId: $actorUserId,
            subjectType: 'customer_account',
            subjectId: (string) $account->getKey(),
            metadata: [
                'from_status' => $from->value,
                'to_status' => $to->value,
            ] + $metadata,
        );

        return $account;
    }
}
