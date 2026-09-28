import { createElement } from 'react';
import { Platform } from 'react-native';

/**
 * A GS1-128 barcode for a batch label — the element string the server builds, drawn as bars.
 *
 * ## Code 128 set C and FNC1, nothing else
 *
 * The payload is all digits — `(11)YYMMDD(17)YYMMDD(10)<ten-digit lot>` — so set C, which packs two
 * digits into each symbol, carries all of it and the label stays short (50 mm of bars at 0.25 mm).
 * No set switching, no set A or B tables: a string that does not strip to an even run of digits is a
 * caller's bug and throws rather than drawing something no scanner will read back.
 *
 * ## No FNC1 separator is ever needed
 *
 * (11) and (17) are fixed-length, and the one variable-length AI, (10), always comes last. A GS1
 * parser knows where a fixed field ends, and the end of the symbol ends the last one — so the only
 * FNC1 is the leading one that marks the symbol as GS1-128. Separators are what keyboard-wedge
 * scanners mangle, so not needing one is the point of the order.
 *
 * ## Web only
 *
 * The bars are one SVG `<path>`, and native has no SVG without `react-native-svg`, which this repo
 * does not take for one label (the `analytics-charts.tsx` precedent). Printing is web-only anyway
 * (D-103); on native the component renders nothing and the human-readable line beside it stands in.
 */

/**
 * Calibration knob: the narrowest bar, in millimetres. 0.25 mm is 2 dots on a 203 dpi head; a
 * 300 dpi head wants 0.254 (3 dots). Change it here and nowhere else.
 */
export const MODULE_MM = 0.25;

/** Calibration knob: how tall the bars print, in millimetres. */
export const BAR_HEIGHT_MM = 10;

/** Quiet zone either side, in modules — Code 128's minimum. */
const QUIET_ZONE = 10;

const START_C = 105;
const FNC1 = 102;
const STOP = 106;

/**
 * Code 128's bar/space widths, indexed by symbol value: bar, space, bar, space… Every entry is 11
 * modules with an even bar total; the stop (106) is 13. Exported for the test on the table itself.
 */
export const CODE128_PATTERNS: readonly string[] = (
    '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 ' +
    '122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 ' +
    '321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 ' +
    '211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 ' +
    '213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 ' +
    '121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 ' +
    '241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 ' +
    '412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 ' +
    '211214 211232 2331112'
).split(' ');

/**
 * The symbol values for an element string: Start C, FNC1, the digit pairs, the mod-103 check, Stop.
 *
 * Parentheses are the human-readable form's and are stripped. Throws unless what is left is an even
 * run of digits.
 */
export function gs1128Symbols(elementString: string): readonly number[] {
    const digits = elementString.replace(/[()]/g, '');
    if (!/^(\d\d)+$/.test(digits)) {
        throw new Error(`GS1-128 set C needs an even run of digits, got "${elementString}".`);
    }

    const data = [FNC1];
    for (let index = 0; index < digits.length; index += 2) {
        data.push(Number(digits.slice(index, index + 2)));
    }

    // Weighted by position, FNC1 first at 1; the start symbol counts once at weight 1.
    const check = data.reduce((sum, value, index) => sum + value * (index + 1), START_C) % 103;

    return [START_C, ...data, check, STOP];
}

/** One entry per module, `true` for bar: quiet zone, every symbol's widths, quiet zone. */
export function gs1128Modules(elementString: string): readonly boolean[] {
    const modules: boolean[] = Array<boolean>(QUIET_ZONE).fill(false);

    for (const symbol of gs1128Symbols(elementString)) {
        [...(CODE128_PATTERNS[symbol] ?? '')].forEach((width, index) => {
            for (let module = 0; module < Number(width); module += 1) modules.push(index % 2 === 0);
        });
    }

    for (let module = 0; module < QUIET_ZONE; module += 1) modules.push(false);

    return modules;
}

/** Each bar as `M x 0 h w v 1 h -w z`, in module units against a one-unit-tall viewBox. */
function barsPath(modules: readonly boolean[]): string {
    let path = '';
    let start = -1;

    modules.forEach((bar, index) => {
        if (bar && start < 0) start = index;
        const next = modules[index + 1] ?? false;
        if (bar && !next) {
            const width = index + 1 - start;
            path += `M${String(start)} 0h${String(width)}v1h-${String(width)}z`;
            start = -1;
        }
    });

    return path;
}

export interface Gs1BarcodeProps {
    /** The human-readable element string, e.g. `(11)260925(17)260930(10)2609250077`. */
    readonly value: string;
}

export function Gs1Barcode({ value }: Gs1BarcodeProps) {
    if (Platform.OS !== 'web') return null;

    const modules = gs1128Modules(value);

    return createElement(
        'svg',
        {
            width: `${String(modules.length * MODULE_MM)}mm`,
            height: `${String(BAR_HEIGHT_MM)}mm`,
            viewBox: `0 0 ${String(modules.length)} 1`,
            preserveAspectRatio: 'none',
            shapeRendering: 'crispEdges',
            fill: 'currentColor',
            'aria-hidden': true,
            style: { display: 'block' },
        },
        createElement('path', { d: barsPath(modules) }),
    );
}
