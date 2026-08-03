<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use App\Models\User;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Exceptions\InvalidContactValue;
use Healthy360\Identity\Models\ContactPoint;
use Illuminate\Support\Facades\DB;

/**
 * The single write path for contact points.
 *
 * Everything that creates, verifies or retires a destination goes through
 * here, which is what makes the invariants in the migration true in practice
 * rather than merely enforced after the fact: values are normalised exactly
 * once, the hash is derived from the normalised form and never from the raw
 * input, and "already verified by somebody else" is refused before the unique
 * index has to.
 *
 * The registry is deliberately owner-agnostic — a contact belongs to a user or
 * to a customer account, and this class takes whichever it is given as an
 * explicit pair rather than reaching for an ambient context. J1's guest work
 * (G1) writes account-owned contacts through the same methods.
 */
final class ContactPointRegistry
{
    public function __construct(
        private readonly ContactValueNormaliser $normaliser,
        private readonly ContactValueHasher $hasher,
    ) {}

    /**
     * Record a destination for a user, converging on the row that already
     * exists.
     *
     * Idempotent by (owner, channel, value): a person adding the same number
     * twice has one contact, not two, and a retried registration cannot
     * duplicate the login mirror.
     *
     * @throws InvalidContactValue
     */
    public function rememberForUser(
        User $user,
        ContactChannel $channel,
        string $value,
        bool $isLoginIdentity = false,
        bool $isPrimary = false,
        string $source = 'self_service',
        ?string $label = null,
    ): ContactPoint {
        return $this->remember(
            ownerColumn: 'user_id',
            ownerId: (string) $user->getKey(),
            channel: $channel,
            value: $value,
            isLoginIdentity: $isLoginIdentity,
            isPrimary: $isPrimary,
            source: $source,
            label: $label,
            createdBy: (string) $user->getKey(),
        );
    }

    /**
     * The same, for a contact owned by a customer account (a guest, or a
     * delivery number that belongs to the account rather than to a person).
     *
     * @throws InvalidContactValue
     */
    public function rememberForCustomerAccount(
        string $customerAccountId,
        ContactChannel $channel,
        string $value,
        bool $isPrimary = false,
        string $source = 'self_service',
        ?string $label = null,
        ?string $createdBy = null,
    ): ContactPoint {
        return $this->remember(
            ownerColumn: 'customer_account_id',
            ownerId: $customerAccountId,
            channel: $channel,
            value: $value,
            isLoginIdentity: false,
            isPrimary: $isPrimary,
            source: $source,
            label: $label,
            createdBy: $createdBy,
        );
    }

    /**
     * The same, for a destination named on a B2B application before any
     * account exists — a signatory's address, a billing contact's number.
     *
     * The application is the owner because at this point nothing else is: the
     * applicant has a user, but the signatory they have named may have no
     * relationship with the platform at all. Recording the destination here
     * rather than as a loose column on the application means it is normalised,
     * hashed and retirable like every other contact, and that the duplicate
     * rules apply to it — a signatory address already proven by somebody else
     * is refused before an application can be built on it.
     *
     * @throws InvalidContactValue
     */
    public function rememberForApplication(
        string $applicationId,
        ContactChannel $channel,
        string $value,
        bool $isPrimary = false,
        string $source = 'self_service',
        ?string $label = null,
        ?string $createdBy = null,
    ): ContactPoint {
        return $this->remember(
            ownerColumn: 'b2b_application_id',
            ownerId: $applicationId,
            channel: $channel,
            value: $value,
            isLoginIdentity: false,
            isPrimary: $isPrimary,
            source: $source,
            label: $label,
            createdBy: $createdBy,
        );
    }

    /**
     * Mark a destination proven.
     *
     * The duplicate check happens here rather than only at insert time,
     * because the window that matters is between claiming a value and proving
     * it: two people may both hold an unverified row for one address, and the
     * first to verify takes it. Re-verifying an already-verified contact is a
     * no-op so a replayed callback cannot move the timestamp.
     *
     * @throws InvalidContactValue
     */
    public function markVerified(ContactPoint $contact): ContactPoint
    {
        if ($contact->retired_at !== null) {
            throw InvalidContactValue::retired();
        }

        if ($contact->verified_at !== null) {
            return $contact;
        }

        if ($this->verifiedElsewhere($contact)) {
            throw InvalidContactValue::alreadyVerifiedElsewhere();
        }

        $contact->forceFill(['verified_at' => now()])->save();

        return $contact;
    }

    /**
     * Withdraw a destination without erasing that it existed (D-042).
     *
     * Retiring rather than deleting is what lets the value be claimed again by
     * somebody else — the partial unique index excludes retired rows — while
     * keeping the history of who held it, which a closure or abuse
     * investigation needs.
     */
    public function retire(ContactPoint $contact): ContactPoint
    {
        if ($contact->retired_at !== null) {
            return $contact;
        }

        $contact->forceFill([
            'retired_at' => now(),
            'is_primary' => false,
        ])->save();

        return $contact;
    }

    /**
     * The verified, unretired contact holding this value on this channel, if
     * any.
     *
     * The lookup an enumeration-resistant surface uses: it answers a question
     * the *server* needs (may this value be claimed) and is never surfaced as
     * "this address is registered".
     *
     * @throws InvalidContactValue
     */
    public function verifiedHolderOf(ContactChannel $channel, string $value): ?ContactPoint
    {
        $hash = $this->hasher->hash($this->normaliser->normalise($channel, $value));

        return ContactPoint::query()
            ->where('channel', $channel)
            ->where('value_hash', $hash)
            ->whereNotNull('verified_at')
            ->whereNull('retired_at')
            ->first();
    }

    /**
     * A user's destinations on a channel, newest last, retired ones excluded.
     *
     * @return list<ContactPoint>
     */
    public function forUser(User $user, ?ContactChannel $channel = null): array
    {
        $contacts = [];

        $rows = ContactPoint::query()
            ->where('user_id', $user->getKey())
            ->when($channel !== null, fn ($query) => $query->where('channel', $channel))
            ->whereNull('retired_at')
            ->orderBy('created_at')
            ->get();

        foreach ($rows as $contact) {
            $contacts[] = $contact;
        }

        return $contacts;
    }

    /**
     * @throws InvalidContactValue
     */
    private function remember(
        string $ownerColumn,
        string $ownerId,
        ContactChannel $channel,
        string $value,
        bool $isLoginIdentity,
        bool $isPrimary,
        string $source,
        ?string $label,
        ?string $createdBy,
    ): ContactPoint {
        $normalised = $this->normaliser->normalise($channel, $value);
        $hash = $this->hasher->hash($normalised);

        return DB::transaction(function () use (
            $ownerColumn,
            $ownerId,
            $channel,
            $normalised,
            $hash,
            $isLoginIdentity,
            $isPrimary,
            $source,
            $label,
            $createdBy,
        ): ContactPoint {
            $existing = ContactPoint::query()
                ->where($ownerColumn, $ownerId)
                ->where('channel', $channel)
                ->where('value_hash', $hash)
                ->whereNull('retired_at')
                ->lockForUpdate()
                ->first();

            if ($existing instanceof ContactPoint) {
                if ($isPrimary && ! $existing->is_primary) {
                    $this->demoteSiblings($ownerColumn, $ownerId, $channel);
                    $existing->forceFill(['is_primary' => true])->save();
                }

                return $existing;
            }

            // Refused before the index has to refuse it, so the caller gets a
            // domain reason rather than a constraint-violation exception.
            $heldElsewhere = ContactPoint::query()
                ->where('channel', $channel)
                ->where('value_hash', $hash)
                ->whereNotNull('verified_at')
                ->whereNull('retired_at')
                ->where($ownerColumn, '!=', $ownerId)
                ->exists();

            if ($heldElsewhere) {
                throw InvalidContactValue::alreadyVerifiedElsewhere();
            }

            if ($isPrimary) {
                $this->demoteSiblings($ownerColumn, $ownerId, $channel);
            }

            return ContactPoint::query()->create([
                $ownerColumn => $ownerId,
                'channel' => $channel,
                'value_normalised' => $normalised,
                'value_hash' => $hash,
                'label' => $label,
                'is_login_identity' => $isLoginIdentity,
                'is_primary' => $isPrimary,
                'source' => $source,
                'created_by' => $createdBy,
            ]);
        });
    }

    private function demoteSiblings(string $ownerColumn, string $ownerId, ContactChannel $channel): void
    {
        ContactPoint::query()
            ->where($ownerColumn, $ownerId)
            ->where('channel', $channel)
            ->where('is_primary', true)
            ->update(['is_primary' => false, 'updated_at' => now()]);
    }

    private function verifiedElsewhere(ContactPoint $contact): bool
    {
        return ContactPoint::query()
            ->where('channel', $contact->channel)
            ->where('value_hash', $contact->value_hash)
            ->whereNotNull('verified_at')
            ->whereNull('retired_at')
            ->whereKeyNot($contact->getKey())
            ->exists();
    }
}
