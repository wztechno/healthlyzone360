<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Results;

/**
 * What a finalisation did, in counts.
 *
 * **Counts, never identities.** The same rule `GuestPurgeReport` follows and
 * for the same reason: a report that named what it erased would rebuild in the
 * audit trail exactly what it removed from the tables. Every field here is a
 * number or a boolean, and that is a property of the type rather than a habit
 * of the caller.
 *
 * **`ordersAnonymised` is nullable and the null is load-bearing.** Null means
 * no orders module was bound, so the delivery snapshots were not redacted —
 * a defect to be seen, not a zero to be skimmed past. Zero means the redaction
 * ran and there was nothing left to do, which is the ordinary result of a
 * second, idempotent finalisation.
 */
final readonly class ClosureReport
{
    public function __construct(
        public int $tokensRevoked,
        public int $devicesRevoked,
        public int $sessionsRevoked,
        public int $consentsWithdrawn,
        public int $membershipsEnded,
        public int $contactsDeleted,
        public int $addressesDeleted,
        public int $challengesDeleted,
        public int $dietaryProfilesDeleted,
        public int $suppressionsWritten,
        public int $ordersRetained,
        public ?int $ordersAnonymised,
        public bool $userAnonymised,
        public bool $accountAnonymised,
        public bool $tombstoneWritten,
    ) {}

    /**
     * A finalisation that found the work already done.
     *
     * Returned when the tombstone already exists, which is the idempotence
     * case: a queue retry, a duplicated schedule entry, or two workers reaching
     * the same due request. Everything is zero because nothing was done, and
     * the two anonymisation flags are true because it already had been.
     */
    public static function alreadyClosed(): self
    {
        return new self(
            tokensRevoked: 0,
            devicesRevoked: 0,
            sessionsRevoked: 0,
            consentsWithdrawn: 0,
            membershipsEnded: 0,
            contactsDeleted: 0,
            addressesDeleted: 0,
            challengesDeleted: 0,
            dietaryProfilesDeleted: 0,
            suppressionsWritten: 0,
            ordersRetained: 0,
            ordersAnonymised: 0,
            userAnonymised: true,
            accountAnonymised: true,
            tombstoneWritten: false,
        );
    }

    /**
     * Whether the closure completed with delivery snapshots left unredacted.
     *
     * Read by the job so the condition is logged and audited rather than
     * inferred by whoever reads the report next.
     */
    public function leftOrdersUnredacted(): bool
    {
        return $this->ordersAnonymised === null;
    }

    /**
     * @return array<string, int|bool|null>
     */
    public function toArray(): array
    {
        return [
            'tokens_revoked' => $this->tokensRevoked,
            'devices_revoked' => $this->devicesRevoked,
            'sessions_revoked' => $this->sessionsRevoked,
            'consents_withdrawn' => $this->consentsWithdrawn,
            'memberships_ended' => $this->membershipsEnded,
            'contacts_deleted' => $this->contactsDeleted,
            'addresses_deleted' => $this->addressesDeleted,
            'challenges_deleted' => $this->challengesDeleted,
            'dietary_profiles_deleted' => $this->dietaryProfilesDeleted,
            'suppressions_written' => $this->suppressionsWritten,
            'orders_retained' => $this->ordersRetained,
            'orders_anonymised' => $this->ordersAnonymised,
            'user_anonymised' => $this->userAnonymised,
            'account_anonymised' => $this->accountAnonymised,
            'tombstone_written' => $this->tombstoneWritten,
        ];
    }
}
