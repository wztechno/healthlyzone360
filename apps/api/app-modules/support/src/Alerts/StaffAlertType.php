<?php

declare(strict_types=1);

namespace Healthy360\Support\Alerts;

/**
 * What the kitchen's staff can be alerted about. The value is what
 * `staff_notifications.type` stores and what `notices.staff_alert.*` is keyed
 * by. An escalation is an order nobody has acted on, so it alone also goes by SMS.
 */
enum StaffAlertType: string
{
    case UnacceptedManager = 'unaccepted_manager';
    case UnacceptedOwner = 'unaccepted_owner';
    case AllergyOrder = 'allergy_order';
    case LateCancel = 'late_cancel';
    case DeliveryFailed = 'delivery_failed';
    case NoCashCollected = 'no_cash_collected';
    case RefundApproval = 'refund_approval';
    case StockExpiring = 'stock_expiring';

    /**
     * @return 'managers'|'owners'
     */
    public function audience(): string
    {
        return match ($this) {
            self::UnacceptedOwner, self::LateCancel, self::RefundApproval => 'owners',
            self::UnacceptedManager, self::AllergyOrder, self::DeliveryFailed, self::NoCashCollected, self::StockExpiring => 'managers',
        };
    }

    public function isEscalation(): bool
    {
        return $this === self::UnacceptedManager || $this === self::UnacceptedOwner;
    }

    /**
     * Whether a second alert about the same order is news rather than a repeat. A
     * re-delivered order can fail again, and managers must hear that as they did
     * the first time. A second refund on one order needs its own approval.
     */
    public function repeats(): bool
    {
        return $this === self::DeliveryFailed || $this === self::RefundApproval;
    }

    /**
     * What the alert is about: an order, unless it says otherwise.
     */
    public function subjectType(): string
    {
        return match ($this) {
            self::StockExpiring => 'stock',
            default => 'order',
        };
    }

    /**
     * The page the alert's link opens.
     */
    public function page(string $subjectId): string
    {
        return match ($this) {
            self::StockExpiring => '/kitchen/stock',
            default => '/kitchen/orders?view='.$subjectId,
        };
    }
}
