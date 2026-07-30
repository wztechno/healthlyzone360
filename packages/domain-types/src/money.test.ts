import { describe, expect, it } from 'vitest';

import {
    CURRENCY_CODES,
    CurrencyMismatchError,
    InvalidMoneyError,
    addMoney,
    isCurrencyCode,
    isMoney,
    minorUnitExponent,
    money,
} from './money.ts';

describe('currency codes', () => {
    it('declares exactly the ten currencies the platform quotes in', () => {
        expect([...CURRENCY_CODES]).toEqual([
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
        ]);
        expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    });

    it('accepts every declared member and rejects everything else', () => {
        for (const code of CURRENCY_CODES) expect(isCurrencyCode(code)).toBe(true);
        expect(isCurrencyCode('aed')).toBe(false);
        expect(isCurrencyCode('EUR')).toBe(false);
        expect(isCurrencyCode('')).toBe(false);
        expect(isCurrencyCode(null)).toBe(false);
        expect(isCurrencyCode(978)).toBe(false);
    });
});

describe('minorUnitExponent', () => {
    it.each([
        ['KWD', 3],
        ['BHD', 3],
        ['OMR', 3],
    ] as const)('%s has three minor-unit digits', (currency, expected) => {
        expect(minorUnitExponent(currency)).toBe(expected);
    });

    it.each(['AED', 'SAR', 'QAR', 'JOD', 'EGP', 'LBP', 'USD'] as const)(
        '%s has two minor-unit digits',
        (currency) => {
            expect(minorUnitExponent(currency)).toBe(2);
        },
    );

    it('covers every declared currency', () => {
        for (const currency of CURRENCY_CODES) {
            expect([2, 3]).toContain(minorUnitExponent(currency));
        }
    });
});

describe('money', () => {
    it('builds a value from integer minor units', () => {
        expect(money(1250, 'AED')).toEqual({ amount: 1250, currency: 'AED' });
        expect(money(0, 'LBP')).toEqual({ amount: 0, currency: 'LBP' });
        expect(money(-500, 'USD')).toEqual({ amount: -500, currency: 'USD' });
    });

    it.each([[12.5], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.MAX_SAFE_INTEGER + 2]])(
        'rejects the non-integer amount %s',
        (amount) => {
            expect(() => money(amount, 'AED')).toThrow(InvalidMoneyError);
        },
    );

    it('rejects an unknown currency', () => {
        expect(() => money(100, 'EUR' as never)).toThrow(InvalidMoneyError);
    });
});

describe('isMoney', () => {
    it('accepts a well-formed value', () => {
        expect(isMoney({ amount: 1250, currency: 'AED' })).toBe(true);
    });

    it.each([
        ['fractional amount', { amount: 12.5, currency: 'AED' }],
        ['unknown currency', { amount: 12, currency: 'EUR' }],
        ['missing currency', { amount: 12 }],
        ['string amount', { amount: '12', currency: 'AED' }],
        ['null', null],
        ['array', []],
    ])('rejects %s', (_label, value) => {
        expect(isMoney(value)).toBe(false);
    });
});

describe('addMoney', () => {
    it('adds same-currency amounts in minor units', () => {
        expect(addMoney(money(1250, 'AED'), money(375, 'AED'))).toEqual({
            amount: 1625,
            currency: 'AED',
        });
    });

    it('is exact for three-decimal currencies', () => {
        // 1.250 KWD + 0.075 KWD = 1.325 KWD, with no floating-point step anywhere.
        expect(addMoney(money(1250, 'KWD'), money(75, 'KWD')).amount).toBe(1325);
    });

    it('throws rather than coercing across currencies', () => {
        expect(() => addMoney(money(100, 'AED'), money(100, 'SAR'))).toThrow(CurrencyMismatchError);
        try {
            addMoney(money(100, 'AED'), money(100, 'SAR'));
        } catch (error) {
            expect(error).toBeInstanceOf(CurrencyMismatchError);
            expect((error as CurrencyMismatchError).left).toBe('AED');
            expect((error as CurrencyMismatchError).right).toBe('SAR');
        }
    });

    it('is associative over a basket', () => {
        const lines = [money(1250, 'AED'), money(375, 'AED'), money(99, 'AED')];
        const leftToRight = addMoney(addMoney(lines[0]!, lines[1]!), lines[2]!);
        const rightToLeft = addMoney(lines[0]!, addMoney(lines[1]!, lines[2]!));
        expect(leftToRight).toEqual(rightToLeft);
        expect(leftToRight.amount).toBe(1724);
    });
});
