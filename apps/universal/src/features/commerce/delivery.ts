import type { DeliverySlot, Kitchen } from '@healthy360/api-client/contracts';

/**
 * Delivery slots and the delivery-area check.
 *
 * ## Why the slots are a constant here
 *
 * `contracts/commerce.ts` declares a `DeliverySlot` shape and every request that carries a
 * `slotCode`, but `CommerceRepository` publishes **no operation that lists them** — there is no
 * `listDeliverySlots()` and no slot collection on a kitchen or a plan. So the three codes the
 * repository will accept are declared here, once, and the gap is recorded rather than papered over:
 * a real backend must publish `GET /api/v1/delivery-slots` (or hang the set off the kitchen branch)
 * before this list can stop being a client-side assumption. Sending an unrecognised code is not
 * silently wrong — `previewSubscription` answers with a `subscription.unknown_slot` warning and
 * `changeSlot` rejects outright — which is what makes the assumption checkable rather than hidden.
 *
 * Labels are **not** stored here. A `DeliverySlot.label` frozen in English would resurface in
 * English for an Arabic reader; the code is the stable thing and `commerce:slots.<code>` is the
 * displayed thing.
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
}

export const DELIVERY_SLOTS: readonly DeliverySlotOption[] = [
    { code: 'morning', startsAt: '07:00', endsAt: '10:00' },
    { code: 'midday', startsAt: '11:00', endsAt: '14:00' },
    { code: 'evening', startsAt: '17:00', endsAt: '21:00' },
];

export const DEFAULT_SLOT_CODE = 'midday';

export function isDeliverySlotCode(code: string): boolean {
    return DELIVERY_SLOTS.some((slot) => slot.code === code);
}

export function deliverySlotByCode(code: string): DeliverySlotOption | null {
    return DELIVERY_SLOTS.find((slot) => slot.code === code) ?? null;
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
