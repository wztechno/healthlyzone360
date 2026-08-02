<?php

declare(strict_types=1);

namespace Healthy360\Customers\Services;

use App\Models\User;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Contracts\AreaServiceLookup;
use Healthy360\Customers\Enums\CustomerAddressType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;

/**
 * Whether a customer account is ready to be used, and what is missing if not.
 *
 * **The server decides.** A client cannot set an account to `active`; it can
 * only ask this evaluator what remains and satisfy those things. That is the
 * "activation server-authority" property J1 is required to have, and it is
 * why the evaluator returns *reasons* rather than a boolean — the same call
 * powers the account setup checklist and the activation gate, so the two can
 * never disagree about what is outstanding.
 *
 * ## The requirements
 *
 * 1. **A verified email.** The only channel that really delivers, and the one
 *    a password reset depends on.
 * 2. **A verified phone — only where configuration says so.** This is gate
 *    A-011 and the production default is **off**. Requiring a verified phone
 *    while the SMS driver writes to a log file would lock every real customer
 *    out of their own account: nobody can prove a number the platform cannot
 *    send to. The flag flips when a provider is integrated. The check is
 *    doubly guarded — the configuration flag *and* whether any real channel
 *    exists for a phone — so a misconfigured environment cannot demand the
 *    impossible either.
 * 3. **A delivery address in an area somebody serves.** An account that cannot
 *    receive food is not ready to order it, and "served" is asked through the
 *    `AreaServiceLookup` port rather than by string-matching a place name.
 * 4. **The allergy question answered.** Answered — not "has no allergies". An
 *    unanswered question and a confident "none" are different facts, and only
 *    one of them may activate an account that is about to be sent food.
 * 5. **Every required consent held**, read from the consent catalogue's own
 *    `is_required` column for the `d2c` audience, so adding a required text is
 *    a seeder change rather than an edit here.
 */
final class AccountActivationEvaluator
{
    public const string REASON_EMAIL_UNVERIFIED = 'account.email_unverified';

    public const string REASON_PHONE_UNVERIFIED = 'account.phone_unverified';

    public const string REASON_NO_SERVED_ADDRESS = 'account.no_served_address';

    public const string REASON_DIETARY_UNDECLARED = 'account.dietary_declaration_missing';

    public const string REASON_CONSENTS_OUTSTANDING = 'account.consents_outstanding';

    public function __construct(
        private readonly AreaServiceLookup $areas,
        private readonly ConsentLedger $consents,
        private readonly PhoneVerificationPolicy $phonePolicy,
    ) {}

    /**
     * Everything still standing between this account and `active`.
     *
     * @return list<array{code: string, context: array<string, mixed>}>
     */
    public function outstanding(CustomerAccount $account): array
    {
        $reasons = [];

        if (! $this->hasVerifiedEmail($account)) {
            $reasons[] = ['code' => self::REASON_EMAIL_UNVERIFIED, 'context' => []];
        }

        if ($this->phonePolicy->isRequired() && ! $this->hasVerifiedPhone($account)) {
            $reasons[] = ['code' => self::REASON_PHONE_UNVERIFIED, 'context' => []];
        }

        $addressReason = $this->addressReason($account);

        if ($addressReason !== null) {
            $reasons[] = $addressReason;
        }

        if (! $this->hasDietaryDeclaration($account)) {
            $reasons[] = ['code' => self::REASON_DIETARY_UNDECLARED, 'context' => []];
        }

        $outstandingConsents = $this->outstandingConsents($account);

        if ($outstandingConsents !== []) {
            $reasons[] = ['code' => self::REASON_CONSENTS_OUTSTANDING, 'context' => ['consents' => $outstandingConsents]];
        }

        return $reasons;
    }

    public function isReady(CustomerAccount $account): bool
    {
        return $this->outstanding($account) === [];
    }

    /**
     * The checklist a client renders: every requirement, met or not, in a
     * stable order.
     *
     * Distinct from `outstanding()` because a checklist that showed only what
     * is missing would lose the sense of progress that makes people finish it
     * — and because "phone verification is not required here" is itself
     * something the screen has to be able to say, rather than a row that
     * silently disappears.
     *
     * @return list<array{code: string, satisfied: bool, required: bool}>
     */
    public function checklist(CustomerAccount $account): array
    {
        $phoneRequired = $this->phonePolicy->isRequired();

        return [
            ['code' => self::REASON_EMAIL_UNVERIFIED, 'satisfied' => $this->hasVerifiedEmail($account), 'required' => true],
            ['code' => self::REASON_PHONE_UNVERIFIED, 'satisfied' => $this->hasVerifiedPhone($account), 'required' => $phoneRequired],
            ['code' => self::REASON_NO_SERVED_ADDRESS, 'satisfied' => $this->addressReason($account) === null, 'required' => true],
            ['code' => self::REASON_DIETARY_UNDECLARED, 'satisfied' => $this->hasDietaryDeclaration($account), 'required' => true],
            ['code' => self::REASON_CONSENTS_OUTSTANDING, 'satisfied' => $this->outstandingConsents($account) === [], 'required' => true],
        ];
    }

    private function hasVerifiedEmail(CustomerAccount $account): bool
    {
        return $this->hasVerifiedContact($account, ContactChannel::Email);
    }

    private function hasVerifiedPhone(CustomerAccount $account): bool
    {
        return $this->hasVerifiedContact($account, ContactChannel::Phone);
    }

    /**
     * A verified contact of this kind, owned either by the account or by the
     * person holding it.
     *
     * Both owners are consulted because both are legitimate: a registered
     * customer's email is verified against their identity, while a guest's —
     * and any delivery number added to the account — hangs off the account.
     * Checking one would make the requirement unsatisfiable for half the
     * shapes this table supports.
     */
    private function hasVerifiedContact(CustomerAccount $account, ContactChannel $channel): bool
    {
        return ContactPoint::query()
            ->where('channel', $channel)
            ->whereNotNull('verified_at')
            ->whereNull('retired_at')
            ->where(function ($query) use ($account): void {
                $query->where('customer_account_id', $account->getKey());

                if ($account->user_id !== null) {
                    $query->orWhere('user_id', $account->user_id);
                }
            })
            ->exists();
    }

    /**
     * @return array{code: string, context: array<string, mixed>}|null
     */
    private function addressReason(CustomerAccount $account): ?array
    {
        /** @var list<string> $areaIds */
        $areaIds = CustomerAddress::query()
            ->where('customer_account_id', $account->getKey())
            ->where('address_type', CustomerAddressType::Delivery)
            ->pluck('delivery_area_id')
            ->unique()
            ->values()
            ->all();

        if ($areaIds === []) {
            return ['code' => self::REASON_NO_SERVED_ADDRESS, 'context' => ['has_address' => false]];
        }

        foreach ($areaIds as $areaId) {
            if ($this->areas->isServed($areaId)) {
                return null;
            }
        }

        // An address exists but nobody delivers to it. Distinguished from
        // having none, because the two need different words on screen: one is
        // "add an address", the other is "we do not deliver there yet".
        return ['code' => self::REASON_NO_SERVED_ADDRESS, 'context' => ['has_address' => true]];
    }

    private function hasDietaryDeclaration(CustomerAccount $account): bool
    {
        return CustomerDietaryProfile::query()
            ->where('customer_account_id', $account->getKey())
            ->whereNotNull('declared_at')
            ->exists();
    }

    /**
     * @return list<string>
     */
    private function outstandingConsents(CustomerAccount $account): array
    {
        $required = $this->consents->requiredCodesFor('d2c');

        if ($required === [] || $account->user_id === null) {
            // A guest account holds no user-scoped consent grants; G1 gives
            // guests their own consent path. Until then, an account with no
            // identity behind it cannot be blocked on a grant it has no way to
            // record.
            return [];
        }

        $user = User::query()->whereKey($account->user_id)->first();

        if (! $user instanceof User) {
            return $required;
        }

        return array_values(array_diff($required, $this->consents->grantedCodesFor($user)));
    }
}
