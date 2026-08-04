<?php

declare(strict_types=1);

namespace Healthy360\Payments\Services;

use Healthy360\B2b\Contracts\InvoicingSettlementLookup;
use Healthy360\B2b\Services\SettlementCheck;
use Healthy360\Payments\Enums\PaymentIntentStatus;
use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Payments\Models\PaymentIntent;

/**
 * Foundation settlement answers from payment intents — softer than invoicing_module_absent.
 */
final readonly class PaymentsInvoicingSettlementLookup implements InvoicingSettlementLookup
{
    public const string PAYMENTS_NO_INVOICE_LEDGER = 'payments_no_invoice_ledger';

    public function isAnswerable(): bool
    {
        return true;
    }

    public function outstandingInvoices(string $organisationId): SettlementCheck
    {
        $uncaptured = PaymentIntent::query()
            ->where('organisation_id', $organisationId)
            ->where('method_kind', PaymentMethodKind::Invoice)
            ->whereIn('status', [PaymentIntentStatus::Pending, PaymentIntentStatus::Authorized])
            ->count();

        if ($uncaptured > 0) {
            return SettlementCheck::outstanding(
                'outstanding_invoices',
                $uncaptured.' invoice payment intent(s) are not yet captured.',
            );
        }

        return SettlementCheck::clear('outstanding_invoices', 'No uncaptured invoice payment intents.');
    }

    public function creditBalance(string $organisationId): SettlementCheck
    {
        return SettlementCheck::notApplicable(
            'credit_balance',
            self::PAYMENTS_NO_INVOICE_LEDGER,
            'Payments tracks intents, not drawn credit against agreement limits.',
        );
    }

    public function securityDeposit(string $organisationId): SettlementCheck
    {
        return SettlementCheck::clear('security_deposit', 'No deposit is held by the payments module.');
    }
}
