import { createSessionDraftStore } from '../../navigation/session-draft.ts';

/**
 * The day and window somebody picked under **Deliver to** in the shop, for this visit.
 *
 * The shop's address dropdown asks when as well as where, before there is a basket. The answer is
 * kept here and the checkout starts from it when its own URL says nothing else; the checkout still
 * checks both against live data, so a stale or unoffered choice simply falls back to its default.
 */
export interface DeliveryChoice {
    /** ISO day. */
    readonly date: string;
    /** A delivery window code. */
    readonly slot: string;
}

export const CURRENT_DELIVERY_CHOICE = 'current';

export const deliveryChoices = createSessionDraftStore<DeliveryChoice>({
    namespace: 'deliveryChoice',
    maxAgeMs: 24 * 60 * 60 * 1000,
    parse: (raw) => {
        if (typeof raw !== 'object' || raw === null) return null;
        const choice = raw as Partial<DeliveryChoice>;
        if (typeof choice.date !== 'string' || typeof choice.slot !== 'string') return null;
        return { date: choice.date, slot: choice.slot };
    },
});
