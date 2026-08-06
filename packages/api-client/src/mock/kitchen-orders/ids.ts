import { OrderId } from '@healthy360/domain-types';

/**
 * Deterministic identifiers for the kitchen orders mock world.
 *
 * Same discipline as `../kitchen-ops/ids.ts`: a fixed UUIDv7 prefix and a two-hex-digit band per
 * entity type, so an identifier read off a failing assertion says what it points at without a
 * lookup. The prefix is `01935f70-…` — one past the highest prefix any other mock world uses
 * (`01935f6f-…`, shared by the B2B, guest and platform-admin worlds) — so this world is provably
 * disjoint from every one of them without having to reason about band collisions.
 */
export const KITCHEN_ORDERS_ID_PREFIX = '01935f70-0000-7000-8000-';

export const KITCHEN_ORDERS_ID_BANDS = {
    order: 'a0',
    orderLine: 'b0',
} as const;

export type KitchenOrdersIdBand = keyof typeof KITCHEN_ORDERS_ID_BANDS;

export const KITCHEN_ORDERS_ORDINAL_LIMIT = 0xff;

export function kitchenOrdersId(band: KitchenOrdersIdBand, ordinal: number): string {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > KITCHEN_ORDERS_ORDINAL_LIMIT) {
        throw new RangeError(
            `Kitchen orders ordinal ${String(ordinal)} is outside the ${band} band (0–${String(KITCHEN_ORDERS_ORDINAL_LIMIT)}).`,
        );
    }
    const suffix = ordinal.toString(16).padStart(2, '0');
    return `${KITCHEN_ORDERS_ID_PREFIX}00000000${KITCHEN_ORDERS_ID_BANDS[band]}${suffix}`;
}

export const orderIdAt = (ordinal: number): OrderId =>
    OrderId.unsafe(kitchenOrdersId('order', ordinal));

export const orderLineIdAt = (ordinal: number): string => kitchenOrdersId('orderLine', ordinal);
