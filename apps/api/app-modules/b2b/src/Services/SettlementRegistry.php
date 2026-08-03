<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Contracts\SellerOpenOrders;
use Healthy360\Organisations\Models\Organisation;

/**
 * What has to be true about money before a corporate relationship can end.
 *
 * **The class the reviewer's point 13 is about.** An offboarding flow written
 * before invoicing exists ships a settlement check that is permanently green
 * and quietly stops being true the day PAY1 lands. The answer is not to defer
 * the flow and not to fake the check: it is to make the check say what it
 * actually did.
 *
 * Four checks run, and today exactly one of them can answer:
 *
 * | check | today | when it becomes real |
 * |---|---|---|
 * | `open_orders` | real, via the `SellerOpenOrders` port | already, once orders binds it |
 * | `outstanding_invoices` | `not_applicable` / `invoicing_module_absent` | PAY1 |
 * | `credit_balance` | `not_applicable` / `invoicing_module_absent` | PAY1 |
 * | `security_deposit` | `not_applicable` / `invoicing_module_absent` | PAY1 |
 *
 * The three placeholders are listed rather than omitted on purpose. A
 * settlement summary containing one line reads as a complete check of one
 * thing; a summary containing four, three of which name the module that would
 * have answered them, reads as what it is. When PAY1 lands, the work is to
 * replace three method bodies whose call sites, vocabulary and storage already
 * exist — and the day it lands, every historical offboarding still says
 * truthfully that its invoices were never checked.
 *
 * **`open_orders` is real but conditionally answerable.** If nothing has bound
 * `SellerOpenOrders`, the null default says so and this reports
 * `not_applicable` with `orders_module_absent` rather than `clear`. A port
 * whose absence looks like a pass is the failure mode the whole design is
 * avoiding, and it would be absurd to avoid it for invoices and then walk into
 * it for orders.
 */
final readonly class SettlementRegistry
{
    /** The reason string every PAY1-gated check carries until PAY1 lands. */
    public const string INVOICING_ABSENT = 'invoicing_module_absent';

    /** The reason `open_orders` carries when nothing has bound the port. */
    public const string ORDERS_ABSENT = 'orders_module_absent';

    public function __construct(private SellerOpenOrders $orders) {}

    public function assess(Organisation $organisation): SettlementAssessment
    {
        $organisationId = (string) $organisation->getKey();

        return new SettlementAssessment([
            $this->openOrders($organisationId),
            $this->outstandingInvoices(),
            $this->creditBalance(),
            $this->securityDeposit(),
        ]);
    }

    /**
     * The one check with something behind it.
     *
     * The summaries are counted rather than listed into `$detail`: a settlement
     * record stored on the offboarding row is read by more people than an
     * order is, and "3 orders are still in flight" is what a person needs to
     * decide whether to wait or to waive. The orders themselves are available
     * to a caller that holds the port and has a reason.
     */
    private function openOrders(string $organisationId): SettlementCheck
    {
        if (! $this->orders->isAnswerable()) {
            return SettlementCheck::notApplicable(
                'open_orders',
                self::ORDERS_ABSENT,
                'No module answered for this organisation\'s orders, so none were checked.',
            );
        }

        $open = $this->orders->openOrderSummaries($organisationId);

        if ($open === []) {
            return SettlementCheck::clear('open_orders', 'No order is in flight.');
        }

        return SettlementCheck::outstanding(
            'open_orders',
            count($open).' order(s) are neither delivered nor cancelled.',
        );
    }

    /**
     * PAY1. Until then this says so, and says it in a machine-readable way.
     */
    private function outstandingInvoices(): SettlementCheck
    {
        return SettlementCheck::notApplicable(
            'outstanding_invoices',
            self::INVOICING_ABSENT,
            'No invoicing module exists, so no invoice was checked. This is a gap, not a pass.',
        );
    }

    private function creditBalance(): SettlementCheck
    {
        return SettlementCheck::notApplicable(
            'credit_balance',
            self::INVOICING_ABSENT,
            'Agreement credit limits are terms, not a ledger. Nothing tracks drawn credit yet.',
        );
    }

    private function securityDeposit(): SettlementCheck
    {
        return SettlementCheck::notApplicable(
            'security_deposit',
            self::INVOICING_ABSENT,
            'No deposit is held by any module the platform has built.',
        );
    }
}
