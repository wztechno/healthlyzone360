import type { IsoDateTime, OrderId } from '@healthy360/domain-types';

/**
 * The kitchen's top-bar alerts, and the service timings that decide when some of them fire.
 *
 * Every alert belongs to one person: the server filters on the caller's own user, so there is no
 * call here that could read or mark a colleague's. An alert carries what the bell draws and no more.
 * The wording is the screen's, from `type` and `orderNumber`, and the order link shows the rest to
 * whoever may see it.
 */

export const STAFF_ALERT_TYPES = [
    'unaccepted_manager',
    'unaccepted_owner',
    'allergy_order',
    'late_cancel',
    'delivery_failed',
    'no_cash_collected',
    'refund_approval',
    'stock_expiring',
    'temperature_out_of_range',
    'refund_approved',
    'refund_rejected',
    'short_hand_in',
    'short_close',
    'price_approval',
    'dish_below_target',
    'delivery_moved_closed',
    'delivery_closed_unmoved',
    'batch_stuck',
    'customer_cancelled',
] as const;
export type StaffAlertType = (typeof STAFF_ALERT_TYPES)[number];

export interface StaffAlert {
    readonly id: string;
    readonly type: StaffAlertType;
    readonly orderId: OrderId;
    readonly orderNumber: string;
    readonly severe: boolean;
    readonly readAt: IsoDateTime | null;
    readonly createdAt: IsoDateTime;
}

export interface StaffAlertList {
    /** The most recent, newest first. */
    readonly alerts: readonly StaffAlert[];
    /** Every unread alert of the caller's, so it can be more than `alerts` holds. */
    readonly unreadCount: number;
}

/** One kitchen's timings, in whole minutes, and its refund limit. */
export interface KitchenServiceSettings {
    readonly orderLeadMinutes: number;
    readonly alarmAfterMinutes: number;
    readonly managerAlertAfterMinutes: number;
    readonly ownerAlertAfterMinutes: number;
    /** Refunds on one order above this, in minor units, wait for the owner. */
    readonly refundApprovalAboveMinor: number;
    /** A delivery priced this far above the last price needs approval. `null` turns approvals off. */
    readonly priceApprovalAbovePercent: number | null;
    /** The margin a dish should clear. `null` turns the alert off. */
    readonly dishMarginTargetPercent: number | null;
    /** The most orders one window takes on one day. `null` means no limit. */
    readonly ordersPerWindow: number | null;
    /** New customer orders are refused until then. Read here, set through `pauseKitchen`. */
    readonly pausedUntil: string | null;
}

export interface StaffAlertsRepository {
    listAlerts(): Promise<StaffAlertList>;
    markAlertRead(alertId: string): Promise<void>;
    markAllAlertsRead(): Promise<void>;
    getServiceSettings(): Promise<KitchenServiceSettings>;
    saveServiceSettings(
        settings: Omit<KitchenServiceSettings, 'pausedUntil'>,
    ): Promise<KitchenServiceSettings>;
    pauseKitchen(minutes: number): Promise<KitchenServiceSettings>;
    resumeKitchen(): Promise<KitchenServiceSettings>;
}
