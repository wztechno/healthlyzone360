import { money } from '@healthy360/domain-types';
import type { CurrencyCode, IsoDateTime, Money } from '@healthy360/domain-types';
import type { NutritionSource } from '@healthy360/nutrition';

/**
 * The constants the whole prototype world is pinned to.
 *
 * Everything about this data set is fixed. There is no `Date.now()`, no `Math.random()` and no
 * locale-dependent formatting anywhere below `prototype/`: a fixture that changes between two runs
 * turns a failing assertion into a mystery, and a screenshot baseline into a lottery.
 */

/** The single instant every prototype timestamp is derived from. Matches the mock store's `MOCK_NOW`. */
export const PROTOTYPE_NOW: IsoDateTime = '2026-07-30T09:00:00.000Z';

/** `YYYY-MM-DD` for {@link PROTOTYPE_NOW}. */
export const PROTOTYPE_TODAY = '2026-07-30';

/** Monday of the week {@link PROTOTYPE_TODAY} falls in. Every planner fixture is anchored here. */
export const PROTOTYPE_WEEK_START = '2026-07-27';

/** How far the catalogue publishes availability: this week and the next. */
export const PROTOTYPE_AVAILABILITY_DAYS = 14;

/** Default trading currency. The one deliberate exception is a single SAR B2B contract price. */
export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/** The provenance stamped on **every** set of nutrition facts in this world. */
export const SYNTHETIC_SOURCE: NutritionSource = {
    kind: 'synthetic_prototype',
    label: 'Healthy360 synthetic prototype data set',
    version: '1',
    calculatedAt: PROTOTYPE_NOW,
};

/** The short provenance line a facts panel renders beside the figures. */
export const SYNTHETIC_SOURCE_LABEL = 'Synthetic prototype data';

/** Fixed wording rendered wherever nutrition figures or suggestions are shown. */
export const PROTOTYPE_DISCLAIMER =
    'These figures come from a prototype data set and a prototype calculator. They are an ' +
    'estimate, not medical advice, and they describe no real product. Speak to a qualified ' +
    'dietitian or doctor before acting on them.';

/** Default currency, in minor units. `money()` validates, so a fractional price cannot reach a fixture. */
export function usd(minorUnits: number): Money {
    return money(minorUnits, DEFAULT_CURRENCY);
}

/** @deprecated Use {@link usd}. Kept so fixture call sites migrate without a big-bang rename. */
export const aed = usd;

export function currency(minorUnits: number, code: CurrencyCode): Money {
    return money(minorUnits, code);
}

/* ------------------------------------------------------------------------------------------------
 * Indexing helpers
 *
 * `noUncheckedIndexedAccess` is on, so every array read is `T | undefined`. Rather than sprinkling
 * non-null assertions (which the lint configuration bans outside tests) through a few thousand lines
 * of fixture assembly, indexing goes through these — and a mistake in a table becomes a legible
 * error instead of `undefined` leaking into a nutrition calculation.
 * ---------------------------------------------------------------------------------------------- */

export class PrototypeFixtureError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PrototypeFixtureError';
    }
}

export function atOrThrow<T>(items: readonly T[], index: number, what: string): T {
    const value = items[index];
    if (value === undefined) {
        throw new PrototypeFixtureError(
            `No ${what} at index ${String(index)} (the collection holds ${String(items.length)}).`,
        );
    }
    return value;
}

export function fromMapOrThrow<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
    const value = map.get(key);
    if (value === undefined) {
        throw new PrototypeFixtureError(`No ${what} registered under ${String(key)}.`);
    }
    return value;
}

/** Picks an element by a rotating index. Total for any integer, including negatives. */
export function rotate<T>(items: readonly T[], index: number, what: string): T {
    if (items.length === 0) {
        throw new PrototypeFixtureError(`Cannot rotate through an empty collection of ${what}.`);
    }
    const wrapped = ((index % items.length) + items.length) % items.length;
    return atOrThrow(items, wrapped, what);
}

/* ------------------------------------------------------------------------------------------------
 * Calendar helpers
 * ---------------------------------------------------------------------------------------------- */

const MILLISECONDS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` plus `days`. UTC arithmetic only, so no timezone can shift a fixture. */
export function addDays(date: string, days: number): string {
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed)) {
        throw new PrototypeFixtureError(`"${date}" is not a YYYY-MM-DD date.`);
    }
    return new Date(parsed + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` dates; negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
    const start = Date.parse(`${from}T00:00:00.000Z`);
    const end = Date.parse(`${to}T00:00:00.000Z`);
    if (Number.isNaN(start) || Number.isNaN(end)) {
        throw new PrototypeFixtureError(`Cannot measure the span from "${from}" to "${to}".`);
    }
    return Math.round((end - start) / MILLISECONDS_PER_DAY);
}

/** ISO weekday: `1` Monday through `7` Sunday. */
export function isoWeekday(date: string): number {
    const parsed = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return parsed === 0 ? 7 : parsed;
}

/** The seven `YYYY-MM-DD` dates of the week starting at `weekStart`. */
export function weekDates(weekStart: string): readonly string[] {
    return [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(weekStart, offset));
}

/** `YYYY-MM-DD` + `HH:mm` as an instant, so a cut-off time can be compared to a timestamp. */
export function instantAt(date: string, time: string): IsoDateTime {
    return `${date}T${time}:00.000Z`;
}
