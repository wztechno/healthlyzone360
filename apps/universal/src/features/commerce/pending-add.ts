import { KitchenId, MealId } from '@healthy360/domain-types';

import { createSessionDraftStore } from '../../navigation/session-draft.ts';

/**
 * "Add to basket", waiting for a sign-in.
 *
 * Somebody signed out who presses Add has made the decision a marketplace exists to earn, and
 * answering it with "sign in first" used to cost them the choice: the meal and the quantity lived in
 * the dialog's `useState`, which the push to `/sign-in` unmounted (AUTH-01). So the press is written
 * down here before the person is sent anywhere, and `shell/marketplace-shell.tsx`'s replay adds it
 * once the session can hold a basket — after a sign-in, a registration and an email confirmation
 * alike, because each of them ends back inside the marketplace chrome.
 *
 * ## Why a session draft and not the URL
 *
 * The return path already rides the URL (`?returnTo=`), and the add could too — but then every page
 * on the way back would carry a "put this in the basket" instruction in its address, a link somebody
 * could share or a reload could replay. An add is a one-off fact about this visit, so it lives where
 * the other drafts do (`navigation/session-draft.ts`): `sessionStorage` on the web, memory on native,
 * cleared on sign-out with every other draft.
 *
 * ## Thirty minutes
 *
 * Long enough to register, find the confirmation mail and type its code; short enough that a person
 * who wandered off and came back an afternoon later is not surprised by a meal appearing in their
 * basket. An older draft is discarded unread by the store.
 */
export interface PendingAdd {
    readonly mealId: MealId;
    readonly quantity: number;
    /** The meal's kitchen, so the replay opens that kitchen's basket (browse-03). */
    readonly kitchenId?: KitchenId | undefined;
    readonly recordedAt: string;
}

export const PENDING_ADD_MAX_AGE_MS = 30 * 60 * 1000;

/** One pending add at a time: a second press before signing in replaces the first. */
const KEY = 'basket';

/** A quantity a stepper could have produced — a whole number of at least one. */
const MAX_QUANTITY = 99;

function parsePendingAdd(raw: unknown): PendingAdd | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const value = raw as Record<string, unknown>;
    const { mealId, quantity, kitchenId, recordedAt } = value;
    if (typeof mealId !== 'string' || mealId === '') return null;
    if (
        typeof quantity !== 'number' ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_QUANTITY
    ) {
        return null;
    }
    if (kitchenId !== undefined && (typeof kitchenId !== 'string' || kitchenId === '')) return null;
    if (typeof recordedAt !== 'string') return null;
    return {
        mealId: MealId.unsafe(mealId),
        quantity,
        ...(kitchenId === undefined ? {} : { kitchenId: KitchenId.unsafe(kitchenId) }),
        recordedAt,
    };
}

const store = createSessionDraftStore<PendingAdd>({
    namespace: 'pendingAdd',
    parse: parsePendingAdd,
    maxAgeMs: PENDING_ADD_MAX_AGE_MS,
});

export interface PendingAddInput {
    readonly mealId: MealId;
    readonly quantity: number;
    readonly kitchenId?: KitchenId | undefined;
}

export function writePendingAdd({ mealId, quantity, kitchenId }: PendingAddInput): void {
    store.write(KEY, {
        mealId,
        quantity,
        ...(kitchenId === undefined ? {} : { kitchenId }),
        recordedAt: new Date().toISOString(),
    });
}

export function readPendingAdd(): PendingAdd | null {
    return store.read(KEY);
}

export function clearPendingAdd(): void {
    store.clear(KEY);
}

/** Reactive read, for the replay. */
export function usePendingAdd(): PendingAdd | null {
    return store.useDraft(KEY);
}
