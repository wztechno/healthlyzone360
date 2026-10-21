import { ean13Modules, gs1CheckDigit } from './ean13-barcode.tsx';

/**
 * The EAN-13 encoder, against GS1's own worked example 4006381333931 (first digit 4 → parity
 * LGLLGG). The only independent check of the bars themselves is a scanner reading a printed label.
 */

const SYMBOL =
    '101' +
    ['0001101', '0100111', '0101111', '0111101', '0001001', '0110011'].join('') +
    '01010' +
    ['1000010', '1000010', '1000010', '1110100', '1000010', '1100110'].join('') +
    '101';

describe('EAN-13', () => {
    it('encodes the GS1 vector with its parity, guards and quiet zones', () => {
        const modules = ean13Modules('4006381333931')
            .map((bar) => (bar ? '1' : '0'))
            .join('');

        expect(modules).toHaveLength(11 + 95 + 7);
        expect(modules.slice(0, 11)).toBe('0'.repeat(11));
        expect(modules.slice(11, 106)).toBe(SYMBOL);
        expect(modules.slice(106)).toBe('0'.repeat(7));
    });

    it('computes the check digit of the first kitchen code', () => {
        expect(gs1CheckDigit('040000000001')).toBe(5);
        expect(gs1CheckDigit('400638133393')).toBe(1);
    });

    it('refuses a wrong check digit or a wrong length rather than draw it', () => {
        expect(() => ean13Modules('4006381333932')).toThrow();
        expect(() => ean13Modules('400638133393')).toThrow();
    });
});
