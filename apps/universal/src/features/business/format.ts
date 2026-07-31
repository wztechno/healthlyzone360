import type { CatalogueItem, Quotation, VolumeTier } from '@healthy360/api-client/contracts';
import { addMoney } from '@healthy360/domain-types';
import type { CurrencyCode, Money } from '@healthy360/domain-types';

import { addDays, isIsoDate, isoWeekday } from '../commerce/dates.ts';

/**
 * Presentation and arithmetic for the B2B surfaces.
 *
 * Three of these are the whole reason this module exists rather than being inlined into the screens.
 *
 * ## The contract-price marker
 *
 * `contract-price-` is a *privacy boundary expressed as a test id*. Every negotiated figure the
 * corporate screens render carries it, and `e2e/specs/business-privacy.ltr.spec.ts` walks every
 * marketplace and customer route asserting the prefix appears nowhere. That works only if the prefix
 * has exactly one source, so it is built here and never spelled out at a call site.
 *
 * The type system is the first line of that defence and this is the second: a consumer screen has no
 * `CatalogueItem` to render and no repository to fetch one from (`contracts/business.ts`), so it
 * cannot leak a price it has no way to hold. The sweep catches the case the types cannot — somebody
 * passing a figure down as a plain number.
 *
 * ## Money is never summed across currencies
 *
 * One catalogue line is priced in **SAR** while everything else is AED, deliberately, so that
 * anything which totals a mixed catalogue fails loudly rather than quietly adding riyals to dirhams
 * (`mock/prototype/fixtures/business.ts`). {@link totalsByCurrency} is the only way this feature adds
 * money: it groups first and adds within a group, so the result is a *list* of totals and a screen
 * physically cannot render a single wrong number. `addMoney` still throws on a mismatch, which is
 * the backstop if somebody bypasses the grouping.
 *
 * ## The supply schedule is derived from the record, not from the clock
 *
 * A supplier's dates come from `requestedAt + leadTimeDays`, projected onto the line's own delivery
 * weekdays. Anchoring on "today" instead would make the partner workspace show a different schedule
 * on every run and make the fixture week (Monday 27 July 2026) untestable.
 */

/* ── the contract-price marker ───────────────────────────────────────────────────────────────── */

/**
 * The one prefix that marks a negotiated figure. Corporate screens only — see the module note.
 *
 * Kept as a constant rather than a template literal at the call site so that `business-privacy`
 * has a single definition to point at and a rename cannot leave half the markers behind.
 */
export const CONTRACT_PRICE_TEST_ID_PREFIX = 'contract-price-';

/** `contract-price-<scope>`. `scope` identifies which figure, e.g. an item id or a tier id. */
export function contractPriceTestId(scope: string): string {
    return `${CONTRACT_PRICE_TEST_ID_PREFIX}${scope}`;
}

/* ── volume tiers ────────────────────────────────────────────────────────────────────────────── */

/**
 * The tier a quantity falls into, or `null` when it falls below the first one.
 *
 * `maximumQuantity: null` means "and upwards", so the last tier has no ceiling. A quantity under the
 * first tier's minimum deliberately resolves to `null` rather than to the cheapest tier: the screens
 * use that to say "below the minimum order" instead of quoting a price the buyer cannot have.
 */
export function tierForQuantity(tiers: readonly VolumeTier[], quantity: number): VolumeTier | null {
    return (
        tiers.find(
            (tier) =>
                quantity >= tier.minimumQuantity &&
                (tier.maximumQuantity === null || quantity <= tier.maximumQuantity),
        ) ?? null
    );
}

/**
 * What one draft line is worth at the tier its quantity earns.
 *
 * `null` when no tier applies — a quantity below the minimum order has no price, and inventing one
 * from the base contract price would quote a rate the volume does not entitle the buyer to.
 */
export function lineValue(item: CatalogueItem, quantity: number): Money | null {
    const tier = tierForQuantity(item.volumeTiers, quantity);
    const unitPrice = tier?.unitPrice ?? item.contractPrice;
    if (unitPrice === null || tier === null) return null;
    return { amount: unitPrice.amount * quantity, currency: unitPrice.currency };
}

/* ── money ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Totals, one per currency, in first-seen order.
 *
 * The signature is the argument: there is no `total(): Money`, because a catalogue that mixes AED
 * and SAR has no single total and a function returning one would have to invent an exchange rate the
 * product has no business inventing.
 */
export function totalsByCurrency(values: readonly Money[]): readonly Money[] {
    const order: CurrencyCode[] = [];
    const totals = new Map<CurrencyCode, Money>();

    for (const value of values) {
        const running = totals.get(value.currency);
        if (running === undefined) {
            order.push(value.currency);
            totals.set(value.currency, value);
        } else {
            // Same currency by construction, so this never throws here; it is the backstop for a
            // caller that groups incorrectly.
            totals.set(value.currency, addMoney(running, value));
        }
    }

    return order.map((currency) => {
        const total = totals.get(currency);
        if (total === undefined) throw new Error(`No running total for ${currency}.`);
        return total;
    });
}

/** True when the values span more than one currency — the case a single total may not be shown for. */
export function isMixedCurrency(values: readonly Money[]): boolean {
    return new Set(values.map((value) => value.currency)).size > 1;
}

/* ── the supply schedule ─────────────────────────────────────────────────────────────────────── */

/** How far ahead the partner schedule looks. Four weeks — a supplier's ordinary planning horizon. */
export const SUPPLY_HORIZON_DAYS = 28;

/**
 * The earliest day a line can be supplied: the day it was requested, plus its lead time.
 *
 * `null` for a record whose `requestedAt` is not a date this can parse, which is the honest answer
 * rather than silently substituting today.
 */
export function earliestSupplyDate(requestedAt: string, leadTimeDays: number): string | null {
    const day = requestedAt.slice(0, 10);
    if (!isIsoDate(day)) return null;
    return addDays(day, leadTimeDays);
}

/**
 * The supply days for one committed line, at or after its earliest date.
 *
 * Empty when the line has no delivery weekdays at all, which the screens render as "no schedule
 * agreed" rather than as an empty list with no explanation.
 */
export function supplyDates(
    quotation: Quotation,
    item: CatalogueItem,
    count: number,
): readonly string[] {
    const from =
        quotation.requestedDeliveryDate ??
        earliestSupplyDate(quotation.requestedAt, item.leadTimeDays);
    if (from === null || !isIsoDate(from) || item.deliveryWeekdays.length === 0 || count <= 0) {
        return [];
    }

    const dates: string[] = [];
    for (let offset = 0; offset <= SUPPLY_HORIZON_DAYS && dates.length < count; offset += 1) {
        const date = addDays(from, offset);
        if (date === null) break;
        const weekday = isoWeekday(date);
        if (weekday !== null && item.deliveryWeekdays.includes(weekday)) dates.push(date);
    }
    return dates;
}

/* ── translation keys ────────────────────────────────────────────────────────────────────────── */

/** `business:kinds.<kind>` — a catalogue line's kind, never rendered as a raw code. */
export function catalogueKindKey(kind: string): string {
    return `business:kinds.${kind}`;
}

/** `business:quotationStates.<state>`. */
export function quotationStateKey(state: string): string {
    return `business:quotationStates.${state}`;
}

/** `business:channels.<channel>` — the sales channels a negotiated line is sold through. */
export function salesChannelKey(channel: string): string {
    return `business:channels.${channel}`;
}
