import { screen } from '@testing-library/react-native';

import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { ICON_GLYPHS, Icon, resolveIconGlyph } from './icon.tsx';

describe('resolveIconGlyph', () => {
    it('mirrors the directional chevrons by swapping the character, not a style', () => {
        expect(resolveIconGlyph('chevronEnd', false)).toBe(ICON_GLYPHS.chevronForward);
        expect(resolveIconGlyph('chevronEnd', true)).toBe(ICON_GLYPHS.chevronBackward);
        expect(resolveIconGlyph('chevronStart', false)).toBe(ICON_GLYPHS.chevronBackward);
        expect(resolveIconGlyph('chevronStart', true)).toBe(ICON_GLYPHS.chevronForward);
    });

    it('leaves non-directional icons alone in both directions', () => {
        for (const isRtl of [false, true]) {
            expect(resolveIconGlyph('check', isRtl)).toBe(ICON_GLYPHS.check);
            expect(resolveIconGlyph('menu', isRtl)).toBe(ICON_GLYPHS.menu);
        }
    });

    it('has a distinct glyph for every name', () => {
        const glyphs = Object.values(ICON_GLYPHS);
        expect(new Set(glyphs).size).toBe(glyphs.length);
    });
});

describe('Icon', () => {
    it('is hidden from assistive technology when it has no label', async () => {
        await renderWithI18n(<Icon testID="decorative" name="check" />);
        const node = screen.getByTestId('decorative');

        expect(node.props['aria-hidden']).toBe(true);
        expect(node.props.accessibilityElementsHidden).toBe(true);
        expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
        expect(node.props.accessibilityLabel).toBeUndefined();
    });

    it('becomes an image with a name when it carries the meaning itself', async () => {
        await renderWithI18n(<Icon testID="meaningful" name="warning" label="Suspended" />);
        const node = screen.getByTestId('meaningful');

        expect(node.props['aria-hidden']).toBe(false);
        expect(node.props.accessibilityRole).toBe('image');
        expect(node.props.accessibilityLabel).toBe('Suspended');
    });

    it('renders the forward chevron in English', async () => {
        await renderWithI18n(<Icon testID="chev" name="chevronEnd" />, 'en');
        expect(screen.getByTestId('chev')).toHaveTextContent(ICON_GLYPHS.chevronForward);
    });

    it('renders the backward chevron in Arabic', async () => {
        await renderWithI18n(<Icon testID="chev" name="chevronEnd" />, 'ar');
        expect(screen.getByTestId('chev')).toHaveTextContent(ICON_GLYPHS.chevronBackward);
    });

    it('uses no physical direction utility', async () => {
        await renderWithI18n(<Icon testID="logical" name="chevronEnd" />);
        assertSubtreeIsLogical(screen.getByTestId('logical'));
    });
});

/**
 * Glyph coverage.
 *
 * Nothing in the application sets a `fontFamily` on text, so an icon renders in the platform's
 * default font and whatever that falls back to. A codepoint the platform cannot draw is a tofu box,
 * and this set once shipped four that were likely to be one — including a BLACK DRAUGHTS KING
 * standing in for the basket in the marketplace top bar.
 *
 * This is an explicit reviewed list rather than a codepoint-*range* check, and the difference
 * matters. A range rule looks right and is not: measured against the fonts this repository ships,
 * `star` U+2605 and `warning` U+26A0 are Miscellaneous Symbols and present, while `close` U+2715,
 * `success` U+2714 and `more` U+22EF sit in blocks usually called safe and are absent. Coverage
 * belongs to the codepoint, not the block, so a range check would wave through characters nothing
 * can draw while flagging characters that are fine.
 *
 * Adding an icon therefore means adding a line here, with its Unicode name written out. That is the
 * whole mechanism: the question gets asked once, deliberately, by somebody who can go and look —
 * rather than being discovered by a user on a phone the team does not own.
 */
describe('glyph repertoire', () => {
    /** Every glyph, with the name of the character it must remain. Reviewed 2026-08-25. */
    const REVIEWED: Readonly<Record<keyof typeof ICON_GLYPHS, string>> = {
        chevronForward: 'SINGLE RIGHT-POINTING ANGLE QUOTATION MARK',
        chevronBackward: 'SINGLE LEFT-POINTING ANGLE QUOTATION MARK',
        chevronDown: 'DOWN ARROWHEAD',
        chevronUp: 'UP ARROWHEAD',
        check: 'CHECK MARK',
        close: 'MULTIPLICATION X',
        plus: 'PLUS SIGN',
        minus: 'MINUS SIGN',
        eye: 'FISHEYE',
        eyeOff: 'DOTTED CIRCLE',
        warning: 'WARNING SIGN',
        info: 'CIRCLED LATIN SMALL LETTER I',
        error: 'HEAVY MULTIPLICATION X',
        success: 'HEAVY CHECK MARK',
        offline: 'CIRCLED DIVISION SLASH',
        menu: 'TRIGRAM FOR HEAVEN',
        search: 'TELEPHONE RECORDER',
        user: 'CIRCLE WITH VERTICAL FILL',
        device: 'WHITE RECTANGLE',
        organisation: 'WHITE DIAMOND CONTAINING BLACK SMALL DIAMOND',
        branch: 'WHITE DIAMOND',
        signOut: 'RIGHTWARDS ARROW TO BAR',
        refresh: 'CLOCKWISE GAPPED CIRCLE ARROW',
        prototype: 'LOZENGE',
        dot: 'BULLET',
        dotOutline: 'WHITE BULLET',
        star: 'BLACK STAR',
        starOutline: 'WHITE STAR',
        filter: 'WHITE DOWN-POINTING TRIANGLE',
        calendar: 'SQUARE WITH HORIZONTAL FILL',
        more: 'MIDLINE HORIZONTAL ELLIPSIS',
        basket: 'WHITE SQUARE CONTAINING BLACK SMALL SQUARE',
        home: 'HOUSE',
        plate: 'LARGE CIRCLE',
        lock: 'CIRCLED TIMES',
        leaf: 'BLACK CLUB SUIT',
        medicalCross: 'HEAVY GREEK CROSS',
        sparkle: 'WHITE FOUR POINTED STAR',
        sun: 'BLACK SUN WITH RAYS',
        moon: 'LAST QUARTER MOON',
    };

    it('has a reviewed entry for every glyph, and no entry without one', () => {
        expect(Object.keys(ICON_GLYPHS).sort()).toEqual(Object.keys(REVIEWED).sort());
    });

    it.each(Object.keys(ICON_GLYPHS) as Array<keyof typeof ICON_GLYPHS>)(
        '%s is still the character it was reviewed as',
        (name) => {
            // `String.prototype.normalize` is not the check — the point is that the *codepoint*
            // has not been swapped for a lookalike from a block nobody vetted.
            expect(ICON_GLYPHS[name].codePointAt(0)).toBe(
                CODEPOINT_BY_UNICODE_NAME[REVIEWED[name]],
            );
        },
    );

    // Per glyph rather than in a loop, so a failure names the offender in its title. Jest's
    // `expect` takes no message argument, unlike the Vitest suites elsewhere in the workspace.
    it.each(Object.keys(ICON_GLYPHS) as Array<keyof typeof ICON_GLYPHS>)(
        '%s is a single basic-plane codepoint',
        (name) => {
            const glyph = ICON_GLYPHS[name];
            // One codepoint, so `slice`, `length` and layout all behave. Above U+FFFF means a
            // surrogate pair, which is also where the emoji planes start.
            expect([...glyph]).toHaveLength(1);
            expect(glyph.codePointAt(0)).toBeLessThan(0x1_0000);
        },
    );

    it.each(Object.keys(ICON_GLYPHS) as Array<keyof typeof ICON_GLYPHS>)(
        '%s carries no emoji presentation, so the set stays monochrome',
        (name) => {
            // A variation selector would ask the platform for the colour emoji form, which would
            // sit very oddly beside thirty-seven line-art characters.
            expect(/[︎️]/.test(ICON_GLYPHS[name])).toBe(false);
        },
    );
});

/**
 * The codepoints behind the reviewed names.
 *
 * Written out rather than derived, because deriving them would need a Unicode name database at test
 * time — and the value of this table is precisely that a human typed the name next to the number.
 */
const CODEPOINT_BY_UNICODE_NAME: Readonly<Record<string, number>> = {
    'SINGLE RIGHT-POINTING ANGLE QUOTATION MARK': 0x203a,
    'SINGLE LEFT-POINTING ANGLE QUOTATION MARK': 0x2039,
    'DOWN ARROWHEAD': 0x2304,
    'UP ARROWHEAD': 0x2303,
    'CHECK MARK': 0x2713,
    'MULTIPLICATION X': 0x2715,
    'PLUS SIGN': 0x002b,
    'MINUS SIGN': 0x2212,
    FISHEYE: 0x25c9,
    'DOTTED CIRCLE': 0x25cc,
    'WARNING SIGN': 0x26a0,
    'CIRCLED LATIN SMALL LETTER I': 0x24d8,
    'HEAVY MULTIPLICATION X': 0x2716,
    'HEAVY CHECK MARK': 0x2714,
    'CIRCLED DIVISION SLASH': 0x2298,
    'TRIGRAM FOR HEAVEN': 0x2630,
    'TELEPHONE RECORDER': 0x2315,
    'CIRCLE WITH VERTICAL FILL': 0x25cd,
    'WHITE RECTANGLE': 0x25ad,
    'WHITE DIAMOND CONTAINING BLACK SMALL DIAMOND': 0x25c8,
    'WHITE DIAMOND': 0x25c7,
    'RIGHTWARDS ARROW TO BAR': 0x21e5,
    'CLOCKWISE GAPPED CIRCLE ARROW': 0x27f3,
    LOZENGE: 0x25ca,
    BULLET: 0x2022,
    'WHITE BULLET': 0x25e6,
    'BLACK STAR': 0x2605,
    'WHITE STAR': 0x2606,
    'WHITE DOWN-POINTING TRIANGLE': 0x25bd,
    'SQUARE WITH HORIZONTAL FILL': 0x25a4,
    'MIDLINE HORIZONTAL ELLIPSIS': 0x22ef,
    'WHITE SQUARE CONTAINING BLACK SMALL SQUARE': 0x25a3,
    HOUSE: 0x2302,
    'LARGE CIRCLE': 0x25ef,
    'CIRCLED TIMES': 0x2297,
    'BLACK CLUB SUIT': 0x2663,
    'HEAVY GREEK CROSS': 0x271a,
    'WHITE FOUR POINTED STAR': 0x2727,
    'BLACK SUN WITH RAYS': 0x2600,
    'LAST QUARTER MOON': 0x263e,
};
