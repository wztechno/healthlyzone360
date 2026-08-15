<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Services;

use App\Models\User;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Guest\Exceptions\GuestConversionRejected;
use Healthy360\Customers\Guest\Exceptions\GuestSessionRejected;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Results\GuestContactChallenge;
use Healthy360\Customers\Guest\Results\StartedGuestSession;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Services\CustomerAccountNumbers;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactPointRegistry;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Exceptions\ChannelUnavailable;
use Healthy360\Verification\Exceptions\OtpIssueRefused;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Results\OtpVerificationResult;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Support\Facades\DB;
use Random\RandomException;

/**
 * Everything a guest is, from the first anonymous request to the moment they
 * stop being one.
 *
 * ## Why this lives in Customers and not in a module of its own
 *
 * There is no `guest` entry in the module registry, and G1 does not add one.
 * The registry already assigns this work to Customers in as many words —
 * "Closure and anonymisation arrive with J2; the guest journey with G1" — and
 * the domain agrees with the registry: a guest *is* a `customer_accounts` row
 * in one of the three shapes that table has enforced by CHECK since J1. A
 * separate module would need a foreign key back into `customer_accounts` on
 * every table it owned, would import the Customers enums to say anything at
 * all, and would leave conversion — the moment a guest becomes a `b2c`
 * account — spanning a module boundary for no benefit. So the machinery sits
 * in a `Guest\` namespace inside Customers: separable if it ever needs to be,
 * and honest that today it is one module's internal concern.
 *
 * ## The design
 *
 * **A guest is a `customer_accounts` row, not a new kind of thing** (D-038).
 * `account_type = 'guest'`, `origin = 'guest'`, `user_id IS NULL` — a shape the
 * table already enforces by CHECK. Every consumer downstream (addresses,
 * orders, consents, dietary declarations) therefore works on a guest without
 * knowing one exists, and conversion is a change of shape rather than a
 * migration of data between two parallel worlds.
 *
 * **The credential is opaque and graded, and it is not Sanctum** (D-039). See
 * `GuestSessionTokens` for why the digest is unpeppered and
 * `GuestSessionGrade` for what the two grades mean. The short version: Sanctum
 * issues tokens *for users*, and a guest has none by definition.
 *
 * **The grade is raised by proof, and only by proof.** `checkout_draft` builds a
 * basket; `place_order` requires a passcode against a contact point the guest
 * supplied, because an order is a promise to tell somebody when it is late.
 * `guest_sessions_grade_proof_check` makes that structural — a bug that skipped
 * verification cannot write the higher grade at all.
 *
 * **Verifying a guest's contact does not mark the contact point verified**, and
 * that is deliberate rather than an omission. `contact_points` has one *proven*
 * holder per value per channel, and that holder should be an identity: a guest
 * is ephemeral, and letting one claim the platform-wide verified slot for an
 * address would let anybody deny it to its real owner by ordering a salad. Worse,
 * `markVerified()` refuses with `alreadyVerifiedElsewhere` when somebody else
 * holds the value — surfacing that to an anonymous caller would be a free
 * "does this address have an account here" oracle. So the proof is recorded on
 * the *session*, which is where it belongs: this browser, holding this token,
 * proved this destination, for this long.
 */
final class GuestSessionService
{
    public function __construct(
        private readonly GuestSessionTokens $tokens,
        private readonly GuestRetentionWindows $windows,
        private readonly CustomerAccountNumbers $numbers,
        private readonly ContactPointRegistry $contacts,
        private readonly OtpService $otp,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * Open a guest account and mint its first token.
     *
     * The account and the session are created together in one transaction
     * because neither is meaningful alone: an account with no token is a row
     * nobody can reach, and a token with no account points at nothing. The
     * plaintext is on the returned object and nowhere else.
     *
     * @throws RandomException
     */
    public function start(
        ?string $ipHash = null,
        ?string $userAgentHash = null,
        ?string $preferredLanguageCode = null,
        ?string $countryCode = null,
    ): StartedGuestSession {
        $token = $this->tokens->mint();
        $accountExpiresAt = $this->windows->accountExpiresAt();
        $sessionExpiresAt = $this->windows->sessionExpiresAt();

        /** @var array{account: CustomerAccount, session: GuestSession} $created */
        $created = DB::transaction(function () use ($token, $ipHash, $userAgentHash, $preferredLanguageCode, $countryCode, $accountExpiresAt, $sessionExpiresAt): array {
            $account = CustomerAccount::query()->create([
                'account_number' => $this->numbers->next(),
                'account_type' => CustomerAccountType::Guest,
                'user_id' => null,
                'organisation_id' => null,
                'status' => CustomerAccountStatus::Provisional,
                'origin' => CustomerAccountOrigin::Guest,
                'display_name' => null,
                'preferred_language_code' => $preferredLanguageCode,
                'country_code' => $countryCode,
                // Only the guest window is stamped. `provisional_expires_at`
                // stays null so the abandonment sweep, which is keyed on a
                // different setting for a different reason, does not adopt a
                // guest; `ExpireGuestData` owns this row until it converts.
                'guest_expires_at' => $accountExpiresAt,
                'last_activity_at' => now(),
            ]);

            $session = GuestSession::query()->create([
                'customer_account_id' => $account->getKey(),
                'token_hash' => $this->tokens->hash($token),
                'grade' => GuestSessionGrade::CheckoutDraft,
                'expires_at' => $sessionExpiresAt,
                'last_used_at' => now(),
                'ip_hash' => $ipHash,
                'user_agent_hash' => $userAgentHash,
            ]);

            return ['account' => $account, 'session' => $session];
        });

        // No actor: that is the whole point of a guest. The subject is the
        // session, so a later investigation can follow one token through its
        // life without an identity ever existing.
        $this->audit->record(
            'guest.session_started',
            subjectType: 'guest_session',
            subjectId: (string) $created['session']->getKey(),
            metadata: [
                'customer_account_id' => (string) $created['account']->getKey(),
                'grade' => GuestSessionGrade::CheckoutDraft->value,
                'account_window_days' => $this->windows->accountDays(),
            ],
        );

        return new StartedGuestSession(
            account: $created['account'],
            session: $created['session'],
            token: $token,
            grade: GuestSessionGrade::CheckoutDraft,
            expiresAt: $sessionExpiresAt,
            accountExpiresAt: $accountExpiresAt,
        );
    }

    /**
     * The live session a token names, or null.
     *
     * **Null covers four different failures on purpose**: no such token, a
     * revoked one, an expired one, and one whose account has since been closed
     * or purged. A caller that could tell them apart would be telling an
     * anonymous requester which of their guesses had once been real.
     *
     * The lookup is by digest — a unique index, so the comparison happens once
     * inside PostgreSQL rather than over a scan — and `matches()` re-checks in
     * constant time afterwards. The second check is redundant against a correct
     * index and is kept because the cost is a microsecond and the failure it
     * guards (a digest collision, a future change to a non-unique lookup) is
     * silent authentication of the wrong session.
     *
     * `last_used_at` moves on every successful resolve, which is what lets the
     * expiry sweep tell an abandoned basket from an active one.
     */
    public function resolve(string $token): ?GuestSession
    {
        if ($token === '') {
            return null;
        }

        $session = GuestSession::query()
            ->where('token_hash', $this->tokens->hash($token))
            ->first();

        if (! $session instanceof GuestSession) {
            return null;
        }

        if (! $this->tokens->matches($token, $session->token_hash) || ! $session->isLive()) {
            return null;
        }

        $account = $session->customerAccount()->first();

        if (! $account instanceof CustomerAccount || $account->status === CustomerAccountStatus::Closed) {
            return null;
        }

        $session->forceFill(['last_used_at' => now()])->save();

        return $session;
    }

    /**
     * Refuse unless this session may do the thing.
     *
     * The one authorisation check the guest journey has. Callers ask for the
     * grade they need rather than reading `$session->grade` themselves, so a
     * new grade later is a compile-time conversation with every call site.
     *
     * @throws GuestSessionRejected
     */
    public function require(GuestSession $session, GuestSessionGrade $required): GuestSession
    {
        if (! $session->isLive()) {
            throw GuestSessionRejected::notLive();
        }

        if (! $session->grade->permits($required)) {
            throw GuestSessionRejected::insufficientGrade($session->grade, $required);
        }

        return $session;
    }

    /**
     * Send this guest a passcode for a destination they have supplied.
     *
     * The contact point is written against the *account*, not against a user —
     * `contact_points` takes an explicit owner pair and the guest half is the
     * customer account — and it is left unverified. See the class comment for
     * why the proof lands on the session instead.
     *
     * @throws GuestSessionRejected
     * @throws InvalidContactValue
     * @throws OtpIssueRefused
     * @throws ChannelUnavailable
     */
    public function requestContactVerification(
        GuestSession $session,
        ContactChannel $channel,
        string $value,
        ?OtpChannel $deliveryChannel = null,
        ?string $locale = null,
        ?string $requestIpHash = null,
    ): GuestContactChallenge {
        $this->require($session, GuestSessionGrade::CheckoutDraft);

        $contact = $this->contacts->rememberForCustomerAccount(
            customerAccountId: $session->customer_account_id,
            channel: $channel,
            value: $value,
            isPrimary: true,
            source: 'self_service',
        );

        $result = $this->otp->issue(
            contact: $contact,
            purpose: OtpPurpose::GuestOrder,
            channel: $deliveryChannel,
            locale: $locale,
            requestIpHash: $requestIpHash,
        );

        $this->audit->record(
            'guest.contact_verification_requested',
            subjectType: 'guest_session',
            subjectId: (string) $session->getKey(),
            metadata: [
                'customer_account_id' => $session->customer_account_id,
                'contact_point_id' => (string) $contact->getKey(),
                'contact_channel' => $channel->value,
                'delivery_channel' => $result->challenge->channel->value,
            ],
        );

        return new GuestContactChallenge($session, $result);
    }

    /**
     * Check a passcode and, if it holds, promote the session.
     *
     * The verification result is returned rather than swallowed: a wrong code is
     * an ordinary event with attempts remaining that a screen has to show, and
     * collapsing it into a boolean would lose that. The promotion is the side
     * effect of a success, and it is idempotent — a replayed callback finds the
     * challenge already `verified` and `OtpService` refuses it.
     *
     * @throws GuestSessionRejected
     * @throws OtpIssueRefused when the contact is locked out
     */
    public function confirmContactVerification(GuestSession $session, OtpChallenge $challenge, string $code): OtpVerificationResult
    {
        $this->require($session, GuestSessionGrade::CheckoutDraft);

        if ($challenge->customer_account_id !== $session->customer_account_id || $challenge->purpose !== OtpPurpose::GuestOrder) {
            // Not a domain refusal with a reason of its own: a challenge that
            // belongs to another account is indistinguishable, from here, from
            // one that does not exist, and saying which would be an oracle.
            throw GuestSessionRejected::contactNotVerified();
        }

        $result = $this->otp->verify($challenge, $code);

        if ($result->verified) {
            $this->promote($session, $challenge->contact_point_id);
        }

        return $result;
    }

    /**
     * Raise a session to `place_order` on the strength of a proven contact.
     *
     * Separated from the verification path so the integrator has a seam for the
     * cases that do not go through an OTP screen — an operator confirming a
     * destination by phone, a channel that proves itself out of band. It still
     * writes `contact_verified_at`, because the CHECK constraint will not accept
     * the grade without it.
     */
    public function promote(GuestSession $session, ?string $contactPointId = null): GuestSession
    {
        if ($session->grade === GuestSessionGrade::PlaceOrder) {
            return $session;
        }

        $session->forceFill([
            'grade' => GuestSessionGrade::PlaceOrder,
            'contact_verified_at' => $session->contact_verified_at ?? now(),
        ])->save();

        $this->audit->record(
            'guest.session_upgraded',
            subjectType: 'guest_session',
            subjectId: (string) $session->getKey(),
            metadata: [
                'customer_account_id' => $session->customer_account_id,
                'grade' => GuestSessionGrade::PlaceOrder->value,
                'contact_point_id' => $contactPointId,
            ],
        );

        return $session;
    }

    /**
     * Withdraw one token.
     *
     * A tombstone rather than a delete: for the day the row survives, "revoked"
     * and "lapsed" are different answers to an abuse report, and
     * `PurgeExpiredGuestSessions` removes it afterwards.
     */
    public function revoke(GuestSession $session, string $reason): GuestSession
    {
        if ($session->isRevoked()) {
            return $session;
        }

        $session->forceFill(['revoked_at' => now()])->save();

        $this->audit->record(
            'guest.session_revoked',
            subjectType: 'guest_session',
            subjectId: (string) $session->getKey(),
            metadata: [
                'customer_account_id' => $session->customer_account_id,
                'reason' => $reason,
            ],
        );

        return $session;
    }

    /**
     * Withdraw every token an account holds. Conversion and deletion both do
     * this, for opposite reasons and with the same effect: whatever the browser
     * is still holding stops working.
     *
     * @return int how many were revoked
     */
    public function revokeAllFor(CustomerAccount $account, string $reason): int
    {
        $revoked = GuestSession::query()
            ->where('customer_account_id', $account->getKey())
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now(), 'updated_at' => now()]);

        if ($revoked > 0) {
            $this->audit->record(
                'guest.session_revoked',
                subjectType: 'customer_account',
                subjectId: (string) $account->getKey(),
                metadata: ['sessions_revoked' => $revoked, 'reason' => $reason],
            );
        }

        return $revoked;
    }

    /**
     * A guest becomes a registered customer.
     *
     * **Origin does not change, and that is the interesting part.** The account
     * becomes `b2c` — it now has a user, which is the definition — but
     * `origin` stays `guest`, because origin is history and this account did
     * come from a guest checkout. Analytics that asks "how many customers
     * arrived through the guest door" is asking about origin, and a conversion
     * that rewrote it would answer zero forever.
     *
     * **Contacts are re-parented through the registry rather than by UPDATE.**
     * `contact_points` enforces exactly one owner, so a re-parent is two column
     * writes that must not be observed apart; more importantly the destination
     * has to converge on any row the *user* already holds — somebody
     * registering with the address they ordered under must end up with one
     * contact, not two. `rememberForUser()` already does exactly that, so the
     * account-owned row is retired behind it (D-042 tombstone) and the user's
     * row is the survivor.
     *
     * **Sessions are revoked.** The person is authenticated now; a bearer token
     * that still spoke for their account would be a second, weaker credential
     * for the same data, sitting in a browser they may have walked away from.
     *
     * Fortify wiring is **not** here. Binding this to the registration flow is
     * the integrator's, because the guest token arrives as a request concern and
     * this module does not read requests.
     *
     * @throws GuestConversionRejected
     */
    public function convert(CustomerAccount $account, User $user): CustomerAccount
    {
        if ($account->account_type !== CustomerAccountType::Guest) {
            throw GuestConversionRejected::notGuest();
        }

        if ($account->status === CustomerAccountStatus::Closed) {
            throw GuestConversionRejected::accountClosed();
        }

        $collision = CustomerAccount::query()
            ->where('user_id', $user->getKey())
            ->where('account_type', CustomerAccountType::B2c)
            ->exists();

        if ($collision) {
            throw GuestConversionRejected::userAlreadyHasAccount();
        }

        $converted = DB::transaction(function () use ($account, $user): CustomerAccount {
            $reparented = 0;

            /** @var iterable<ContactPoint> $owned */
            $owned = ContactPoint::query()
                ->where('customer_account_id', $account->getKey())
                ->whereNull('retired_at')
                ->get();

            foreach ($owned as $contact) {
                $this->contacts->rememberForUser(
                    user: $user,
                    channel: $contact->channel,
                    value: $contact->value_normalised,
                    source: 'self_service',
                );

                $this->contacts->retire($contact);
                $reparented++;
            }

            $account->forceFill([
                'account_type' => CustomerAccountType::B2c,
                'user_id' => $user->getKey(),
                'converted_at' => now(),
                // Nulled in the same UPDATE as the type flip, because
                // `customer_accounts_guest_expires_at_check` refuses the pair
                // otherwise — which is the constraint doing its job.
                'guest_expires_at' => null,
                // From here on this is an ordinary self-service account and the
                // abandonment sweep is the right owner of its deadline.
                'provisional_expires_at' => $account->provisional_expires_at
                    ?? now()->addDays(max(1, (int) config('verification.provisional_account_ttl_days', 30))),
                'last_activity_at' => now(),
                'updated_by' => $user->getKey(),
            ])->save();

            $this->audit->record(
                'guest.converted',
                actorUserId: (string) $user->getKey(),
                subjectType: 'customer_account',
                subjectId: (string) $account->getKey(),
                metadata: [
                    'account_type' => CustomerAccountType::B2c->value,
                    'origin' => $account->origin->value,
                    'contacts_reparented' => $reparented,
                ],
            );

            return $account;
        });

        $this->revokeAllFor($converted, 'converted');

        return $converted;
    }
}
