<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Contracts\InvoicingSettlementLookup;

/**
 * Default until Payments binds a real lookup.
 */
final readonly class NoInvoicingSettlementLookup implements InvoicingSettlementLookup
{
    public function isAnswerable(): bool
    {
        return false;
    }

    public function outstandingInvoices(string $organisationId): SettlementCheck
    {
        return SettlementCheck::notApplicable(
            'outstanding_invoices',
            SettlementRegistry::INVOICING_ABSENT,
            'No invoicing module exists, so no invoice was checked. This is a gap, not a pass.',
        );
    }

    public function creditBalance(string $organisationId): SettlementCheck
    {
        return SettlementCheck::notApplicable(
            'credit_balance',
            SettlementRegistry::INVOICING_ABSENT,
            'Agreement credit limits are terms, not a ledger. Nothing tracks drawn credit yet.',
        );
    }

    public function securityDeposit(string $organisationId): SettlementCheck
    {
        return SettlementCheck::notApplicable(
            'security_deposit',
            SettlementRegistry::INVOICING_ABSENT,
            'No deposit is held by any module the platform has built.',
        );
    }
}
