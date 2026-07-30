/**
 * Money.
 *
 * Amounts are **integer minor units** (fils, halalas, piastres, cents). Floating-point currency is
 * the classic source of one-off rounding drift, and the platform sells subscriptions where a
 * fraction of a fils compounds over twelve weeks, so the representation forbids it outright.
 *
 * This module deliberately carries almost no behaviour. Formatting belongs to `@healthy360/i18n`
 * (which owns the locale, the numbering system and the currency display name); pricing arithmetic
 * belongs to the backend. The only operation here is `addMoney`, because summing a basket of
 * same-currency lines is the one thing the client genuinely has to do to render a total.
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
