import { withQuery } from '../../navigation/return-to.ts';
import { createSessionDraftStore } from '../../navigation/session-draft.ts';

/**
 * The checkout's in-progress choices, held in its URL.
 *
 * `/customer/checkout` is one of the siblings in the customer area's `<Slot/>`, so adding an address
 * or confirming a phone number unmounts it, and it used to come back on the delivery step with the
 * date reset and the slot back at the kitchen default (the "we lose all the process" report). The
 * choices are short, opaque and not personal — an address identifier of the person's own, an ISO
 * date, a window code — so they ride in the query: a refresh keeps them, Back walks Delivery and
 * Payment, and a detour's `returnTo` carries them there and back without a store.
 *
 * Every value is validated against live data by the screen; this module only reads and writes them.
 */

export const CHECKOUT_PATH = '/customer/checkout';

export interface CheckoutDraft {
    readonly channel?: string | undefined;
    readonly address?: string | undefined;
    readonly date?: string | undefined;
    readonly slot?: string | undefined;
    /** `payment` once the delivery details are committed; absent on the delivery step. */
    readonly step?: 'payment' | undefined;
    /** The identifier of the order this checkout just placed — the confirmation step. */
    readonly placed?: string | undefined;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined || first === '' ? undefined : first;
}

export function readCheckoutDraft(params: Params): CheckoutDraft {
    return {
        channel: single(params['channel']),
        address: single(params['address']),
        date: single(params['date']),
        slot: single(params['slot']),
        step: single(params['step']) === 'payment' ? 'payment' : undefined,
        placed: single(params['placed']),
    };
}

/** `/customer/checkout` with the given choices; empty ones are left out. */
export function checkoutHref(draft: CheckoutDraft): string {
    return withQuery(CHECKOUT_PATH, {
        channel: draft.channel,
        address: draft.address,
        date: draft.date,
        slot: draft.slot,
        step: draft.step,
        placed: draft.placed,
    });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | undefined): value is string {
    return value !== undefined && ISO_DATE.test(value);
}

/**
 * What the confirmation says that the placed order itself does not: the kitchen's name as the
 * person saw it. Placement empties the basket, which disables the kitchen query the name came from.
 */
export interface PlacedOrderNote {
    readonly orderId: string;
    readonly kitchenName: string | null;
    readonly slotLabel: string;
}

/** The order placed most recently in this tab. */
export const LATEST_PLACED = 'latest';

export const placedOrders = createSessionDraftStore<PlacedOrderNote>({
    namespace: 'placedOrder',
    maxAgeMs: 24 * 60 * 60 * 1000,
    parse: (raw) => {
        if (typeof raw !== 'object' || raw === null) return null;
        const note = raw as Partial<PlacedOrderNote>;
        if (typeof note.orderId !== 'string' || typeof note.slotLabel !== 'string') return null;
        return {
            orderId: note.orderId,
            kitchenName: typeof note.kitchenName === 'string' ? note.kitchenName : null,
            slotLabel: note.slotLabel,
        };
    },
});
