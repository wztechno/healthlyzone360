/**
 * Money.
 *
 * Amounts are **integer minor units** (fils, halalas, piastres, cents). Floating-point currency is
 * the classic source of one-off rounding drift, and the platform sells subscriptions where a
 * fraction of a fils compounds over twelve weeks, so the representation forbids it outright.
 *
 * This module deliberately carries almost no behaviour. Formatting belongs to `@healthy360/i18n`
 * (which owns the locale, the numbering system and the currency display name); pricing arithmetic
 * belongs to the backend. The only arithmetic here is `addMoney`, because summing a basket of
 * same-currency lines is the one thing the client genuinely has to do to render a total. The two
 * text helpers at the foot are what a money field needs, here so a phone build can have them
 * without the kitchen's forms behind them.
 */

/**
 * The currencies the platform quotes in. GCC and Levant markets first, with USD for cross-border
 * corporate agreements. ISO 4217 alphabetic codes.
 */
export const CURRENCY_CODES = [
    'AED',
    'SAR',
    'QAR',
    'KWD',
    'BHD',
    'OMR',
    'JOD',
    'EGP',
    'LBP',
    'USD',
] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

const CURRENCY_CODE_SET: ReadonlySet<string> = new Set<string>(CURRENCY_CODES);

export function isCurrencyCode(value: unknown): value is CurrencyCode {
    return typeof value === 'string' && CURRENCY_CODE_SET.has(value);
}

/**
 * ISO 4217 currencies with three minor-unit digits. The Kuwaiti, Bahraini and Omani units are
 * thousandths, not hundredths — a detail that silently corrupts every total if it is assumed away.
 */
const THREE_DECIMAL_CURRENCIES: ReadonlySet<CurrencyCode> = new Set<CurrencyCode>([
    'KWD',
    'BHD',
    'OMR',
]);

/** How many decimal digits the currency's minor unit has: 3 for KWD/BHD/OMR, 2 for the rest. */
export function minorUnitExponent(currency: CurrencyCode): number {
    return THREE_DECIMAL_CURRENCIES.has(currency) ? 3 : 2;
}

export interface Money {
    /** Integer minor units. `1250` in AED is 12.50 AED; `1250` in KWD is 1.250 KWD. */
    readonly amount: number;
    readonly currency: CurrencyCode;
}

export function isMoney(value: unknown): value is Money {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { amount?: unknown; currency?: unknown };
    return Number.isSafeInteger(candidate.amount) && isCurrencyCode(candidate.currency);
}

export class InvalidMoneyError extends Error {
    readonly received: unknown;

    constructor(message: string, received: unknown) {
        super(message);
        this.name = 'InvalidMoneyError';
        this.received = received;
    }
}

export class CurrencyMismatchError extends Error {
    readonly left: CurrencyCode;
    readonly right: CurrencyCode;

    constructor(left: CurrencyCode, right: CurrencyCode) {
        super(
            `Cannot combine ${left} with ${right}: money arithmetic never crosses currencies. ` +
                'Convert through a server-issued rate first.',
        );
        this.name = 'CurrencyMismatchError';
        this.left = left;
        this.right = right;
    }
}

/** Validating constructor. Use it at every boundary; fixtures and mappers included. */
export function money(amount: number, currency: CurrencyCode): Money {
    if (!Number.isSafeInteger(amount)) {
        throw new InvalidMoneyError(
            `Money amounts are integer minor units, received ${JSON.stringify(amount)}`,
            amount,
        );
    }
    if (!isCurrencyCode(currency)) {
        throw new InvalidMoneyError(
            `Unknown currency ${JSON.stringify(currency)}`,
            currency as unknown,
        );
    }
    return { amount, currency };
}

/**
 * The single arithmetic operation. Throws rather than coercing on a currency mismatch: a silently
 * wrong total is far more damaging than a crash in a code path that should never have existed.
 */
export function addMoney(left: Money, right: Money): Money {
    if (left.currency !== right.currency) {
        throw new CurrencyMismatchError(left.currency, right.currency);
    }
    return money(left.amount + right.amount, left.currency);
}

/**
 * Minor units as the string a **major-unit** input field holds.
 *
 * String arithmetic, not `amountMinor / 100`. `555 / 100` is `5.55` today and
 * `5.550000000000001` for the next value somebody tries, and a form that re-renders a figure
 * differently from the one it was given is a form people stop trusting. The exponent comes from the
 * currency, because the Kuwaiti, Bahraini and Omani minor units are thousandths (D-030).
 */
export function minorAmountToInput(amountMinor: number, currency: CurrencyCode): string {
    const exponent = minorUnitExponent(currency);
    const sign = amountMinor < 0 ? '-' : '';
    const digits = String(Math.abs(Math.trunc(amountMinor))).padStart(exponent + 1, '0');
    const whole = digits.slice(0, digits.length - exponent);
    const fraction = digits.slice(digits.length - exponent);
    return exponent === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

/**
 * A major-unit amount typed into a field, as integer minor units.
 *
 * The inverse of {@link minorAmountToInput}, and string-based for the same reason: `Number('5.50') *
 * 100` is not reliably `550`, and this value goes into a `bigint` column. `null` for anything that
 * is not a plain non-negative decimal, **including** one with more decimal places than the currency
 * has — `5.505` in dollars is not half a cent, it is a typo, and silently rounding it would put a
 * figure in the database that nobody typed.
 *
 * Latin digits only, exactly as the kitchen forms' quantities: the display of a price follows the reader's
 * locale, but the value being edited is on its way to an integer column and an input that localised
 * it would make round-tripping a figure depend on the interface language.
 */
export function parseMinorAmount(value: string, currency: CurrencyCode): number | null {
    const trimmed = value.trim();
    if (trimmed === '' || !/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return null;

    const exponent = minorUnitExponent(currency);
    const [whole = '', fraction = ''] = trimmed.split('.');
    if (fraction.length > exponent) return null;

    const digits = `${whole === '' ? '0' : whole}${fraction.padEnd(exponent, '0')}`;
    const parsed = Number(digits);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
