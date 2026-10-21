import { ModuleBars } from './production-desk/gs1-barcode.tsx';

/**
 * An EAN-13 — the symbology a kitchen code (GS1 RCN prefix 04) is printed in, and one any scanner
 * reads (ingredient barcodes, plan §8).
 *
 * 95 modules of symbol: guard `101`, six left digits in L or G patterns (which of the two encodes
 * the first digit), centre guard `01010`, six right digits in R patterns, guard `101`. Quiet zones
 * of 11 modules before and 7 after, so the symbol prints about 42.4 × 26 mm. Web only, like the
 * GS1-128 renderer it shares its bars with.
 */

/**
 * Calibration knob: one module, in millimetres — 3 dots at 203 dpi, 114 % of GS1's 0.330 mm
 * nominal. If a printer's real margins break the 58 × 40 mm label, this is the knob, never a
 * shorter bar.
 */
export const EAN13_MODULE_MM = 0.375;

/** Calibration knob: bar height — GS1's 22.85 mm at 0.330 mm, scaled to the module above. */
export const EAN13_BAR_HEIGHT_MM = 26;

const QUIET_LEFT = 11;
const QUIET_RIGHT = 7;

/** L patterns by digit; R is each one inverted, G is R reversed. */
const L_PATTERNS = [
    '0001101',
    '0011001',
    '0010011',
    '0111101',
    '0100011',
    '0110001',
    '0101111',
    '0111011',
    '0110111',
    '0001011',
];

/** Which of the six left digits use G rather than L, by the first digit. */
const PARITY = [
    'LLLLLL',
    'LLGLGG',
    'LLGGLG',
    'LLGGGL',
    'LGLLGG',
    'LGGLLG',
    'LGGGLL',
    'LGLGLG',
    'LGLGGL',
    'LGGLGL',
];

function invert(pattern: string): string {
    return [...pattern].map((bit) => (bit === '1' ? '0' : '1')).join('');
}

/** The GS1 mod-10 check digit over `body`, weights 3, 1, 3, … from the right. */
export function gs1CheckDigit(body: string): number {
    const sum = [...body]
        .reverse()
        .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10;
}

/** One entry per module, `true` for bar, quiet zones included. Throws on anything but a valid EAN-13. */
export function ean13Modules(digits: string): readonly boolean[] {
    if (!/^\d{13}$/.test(digits) || gs1CheckDigit(digits.slice(0, 12)) !== Number(digits[12])) {
        throw new Error(
            `An EAN-13 needs thirteen digits and a valid check digit, got "${digits}".`,
        );
    }

    const values = [...digits].map(Number);
    const parity = PARITY[values[0] ?? 0] ?? 'LLLLLL';
    const left = values.slice(1, 7).map((digit, index) => {
        const l = L_PATTERNS[digit] ?? '';
        return parity[index] === 'G' ? [...invert(l)].reverse().join('') : l;
    });
    const right = values.slice(7).map((digit) => invert(L_PATTERNS[digit] ?? ''));

    const pattern =
        '0'.repeat(QUIET_LEFT) +
        '101' +
        left.join('') +
        '01010' +
        right.join('') +
        '101' +
        '0'.repeat(QUIET_RIGHT);

    return [...pattern].map((bit) => bit === '1');
}

export interface Ean13BarcodeProps {
    /** Thirteen digits, check digit included. */
    readonly value: string;
}

export function Ean13Barcode({ value }: Ean13BarcodeProps) {
    return (
        <ModuleBars
            modules={ean13Modules(value)}
            moduleMm={EAN13_MODULE_MM}
            heightMm={EAN13_BAR_HEIGHT_MM}
        />
    );
}
