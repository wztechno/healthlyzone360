/**
 * The parts of `DateField` that do not care which platform is rendering.
 *
 * Dates are the one input where the two targets genuinely diverge: the web has a native
 * `input[type=date]` with a real calendar picker and locale-aware display for free, while React
 * Native has no date input at all and every library that supplies one is a native module. Rather
 * than ship a hand-built calendar to both, the component splits — and everything that could drift
 * between the two halves (the value format, the bounds arithmetic, the validity rules) lives here.
 *
 * The wire format is always ISO `YYYY-MM-DD`. It sorts lexicographically, which is what makes the
 * bounds comparisons below plain string comparisons, and it is what an API would carry anyway.
 */

export interface DateFieldProps {
    readonly label: string;
    /** ISO `YYYY-MM-DD`, or `null` when nothing has been chosen. */
    readonly value: string | null;
    readonly onChange: (value: string | null) => void;
    /** Inclusive ISO bounds. */
    readonly min?: string | undefined;
    readonly max?: string | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export interface DateParts {
    readonly year: number | null;
    readonly month: number | null;
    readonly day: number | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
    if (!ISO_DATE.test(value)) return false;
    const parts = splitIso(value);
    if (parts.year === null || parts.month === null || parts.day === null) return false;
    if (parts.month < 1 || parts.month > 12) return false;
    return parts.day >= 1 && parts.day <= daysInMonth(parts.year, parts.month);
}

function splitIso(value: string): DateParts {
    const [year, month, day] = value.split('-');
    return {
        year: year === undefined ? null : Number(year),
        month: month === undefined ? null : Number(month),
        day: day === undefined ? null : Number(day),
    };
}

export function partsFromIso(value: string | null): DateParts {
    if (value === null || !ISO_DATE.test(value)) return { year: null, month: null, day: null };
    return splitIso(value);
}

/** Days in a month, Gregorian, with the full leap-year rule (2100 is not a leap year). */
export function daysInMonth(year: number, month: number): number {
    if (month === 2) {
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, length: number): string {
    return String(value).padStart(length, '0');
}

/**
 * Assembles an ISO date from parts, or `null` when the date is not yet complete.
 *
 * A day that no longer exists in the chosen month (31 February) yields `null` rather than rolling
 * over into March — a silent roll-over is how a birth date ends up one day out.
 */
export function isoFromParts(parts: DateParts): string | null {
    const { year, month, day } = parts;
    if (year === null || month === null || day === null) return null;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > daysInMonth(year, month)) return null;
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function withinBounds(
    value: string,
    min: string | undefined,
    max: string | undefined,
): boolean {
    if (min !== undefined && value < min) return false;
    return !(max !== undefined && value > max);
}

export function clampIso(value: string, min: string | undefined, max: string | undefined): string {
    if (min !== undefined && value < min) return min;
    if (max !== undefined && value > max) return max;
    return value;
}

/** Inclusive year range offered by the native selects, derived from the bounds when present. */
export function yearRange(
    min: string | undefined,
    max: string | undefined,
    today: Date = new Date(),
): readonly number[] {
    const current = today.getUTCFullYear();
    const first = min === undefined ? current - 120 : Number(min.slice(0, 4));
    const last = max === undefined ? current + 10 : Number(max.slice(0, 4));
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [current];
    return Array.from({ length: last - first + 1 }, (_unused, index) => last - index);
}

/**
 * Month names for a locale.
 *
 * `Intl` is used rather than twelve translation keys per language: the month names are already in
 * the platform's locale data, and duplicating them into a catalogue would mean maintaining a second,
 * worse copy. Engines without full ICU fall back to the month number, which is legible everywhere
 * and never wrong.
 */
export function monthNames(locale: string): readonly string[] {
    try {
        const formatter = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
        return Array.from({ length: 12 }, (_unused, index) =>
            formatter.format(new Date(Date.UTC(2024, index, 1))),
        );
    } catch {
        return Array.from({ length: 12 }, (_unused, index) => pad(index + 1, 2));
    }
}
