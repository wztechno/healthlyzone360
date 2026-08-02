<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Results;

/**
 * What a purge actually did — counts only, never identities.
 *
 * The same discipline `PurgeAbandonedProvisionalAccounts` applies to its log
 * line: an erasure that records which addresses it erased has reconstructed in
 * one place exactly what it removed from another. Counts answer every question
 * an operator or an auditor legitimately has ("did it run, did it find
 * anything") and none of the ones they do not.
 *
 * `$ordersRetained` is the honest half. Guest orders are commercial and tax
 * records and are deliberately *not* deleted here; saying so in the report is
 * what stops "purged" being read as "everything is gone".
 */
final readonly class GuestPurgeReport
{
    public function __construct(
        public int $contactsDeleted,
        public int $addressesDeleted,
        public int $challengesDeleted,
        public int $sessionsDeleted,
        public int $suppressionsWritten,
        public bool $accountAnonymised,
        public int $ordersRetained = 0,
    ) {}

    /**
     * @return array<string, int|bool>
     */
    public function toArray(): array
    {
        return [
            'contacts_deleted' => $this->contactsDeleted,
            'addresses_deleted' => $this->addressesDeleted,
            'challenges_deleted' => $this->challengesDeleted,
            'sessions_deleted' => $this->sessionsDeleted,
            'suppressions_written' => $this->suppressionsWritten,
            'account_anonymised' => $this->accountAnonymised,
            'orders_retained' => $this->ordersRetained,
        ];
    }
}
