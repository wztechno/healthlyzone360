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
    case TemperatureOutOfRange = 'temperature_out_of_range';
    case RefundApproved = 'refund_approved';
    case RefundRejected = 'refund_rejected';
    case ShortHandIn = 'short_hand_in';
    case ShortClose = 'short_close';
    case PriceApproval = 'price_approval';
    case DishBelowTarget = 'dish_below_target';
    case DeliveryMovedClosed = 'delivery_moved_closed';
    case DeliveryClosedUnmoved = 'delivery_closed_unmoved';

    /**
     * `requester` is the one person who asked, named by the caller.
     *
     * @return 'managers'|'owners'|'requester'
     */
    public function audience(): string
    {
        return match ($this) {
            self::RefundApproved, self::RefundRejected => 'requester',
            self::UnacceptedOwner, self::LateCancel, self::RefundApproval, self::PriceApproval, self::DishBelowTarget => 'owners',
            self::UnacceptedManager, self::AllergyOrder, self::DeliveryFailed, self::NoCashCollected, self::StockExpiring, self::TemperatureOutOfRange, self::ShortHandIn, self::ShortClose, self::DeliveryMovedClosed, self::DeliveryClosedUnmoved => 'managers',
        };
    }

    public function isEscalation(): bool
    {
        return $this === self::UnacceptedManager || $this === self::UnacceptedOwner;
    }

    /**
     * Whether a second alert about the same order is news rather than a repeat. A
     * re-delivered order can fail again, and managers must hear that as they did
     * the first time. A second refund on one order needs its own approval, and its
     * own answer. A dish can fall below target, recover and fall again: the job
     * that sends that alert sends it only on the fall.
     */
    public function repeats(): bool
    {
        return match ($this) {
            self::DeliveryFailed, self::RefundApproval, self::RefundApproved, self::RefundRejected, self::DishBelowTarget => true,
            default => false,
        };
    }

    /**
     * What the alert is about: an order, unless it says otherwise.
     */
    public function subjectType(): string
    {
        return match ($this) {
            self::StockExpiring => 'stock',
            self::TemperatureOutOfRange => 'temperature_reading',
            self::ShortHandIn => 'cash_settlement',
            self::ShortClose => 'daily_close',
            self::PriceApproval => 'goods_receipt',
            self::DishBelowTarget => 'dish_margin',
            self::DeliveryClosedUnmoved => 'delivery',
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
            self::TemperatureOutOfRange => '/kitchen/temperature-logs',
            self::ShortHandIn => '/kitchen/order-desk/settlement',
            self::ShortClose => '/kitchen/order-desk/close',
            self::PriceApproval => '/kitchen/payables',
            self::DishBelowTarget => '/kitchen/dish-margins',
            self::DeliveryClosedUnmoved => '/kitchen/branch-operating',
            default => '/kitchen/orders?view='.$subjectId,
        };
    }
}
