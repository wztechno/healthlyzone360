import { describe, expect, it } from 'vitest';

import { DEFAULT_NUMBERING_SYSTEM, createFormatter, withNumberingSystem } from './format.ts';

const LATIN_DIGITS = /[0-9]/;
const ARABIC_INDIC_DIGITS = /[٠-٩]/;
const REFERENCE = new Date('2026-03-15T13:45:00.000Z');

describe('withNumberingSystem', () => {
    it('appends the Unicode extension', () => {
        expect(withNumberingSystem('en-GB', 'latn')).toBe('en-GB-u-nu-latn');
        expect(withNumberingSystem('ar', 'arab')).toBe('ar-u-nu-arab');
    });

    it('replaces an existing extension rather than stacking one', () => {
        expect(withNumberingSystem('ar-SA-u-nu-arab', 'latn')).toBe('ar-SA-u-nu-latn');
    });
});

describe('numbering system default', () => {
    it('is Latin digits — a provisional product default, not a permanent decision (plan §20)', () => {
        expect(DEFAULT_NUMBERING_SYSTEM).toBe('latn');
        expect(createFormatter({ locale: 'ar-SA' }).numberingSystem).toBe('latn');
    });

    it('is overridable per formatter', () => {
        expect(createFormatter({ locale: 'ar-SA', numberingSystem: 'arab' }).numberingSystem).toBe(
            'arab',
        );
    });
});

describe('formatNumber', () => {
    it('formats English with Latin digits and grouping', () => {
        const formatter = createFormatter({ locale: 'en-GB' });
        expect(formatter.formatNumber(1234567.891)).toMatchInlineSnapshot(`"1,234,567.891"`);
        expect(formatter.formatNumber(0.5, { style: 'percent' })).toMatchInlineSnapshot(`"50%"`);
    });

    it('keeps Arabic on Latin digits by default', () => {
        const formatter = createFormatter({ locale: 'ar-SA' });
        const output = formatter.formatNumber(1234567.891);
        expect(output).toMatch(LATIN_DIGITS);
        expect(output).not.toMatch(ARABIC_INDIC_DIGITS);
        expect(formatter.resolvedLocale).toBe('ar-SA-u-nu-latn');
    });

    it('renders Eastern Arabic digits when explicitly opted into', () => {
        const formatter = createFormatter({ locale: 'ar-SA', numberingSystem: 'arab' });
        const output = formatter.formatNumber(1234567.891);
        expect(output).toMatch(ARABIC_INDIC_DIGITS);
        expect(output).not.toMatch(LATIN_DIGITS);
    });
});

describe('formatCurrency', () => {
    it('uses the per-call currency', () => {
        const formatter = createFormatter({ locale: 'en-GB' });
        // ICU separates a three-letter currency code from the amount with a non-breaking space, so the
        // comparison normalises whitespace rather than baking U+00A0 into the source.
        const normalise = (value: string) => value.replace(/\s/gu, ' ');
        expect(normalise(formatter.formatCurrency(1234.5, 'AED'))).toBe('AED 1,234.50');
        expect(normalise(formatter.formatCurrency(1234.5, 'GBP'))).toBe('£1,234.50');
    });

    it('falls back to the formatter default currency', () => {
        const formatter = createFormatter({ locale: 'en-GB', currency: 'LBP' });
        expect(formatter.formatCurrency(2500)).toContain('2,500');
    });

    it('refuses to guess when no currency is available', () => {
        const formatter = createFormatter({ locale: 'en-GB' });
        expect(() => formatter.formatCurrency(10)).toThrow(/needs a currency code/);
    });

    it('honours the numbering system for Arabic money', () => {
        const latin = createFormatter({ locale: 'ar-SA', currency: 'SAR' });
        const arabic = createFormatter({
            locale: 'ar-SA',
            currency: 'SAR',
            numberingSystem: 'arab',
        });
        expect(latin.formatCurrency(1234.5)).toMatch(LATIN_DIGITS);
        expect(arabic.formatCurrency(1234.5)).toMatch(ARABIC_INDIC_DIGITS);
    });
});

describe('formatDate', () => {
    it('formats a fixed instant in UTC for English', () => {
        const formatter = createFormatter({ locale: 'en-GB', timeZone: 'UTC' });
        expect(formatter.formatDate(REFERENCE, { dateStyle: 'medium' })).toMatchInlineSnapshot(
            `"15 Mar 2026"`,
        );
        expect(
            formatter.formatDate(REFERENCE, { dateStyle: 'short', timeStyle: 'short' }),
        ).toMatchInlineSnapshot(`"15/03/2026, 13:45"`);
    });

    it('applies the formatter time zone', () => {
        const beirut = createFormatter({ locale: 'en-GB', timeZone: 'Asia/Beirut' });
        const utc = createFormatter({ locale: 'en-GB', timeZone: 'UTC' });
        expect(beirut.formatDate(REFERENCE, { timeStyle: 'short' })).not.toBe(
            utc.formatDate(REFERENCE, { timeStyle: 'short' }),
        );
    });

    it('accepts ISO strings and epoch milliseconds', () => {
        const formatter = createFormatter({ locale: 'en-GB', timeZone: 'UTC' });
        const expected = formatter.formatDate(REFERENCE, { dateStyle: 'medium' });
        expect(formatter.formatDate('2026-03-15T13:45:00.000Z', { dateStyle: 'medium' })).toBe(
            expected,
        );
        expect(formatter.formatDate(REFERENCE.getTime(), { dateStyle: 'medium' })).toBe(expected);
    });

    it('rejects unparseable input rather than rendering "Invalid Date"', () => {
        const formatter = createFormatter({ locale: 'en-GB' });
        expect(() => formatter.formatDate('not a date')).toThrow(/Not a valid date/);
    });

    it('keeps Arabic dates on the configured numbering system', () => {
        const latin = createFormatter({ locale: 'ar-SA', timeZone: 'UTC' });
        const arabic = createFormatter({
            locale: 'ar-SA',
            timeZone: 'UTC',
            numberingSystem: 'arab',
        });
        expect(latin.formatDate(REFERENCE, { dateStyle: 'short' })).toMatch(LATIN_DIGITS);
        expect(arabic.formatDate(REFERENCE, { dateStyle: 'short' })).toMatch(ARABIC_INDIC_DIGITS);
    });
});

describe('formatRelativeTime', () => {
    const formatter = createFormatter({ locale: 'en-GB' });

    it('picks the largest sensible unit', () => {
        const now = REFERENCE;
        expect(
            formatter.formatRelativeTime(new Date(now.getTime() - 3 * 24 * 3600_000), now),
        ).toMatchInlineSnapshot(`"3 days ago"`);
        expect(
            formatter.formatRelativeTime(new Date(now.getTime() + 2 * 3600_000), now),
        ).toMatchInlineSnapshot(`"in 2 hours"`);
        expect(
            formatter.formatRelativeTime(new Date(now.getTime() - 45 * 1000), now),
        ).toMatchInlineSnapshot(`"45 seconds ago"`);
        expect(
            formatter.formatRelativeTime(new Date(now.getTime() - 400 * 24 * 3600_000), now),
        ).toMatchInlineSnapshot(`"last year"`);
    });

    it('reads "now" for the present instant', () => {
        expect(formatter.formatRelativeTime(REFERENCE, REFERENCE)).toMatchInlineSnapshot(`"now"`);
    });

    it('produces Arabic phrasing with the configured digits', () => {
        const latin = createFormatter({ locale: 'ar' });
        const arabic = createFormatter({ locale: 'ar', numberingSystem: 'arab' });
        const past = new Date(REFERENCE.getTime() - 3 * 24 * 3600_000);

        expect(latin.formatRelativeTime(past, REFERENCE)).toMatch(LATIN_DIGITS);
        expect(latin.formatRelativeTime(past, REFERENCE)).toMatch(/[؀-ۿ]/);
        expect(arabic.formatRelativeTime(past, REFERENCE)).toMatch(ARABIC_INDIC_DIGITS);
    });

    it('defaults the reference point to the current instant', () => {
        expect(formatter.formatRelativeTime(new Date(Date.now() - 5000))).toContain('seconds ago');
    });

    // `UNKNOWN_ISO_DATE_TIME`. Throwing here took out whole kitchen routes over one null timestamp.
    it('answers the unknown-timestamp sentinel with nothing, and still refuses rubbish', () => {
        expect(formatter.formatRelativeTime('')).toBe('');
        expect(formatter.formatDate('')).toBe('');
        expect(() => formatter.formatRelativeTime('not a date')).toThrow(TypeError);
    });
});
