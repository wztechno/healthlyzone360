import type { CurrencyCode, IsoDateTime, OrderId } from '@healthy360/domain-types';

/** What went wrong with an order, what it cost the kitchen and how it ended. */

export const COMPLAINT_CAUSES = [
    'wrong_item',
    'missing_item',
    'quality',
    'late',
    'foreign_object',
    'other',
] as const;
export type ComplaintCause = (typeof COMPLAINT_CAUSES)[number];

export const COMPLAINT_OUTCOMES = ['remade', 'refunded', 'apologised', 'no_action'] as const;
export type ComplaintOutcome = (typeof COMPLAINT_OUTCOMES)[number];

export interface OrderComplaint {
    readonly id: string;
    readonly orderId: OrderId;
    readonly orderNumber: string | null;
    readonly cause: ComplaintCause;
    readonly description: string | null;
    readonly costMinor: number;
    readonly currencyCode: CurrencyCode;
    /** `null` while it is open. */
    readonly outcome: ComplaintOutcome | null;
    readonly remakeOrderId: OrderId | null;
    readonly remakeOrderNumber: string | null;
    readonly orderRefundId: string | null;
    readonly createdAt: IsoDateTime | null;
    readonly closedAt: IsoDateTime | null;
}

export interface RecordComplaintRequest {
    readonly orderId: OrderId;
    readonly cause: ComplaintCause;
    readonly description: string | null;
    readonly costMinor: number;
}

export interface UpdateComplaintRequest {
    readonly complaintId: string;
    readonly costMinor?: number | undefined;
    /** `remade` is not here: only a remake closes a complaint that way. */
    readonly outcome?: Exclude<ComplaintOutcome, 'remade'> | null | undefined;
    readonly orderRefundId?: string | null | undefined;
}
