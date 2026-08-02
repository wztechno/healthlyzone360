<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Guest\Results\GuestDeletionAcknowledgement;
use Healthy360\Customers\Guest\Results\GuestDeletionOutcome;
use Healthy360\Customers\Guest\Results\GuestPurgeReport;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerAddress;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactValueHasher;
use Healthy360\Identity\Services\ContactValueNormaliser;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Exceptions\ChannelUnavailable;
use Healthy360\Verification\Exceptions\OtpIssueRefused;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Services\OtpService;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * "Delete everything you hold about this address."
 *
 * ## Why this surface is shaped the way it is
 *
 * A guest erasure request is **unauthenticated by construction**. The whole
 * premise of a guest is that there is no account to log into, so the request
 * arrives as a bare email address or phone number from somebody we cannot
 * identify. That gives the endpoint two properties it must have simultaneously,
 * and they pull against each other:
 *
 *  * **It must not become an enumeration oracle.** If the answer differs at all
 *    between an address we hold and one we do not, the endpoint is a free
 *    "does this person order from you" lookup for anybody with a word list.
 *  * **It must not become a deletion weapon.** If the request alone erased
 *    anything, typing a stranger's address would destroy their order history.
 *
 * The resolution is the same one every serious implementation reaches: **always
 * accept, never confirm, and require proof before acting.** `request()` returns
 * a `GuestDeletionAcknowledgement` built entirely from the *submitted* value and
 * from configuration — no field is read from the database, so the object is
 * byte-identical whether or not anything was found. Behind it, a passcode is
 * issued only if there really is something to delete. `confirm()` then has
 * exactly one failure shape, so a code entered against an unknown address, a
 * wrong code, an expired challenge and a locked-out contact are indistinguishable
 * from outside.
 *
 * The residual leak is timing — a real request also issues and queues a message
 * — and it is stated rather than papered over. Closing it properly means a
 * constant-time budget on the whole handler, which is an HTTP-layer concern and
 * is left as a seam for the integrator rather than faked here with a `usleep`.
 *
 * ## What a purge does and does not touch
 *
 * It deletes what identifies a person: contact points, addresses, the dietary
 * cluster (special-category data, and the most important thing in this list),
 * every passcode challenge, and every session token. It then anonymises the
 * account row rather than deleting it, because the row is the join target for
 * records that must survive — and it writes a **suppression hash** for each
 * destination, which is the one thing an erasure is allowed to leave behind:
 * without it the next import silently re-adds the person who asked to be
 * forgotten.
 *
 * **Orders are deliberately not touched.** A guest order is a commercial and tax
 * record with a statutory retention of its own, and the plan's position is that
 * the order keeps its area and city while the identifying columns go. That
 * redaction belongs to the orders module, which may not exist in this tree yet —
 * hence the table-existence guard and the seam below.
 */
final class GuestDeletionService
{
    public function __construct(
        private readonly ContactValueNormaliser $normaliser,
        private readonly ContactValueHasher $hasher,
        private readonly OtpService $otp,
        private readonly MarketingSuppressionRegistry $suppressions,
        private readonly GuestSessionService $sessions,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * Ask for a guest's data to be erased.
     *
     * Always succeeds, in the sense that the answer is always the same. The
     * lookup happens, a passcode goes out if there is something to prove, and
     * none of that is visible in the return value.
     *
     * @throws InvalidContactValue when the submitted value is not a valid
     *                             address or number at all — a syntax refusal,
     *                             which discloses nothing about who we hold
     */
    public function request(
        ContactChannel $channel,
        string $value,
        ?OtpChannel $deliveryChannel = null,
        ?string $locale = null,
        ?string $requestIpHash = null,
    ): GuestDeletionAcknowledgement {
        $normalised = $this->normaliser->normalise($channel, $value);
        $contact = $this->guestContactFor($channel, $normalised);

        if ($contact instanceof ContactPoint) {
            $this->issueQuietly($contact, $deliveryChannel, $locale, $requestIpHash);
        }

        // Audited on the hash, never the value, and with no field saying
        // whether anything was found — an audit trail that recorded the hit
        // rate would reconstruct the oracle in a table somebody can query.
        $this->audit->record(
            'guest.deletion_requested',
            subjectType: 'contact_point',
            subjectId: null,
            metadata: [
                'contact_channel' => $channel->value,
                'contact_digest' => $this->hasher->hash($normalised),
            ],
        );

        return new GuestDeletionAcknowledgement(
            // Masked from what the caller just typed, so the echo needs no
            // lookup and therefore cannot depend on one.
            destinationMasked: $this->normaliser->mask($channel, $normalised),
            verificationRequired: (bool) config('guest.deletion.require_verification', true),
            expiresInSeconds: max(30, (int) config('verification.otp.expires_after_seconds', 300)),
        );
    }

    /**
     * Prove the request and carry it out.
     *
     * Everything that is not a successful purge returns `refused()`. See
     * `GuestDeletionOutcome` for the list of things that covers and why they are
     * not distinguished.
     *
     * @throws InvalidContactValue when the submitted value is malformed
     */
    public function confirm(ContactChannel $channel, string $value, string $code): GuestDeletionOutcome
    {
        $normalised = $this->normaliser->normalise($channel, $value);
        $contact = $this->guestContactFor($channel, $normalised);

        if (! $contact instanceof ContactPoint) {
            return GuestDeletionOutcome::refused();
        }

        $challenge = $this->otp->liveChallengeFor($contact, OtpPurpose::GuestDeletion);

        if (! $challenge instanceof OtpChallenge) {
            return GuestDeletionOutcome::refused();
        }

        try {
            $result = $this->otp->verify($challenge, $code);
        } catch (OtpIssueRefused) {
            // Locked out. Collapsed into the ordinary refusal on purpose: a
            // distinct answer here would only ever be produced by a contact
            // point that exists.
            return GuestDeletionOutcome::refused();
        }

        if (! $result->verified) {
            return GuestDeletionOutcome::refused();
        }

        $account = CustomerAccount::query()->whereKey($contact->customer_account_id)->first();

        if (! $account instanceof CustomerAccount) {
            return GuestDeletionOutcome::refused();
        }

        $this->audit->record(
            'guest.deletion_verified',
            subjectType: 'customer_account',
            subjectId: (string) $account->getKey(),
            metadata: ['contact_channel' => $channel->value],
        );

        return GuestDeletionOutcome::purged($this->purge($account));
    }

    /**
     * Erase a guest account's personal data.
     *
     * Public because two callers need it and only one of them is a request:
     * `confirm()` above, and `ExpireGuestData` when a guest's retention window
     * runs out. The suppression source differs between them — an expiry is not
     * somebody asking to be forgotten — which is why it is a parameter.
     *
     * Order matters. Contacts go first so the cascade takes their passcode
     * challenges with them and the address's courier-number reference is nulled
     * rather than blocking; the dietary profile takes its allergen declarations
     * and food exclusions with it. The account row survives, anonymised.
     */
    public function purge(CustomerAccount $account, SuppressionSource $source = SuppressionSource::Deletion): GuestPurgeReport
    {
        /** @var Collection<int, ContactPoint> $contacts */
        $contacts = ContactPoint::query()
            ->where('customer_account_id', $account->getKey())
            ->get();

        $suppressed = 0;

        foreach ($contacts as $contact) {
            $this->suppressions->suppressContact($contact, $source);
            $suppressed++;
        }

        $challenges = OtpChallenge::query()->where('customer_account_id', $account->getKey())->count();

        $report = DB::transaction(function () use ($account, $challenges, $suppressed): GuestPurgeReport {
            OtpChallenge::query()->where('customer_account_id', $account->getKey())->delete();

            $contactsDeleted = ContactPoint::query()
                ->where('customer_account_id', $account->getKey())
                ->delete();

            $addressesDeleted = CustomerAddress::query()
                ->where('customer_account_id', $account->getKey())
                ->delete();

            // Special-category data, and the reason this method deletes more
            // than the four tables the brief names: an allergy declaration is
            // the most sensitive thing a guest ever tells us.
            CustomerDietaryProfile::query()
                ->where('customer_account_id', $account->getKey())
                ->delete();

            $sessionsDeleted = GuestSession::query()
                ->where('customer_account_id', $account->getKey())
                ->delete();

            $account->forceFill([
                'display_name' => null,
                'status' => CustomerAccountStatus::Closed,
                // Both stamped: `customer_accounts_closed_at_check` demands the
                // first for a closed row and
                // `customer_accounts_anonymised_at_check` demands it before the
                // second. Anonymised-but-not-closed is not a state the schema
                // will hold, which is the constraint saying that a row nobody
                // can identify is a row nobody may still transact on.
                'closed_at' => $account->closed_at ?? now(),
                'anonymised_at' => now(),
                'guest_expires_at' => null,
                'last_activity_at' => now(),
            ])->save();

            return new GuestPurgeReport(
                contactsDeleted: $contactsDeleted,
                addressesDeleted: $addressesDeleted,
                challengesDeleted: $challenges,
                sessionsDeleted: $sessionsDeleted,
                suppressionsWritten: $suppressed,
                accountAnonymised: true,
                ordersRetained: $this->retainedOrderCount($account),
            );
        });

        // Counts only, never identities: an erasure that logged what it erased
        // has rebuilt in the audit trail exactly what it removed from the
        // tables.
        $this->audit->record(
            'guest.purged',
            subjectType: 'customer_account',
            subjectId: (string) $account->getKey(),
            metadata: $report->toArray() + ['suppression_source' => $source->value],
        );

        return $report;
    }

    /**
     * How many order records this purge deliberately left alone.
     *
     * **Seam for the integrator (C1 / orders).** A guest order is a commercial
     * and tax record: the plan's position is that the row survives with its
     * delivery *area* and *city* — which is what tax is computed on — while the
     * columns that name a person are redacted by the module that owns them.
     * That redaction cannot live here without Customers taking a dependency on
     * Orders and inverting the module graph.
     *
     * So this counts and returns, guarded by a table-existence check because the
     * orders module may not be in the tree yet. When it is, the integrator
     * should hang a listener or a registry port off `guest.purged` — the same
     * shape `CatalogueIngredientUsageRegistry` uses for the reverse direction —
     * and this method becomes its call site.
     *
     * @todo C1/integrator: replace the count with a GuestDataPurgeParticipant
     *       port that the orders module implements, so redaction happens inside
     *       the same transaction as the rest of the purge.
     */
    private function retainedOrderCount(CustomerAccount $account): int
    {
        if (! Schema::hasTable('orders')) {
            return 0;
        }

        try {
            return DB::table('orders')->where('customer_account_id', $account->getKey())->count();
        } catch (Throwable) {
            // The table exists but does not have the column yet — a tree
            // mid-merge. A purge must not fail because a count could not be
            // taken.
            return 0;
        }
    }

    /**
     * The account-owned contact holding this value, if the account is a guest.
     *
     * Scoped to `account_type = 'guest'` on purpose: this surface erases guest
     * data. A registered customer's erasure goes through J2's closure journey,
     * which is step-up-authenticated because there is an identity to
     * authenticate — and routing it through here would let an unauthenticated
     * caller start a deletion against a real account.
     */
    private function guestContactFor(ContactChannel $channel, string $normalised): ?ContactPoint
    {
        $contact = ContactPoint::query()
            ->where('channel', $channel)
            ->where('value_hash', $this->hasher->hash($normalised))
            ->whereNull('retired_at')
            ->whereNotNull('customer_account_id')
            ->whereIn('customer_account_id', CustomerAccount::query()
                ->select('id')
                ->where('account_type', CustomerAccountType::Guest)
                ->whereNull('anonymised_at'))
            ->orderBy('created_at')
            ->first();

        return $contact instanceof ContactPoint ? $contact : null;
    }

    /**
     * Issue the proof passcode, swallowing every refusal.
     *
     * A refusal here — locked out, no real channel, a challenge already in
     * flight — must not change what `request()` returns, because every one of
     * them is a fact about a contact point that exists. The failure is
     * absorbed and the caller is told the same thing it would have been told if
     * the address had never been heard of.
     */
    private function issueQuietly(ContactPoint $contact, ?OtpChannel $deliveryChannel, ?string $locale, ?string $requestIpHash): void
    {
        try {
            $this->otp->issue(
                contact: $contact,
                purpose: OtpPurpose::GuestDeletion,
                channel: $deliveryChannel,
                locale: $locale,
                requestIpHash: $requestIpHash,
            );
        } catch (OtpIssueRefused|ChannelUnavailable) {
            // Intentionally silent. See the method comment.
        }
    }

    /**
     * Exposed so the expiry job can revoke before it purges without reaching
     * into the session service itself.
     */
    public function revokeSessions(CustomerAccount $account, string $reason): int
    {
        return $this->sessions->revokeAllFor($account, $reason);
    }
}
