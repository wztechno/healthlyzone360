import type {
    DeliverySlot,
    Kitchen,
    KitchenDeliveryWindow,
} from '@healthy360/api-client/contracts';

/**
 * Delivery slots and the delivery-area check.
 *
 * ## Where the slot list comes from
 *
 * Prefer the kitchen's published `deliveryWindows` (marketplace kitchen projection).
 * When a kitchen has not configured windows yet — or the caller has no kitchen in
 * hand — fall back to {@link FALLBACK_DELIVERY_SLOTS} so subscription editors and
 * tests keep a stable, recognised set. Sending an unrecognised code is still
 * rejected by the API (`subscription.unknown_slot` / change-slot failure).
 *
 * Labels for fallback codes live in `commerce:slots.<code>`. Kitchen-published
 * windows already carry a localised `label` from the server.
 *
 * ## Why the area check is a real check
 *
 * Doc 11 §3 (`DEF-04`) records the reference product confirming delivery availability *after* the
 * pricing decision, and doc 17 `SUB-02` records our deliberate divergence: ask before the price.
 * The question is only worth asking if the answer is real, so it is answered from the kitchen's own
 * published delivery zones (`contracts/marketplace.ts`, `KitchenBranch.deliveryZones`) rather than
 * from a hard-coded list of emirates.
 */

/** A slot the repository recognises. Times are kitchen-local `HH:mm`. */
export interface DeliverySlotOption {
    readonly code: string;
    readonly startsAt: string;
    readonly endsAt: string;
    /** Present when the option came from a kitchen-published window. */
    readonly label?: string | undefined;
}

/**
 * Last-resort slots when the kitchen has published none.
 *
 * @deprecated Prefer {@link deliverySlotsForKitchen}. Kept as `DELIVERY_SLOTS` for tests.
 */
export const FALLBACK_DELIVERY_SLOTS: readonly DeliverySlotOption[] = [
    { code: 'morning', startsAt: '07:00', endsAt: '10:00' },
    { code: 'midday', startsAt: '11:00', endsAt: '14:00' },
    { code: 'evening', startsAt: '17:00', endsAt: '21:00' },
];

/** @deprecated Prefer {@link deliverySlotsForKitchen}. */
export const DELIVERY_SLOTS = FALLBACK_DELIVERY_SLOTS;

export const DEFAULT_SLOT_CODE = 'midday';

export function windowToSlotOption(window: KitchenDeliveryWindow): DeliverySlotOption {
    return {
        code: window.code,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        label: window.label,
    };
}

/** Slots for a kitchen: published windows when present, otherwise the fallback set. */
export function deliverySlotsForKitchen(
    kitchen: Kitchen | undefined | null,
): readonly DeliverySlotOption[] {
    const windows = kitchen?.deliveryWindows ?? [];
    if (windows.length === 0) return FALLBACK_DELIVERY_SLOTS;
    return windows.map(windowToSlotOption);
}

export function defaultSlotCodeForKitchen(kitchen: Kitchen | undefined | null): string {
    const slots = deliverySlotsForKitchen(kitchen);
    if (slots.some((slot) => slot.code === DEFAULT_SLOT_CODE)) return DEFAULT_SLOT_CODE;
    return slots[0]?.code ?? DEFAULT_SLOT_CODE;
}

export function isDeliverySlotCode(code: string, kitchen?: Kitchen | null | undefined): boolean {
    return deliverySlotsForKitchen(kitchen).some((slot) => slot.code === code);
}

export function deliverySlotByCode(
    code: string,
    kitchen?: Kitchen | null | undefined,
): DeliverySlotOption | null {
    return deliverySlotsForKitchen(kitchen).find((slot) => slot.code === code) ?? null;
}

/** Widens a local option to the contract shape, taking the translated label from the caller. */
export function toContractSlot(option: DeliverySlotOption, label: string): DeliverySlot {
    return { code: option.code, label, startsAt: option.startsAt, endsAt: option.endsAt };
}

/* ── the delivery-area check (doc 17, SUB-02) ────────────────────────────────────────────────── */

export const DELIVERY_AREA_STATUSES = ['served', 'unserved', 'unknown'] as const;
export type DeliveryAreaStatus = (typeof DELIVERY_AREA_STATUSES)[number];

/** Every area name the kitchen's branches publish a delivery zone for, de-duplicated and sorted. */
export function servedAreas(kitchen: Kitchen | undefined): readonly string[] {
    if (kitchen === undefined) return [];
    const areas = new Set<string>();
    for (const branch of kitchen.branches) {
        if (!branch.isActive) continue;
        for (const zone of branch.deliveryZones) areas.add(zone.area);
    }
    return [...areas].sort((left, right) => left.localeCompare(right));
}

/** Case- and whitespace-insensitive, because "business bay" is the same place as "Business Bay". */
function normalise(value: string): string {
    return value.trim().toLocaleLowerCase();
}

/**
 * Whether an address falls inside a kitchen's published delivery zones.
 *
 * `unknown` is a real third answer and is never treated as `served`: a kitchen that publishes no
 * zones has told us nothing, and inferring coverage from silence is precisely the failure the check
 * exists to prevent. It is also not treated as `unserved` — that would block a subscription over a
 * gap in the catalogue rather than over a fact about delivery.
 */
export function deliveryAreaStatus(kitchen: Kitchen | undefined, area: string): DeliveryAreaStatus {
    const areas = servedAreas(kitchen);
    if (areas.length === 0) return 'unknown';
    if (normalise(area).length === 0) return 'unknown';
    return areas.some((served) => normalise(served) === normalise(area)) ? 'served' : 'unserved';
}
