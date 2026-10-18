import type { GuestOrderState } from '@healthy360/api-client/contracts';
import type { BadgeTone } from '@healthy360/design-system';

/**
 * Where an order is on its way to the door, as pure functions over the server's one `state` field.
 *
 * ## The timeline is the states
 *
 * The design draws six steps — placed, confirmed by the kitchen, cooking, ready for pickup, out for
 * delivery, delivered — with a time against each. Each step is a state the order can be on.
 *
 * An account order (`PlacedOrder`) reads its step from the wire's status and the stamps beside it
 * (HA-19): the kitchen's Ready makes it **ready for pickup**, the driver's Picked up makes it **out
 * for delivery**, and only the driver's deliver (or the kitchen closing it by hand) makes it
 * **delivered**. The kitchen display's Start makes it **cooking** (HA-24); an order started before
 * Start was recorded moves from "confirmed" to "ready" and its cooking dot is drawn done as it
 * passes. A guest order still reports placed, confirmed and delivered only.
 *
 * `cancelled` is not a step. It can happen from any of the first three and says nothing about how
 * far the order got, so it is reported instead of the timeline rather than as a seventh dot.
 */

/** The steps in the order an order passes through them. */
export const ORDER_PROGRESS_STEPS = [
    'placed',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
] as const;
export type OrderProgressStep = (typeof ORDER_PROGRESS_STEPS)[number];

export type OrderStepPosition = 'done' | 'current' | 'upcoming';

/** The index of the step the order is on, or `null` for a cancelled order, which is on none. */
export function currentStepIndex(state: GuestOrderState): number | null {
    if (state === 'cancelled') return null;
    return (ORDER_PROGRESS_STEPS as readonly string[]).indexOf(state);
}

/**
 * Each step against the current one. A delivered order has nothing left to wait for, so its last
 * step is `done` rather than `current`: "current" is drawn as something still in motion.
 */
export function stepPosition(stepIndex: number, current: number): OrderStepPosition {
    if (stepIndex < current) return 'done';
    if (stepIndex > current) return 'upcoming';
    return stepIndex === ORDER_PROGRESS_STEPS.length - 1 ? 'done' : 'current';
}

/**
 * State → badge tone. The design's status table, onto the semantic tones: waiting on the kitchen
 * is `warning` (something still has to happen), confirmed is `info`, moving towards the door is
 * `success`, and a finished order — delivered or cancelled — is `neutral`, because neither asks
 * anything more of the person reading it.
 */
export const ORDER_STATE_TONE: Readonly<Record<GuestOrderState, BadgeTone>> = {
    placed: 'warning',
    confirmed: 'info',
    preparing: 'warning',
    ready_for_pickup: 'success',
    out_for_delivery: 'success',
    delivered: 'neutral',
    cancelled: 'neutral',
};
