<?php

declare(strict_types=1);

namespace Healthy360\B2b\Contracts;

use Healthy360\B2b\Services\SettlementCheck;

/**
 * Settlement checks that Payments can answer once PAY1 lands.
 */
interface InvoicingSettlementLookup
{
    public function isAnswerable(): bool;

    public function outstandingInvoices(string $organisationId): SettlementCheck;

    public function creditBalance(string $organisationId): SettlementCheck;

    public function securityDeposit(string $organisationId): SettlementCheck;
}
