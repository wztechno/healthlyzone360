/**
 * Intl façade.
 *
 * Numbering system is **configurable and defaults to Latin digits (`latn`)**. That default is a
 * provisional product decision recorded in the open-questions register, not a technical constraint:
 * plan §20 explicitly forbids permanently forcing Latin digits on Arabic users, so callers can opt
 * into Eastern Arabic digits (`arab`) per formatter, and a future management decision can flip the
 * default for clinical and financial figures without touching call sites.
 */

export const DEFAULT_NUMBERING_SYSTEM = 'latn';

/** Common values; any ICU numbering-system identifier is accepted. */
export type NumberingSystem = 'latn' | 'arab' | 'arabext' | (string & {});

export interface FormatterOptions {
    readonly locale: string;
    readonly numberingSystem?: NumberingSystem | undefined;
    readonly timeZone?: string | undefined;
    /** ISO 4217 code used when `formatCurrency` is called without one. */
    readonly currency?: string | undefined;
}

export interface Formatter {
    readonly locale: string;
    /** The BCP-47 tag actually handed to Intl, including the `-u-nu-` extension. */
    readonly resolvedLocale: string;
    readonly numberingSystem: NumberingSystem;
    formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
    formatCurrency(value: number, currency?: string, options?: Intl.NumberFormatOptions): string;
    formatDate(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
    /** Relative time between `value` and `now` (defaults to the current instant). */
    formatRelativeTime(value: Date | string | number, now?: Date | number): string;
}

/**
 * Adds (or replaces) the `-u-nu-<system>` Unicode extension on a BCP-47 tag.
 * `withNumberingSystem('ar-SA', 'latn')` → `'ar-SA-u-nu-latn'`.
 */
export function withNumberingSystem(locale: string, numberingSystem: NumberingSystem): string {
    const [base = locale] = locale.split('-u-');
    return `${base}-u-nu-${numberingSystem}`;
}

function toDate(value: Date | string | number): Date {
    if (value instanceof Date) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`Not a valid date: ${String(value)}`);
    }
    return date;
}

/** Largest unit whose threshold the elapsed time clears — how humans describe intervals. */
const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 1000 * 60 * 60 * 24 * 365],
    ['month', 1000 * 60 * 60 * 24 * 30],
    ['week', 1000 * 60 * 60 * 24 * 7],
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
    ['second', 1000],
];

export function createFormatter(options: FormatterOptions): Formatter {
    const numberingSystem = options.numberingSystem ?? DEFAULT_NUMBERING_SYSTEM;
    const resolvedLocale = withNumberingSystem(options.locale, numberingSystem);
    const dateDefaults: Intl.DateTimeFormatOptions =
        options.timeZone === undefined ? {} : { timeZone: options.timeZone };

    return {
        locale: options.locale,
        resolvedLocale,
        numberingSystem,

        formatNumber(value, numberOptions) {
            return new Intl.NumberFormat(resolvedLocale, numberOptions).format(value);
        },

        formatCurrency(value, currency, numberOptions) {
            const code = currency ?? options.currency;
            if (code === undefined) {
                throw new Error(
                    'formatCurrency needs a currency code, either per call or as a formatter default.',
                );
            }
            return new Intl.NumberFormat(resolvedLocale, {
                style: 'currency',
                currency: code,
                ...numberOptions,
            }).format(value);
        },

        formatDate(value, dateOptions) {
            return new Intl.DateTimeFormat(resolvedLocale, {
                ...dateDefaults,
                ...dateOptions,
            }).format(toDate(value));
        },

        formatRelativeTime(value, now) {
            const target = toDate(value).getTime();
            const reference = now === undefined ? Date.now() : toDate(now).getTime();
            const deltaMs = target - reference;
            const absolute = Math.abs(deltaMs);

            const [unit, unitMs] = RELATIVE_UNITS.find(([, ms]) => absolute >= ms) ?? [
                'second' as const,
                1000,
            ];

            const formatter = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: 'auto' });
            return formatter.format(Math.round(deltaMs / unitMs), unit);
        },
    };
}
