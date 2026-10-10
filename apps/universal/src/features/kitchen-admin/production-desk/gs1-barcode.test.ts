import { CODE128_PATTERNS, gs1128Modules, gs1128Symbols } from './gs1-barcode.tsx';

/**
 * The GS1-128 encoder. The vector was worked by hand in the plan (§3.3); the only independent check
 * of the bars themselves is a scanner reading a printed label.
 */

const FULL = '(11)260925(17)260930(10)2609250077';

function widths(pattern: string): number[] {
    return [...pattern].map(Number);
}

describe('GS1-128 symbols', () => {
    it('encodes the verified vector: Start C, FNC1, the pairs, checksum 81, Stop', () => {
        expect(gs1128Symbols(FULL)).toEqual([
            105, 102, 11, 26, 9, 25, 17, 26, 9, 30, 10, 26, 9, 25, 0, 77, 81, 106,
        ]);
    });

    it('refuses an odd run of digits or anything that is not a digit', () => {
        expect(() => gs1128Symbols('(10)123')).toThrow();
        expect(() => gs1128Symbols('(10)12AB')).toThrow();
    });
});

describe('GS1-128 modules', () => {
    it('is 200 modules of symbol and 220 with the quiet zones', () => {
        const modules = gs1128Modules(FULL);

        expect(modules).toHaveLength(220);
        expect(modules.slice(0, 10).some(Boolean)).toBe(false);
        expect(modules.slice(-10).some(Boolean)).toBe(false);
    });

    it('is 176 modules with quiet zones when there is no expiry', () => {
        expect(gs1128Modules('(11)260925(10)2609250077')).toHaveLength(176);
    });
});

describe('the Code 128 pattern table', () => {
    it('has 107 distinct entries, each 11 modules with an even bar total, and a 13-module stop', () => {
        expect(CODE128_PATTERNS).toHaveLength(107);
        expect(new Set(CODE128_PATTERNS).size).toBe(107);

        CODE128_PATTERNS.forEach((pattern, value) => {
            const run = widths(pattern);
            const total = run.reduce((sum, width) => sum + width, 0);
            const bars = run.filter((_, index) => index % 2 === 0).reduce((a, b) => a + b, 0);

            expect(total).toBe(value === 106 ? 13 : 11);
            expect(bars % 2).toBe(0);
        });
    });
});
