import { describe, expect, it } from 'vitest';

import {
    CONTROL_SIZES,
    ROW_DENSITIES,
    cardWidth,
    controlGap,
    controlHeight,
    controlHeightTouch,
    controlPaddingX,
    fieldWidth,
    iconSize,
    rowHeight,
    rowHeightTouch,
} from './control.ts';
import { MIN_TOUCH_TARGET, SPACING_BASE, spacing, spacingAliases } from './layout.ts';
import {
    SCRIPTS,
    TEXT_ROLE_NAMES,
    fontSizes,
    lineHeightMultipliers,
    textRoleLetterSpacing,
    textRoleLineHeight,
    textRoles,
} from './typography.ts';

/**
 * The Catalogue's density is one set of numbers, and these are the properties that keep it one
 * set rather than a pile of near-misses: every ladder covers every size name, rises, and stays on
 * the 2-point grid; and the coarse-pointer ladder never dips below the accessibility floor.
 */
describe('control geometry', () => {
    const ladders = {
        controlHeight,
        controlHeightTouch,
        controlPaddingX,
        controlGap,
        iconSize,
    } as const;

    it.each(Object.entries(ladders))('%s covers every control size', (_name, ladder) => {
        expect(Object.keys(ladder).sort()).toEqual([...CONTROL_SIZES].sort());
    });

    it.each(Object.entries(ladders))('%s never decreases as the size grows', (_name, ladder) => {
        const values = CONTROL_SIZES.map((size) => ladder[size]);

        expect(values).toEqual([...values].sort((a, b) => a - b));
    });

    it.each(Object.entries(ladders))('%s lands on the 2-point grid', (_name, ladder) => {
        for (const value of Object.values(ladder)) {
            expect(value % 2).toBe(0);
        }
    });

    /**
     * The invariant `CLAUDE.md` names, expressed as an equality rather than a comment.
     *
     * `handoff-claude-code.md` §1.1 asked for `MIN_TOUCH_TARGET` to be deleted and every control
     * flattened to 32px. It is kept instead, as the floor of the coarse-pointer ladder — the
     * reading `catalogue-redesign-plan.md` §3.1 proposed so both the compact brief and the
     * invariant hold. If someone lowers this table, this is the test that says so.
     */
    it('meets the touch minimum at the default size on a coarse pointer', () => {
        expect(controlHeightTouch.md).toBe(MIN_TOUCH_TARGET);
        expect(rowHeightTouch.md).toBe(MIN_TOUCH_TARGET);
    });

    it('is never shorter on a coarse pointer than on a fine one', () => {
        for (const size of CONTROL_SIZES) {
            expect(controlHeightTouch[size]).toBeGreaterThanOrEqual(controlHeight[size]);
        }

        for (const density of ROW_DENSITIES) {
            expect(rowHeightTouch[density]).toBeGreaterThanOrEqual(rowHeight[density]);
        }
    });

    it('keeps the compact brief on a fine pointer', () => {
        expect(controlHeight.sm).toBe(28);
        expect(controlHeight.md).toBe(32);
        expect(rowHeight.md).toBe(32);
    });
});

describe('row density', () => {
    it.each([rowHeight, rowHeightTouch])('covers every density', (ladder) => {
        expect(Object.keys(ladder).sort()).toEqual([...ROW_DENSITIES].sort());
    });

    /** A row is at least as tall as the control it holds, or the control overflows it. */
    it.each(ROW_DENSITIES)('the %s row clears the control it holds', (density) => {
        expect(rowHeight[density]).toBeGreaterThanOrEqual(controlHeight[density]);
    });
});

describe('fixed widths', () => {
    it('keeps the field width on the spacing grid', () => {
        expect(fieldWidth % SPACING_BASE).toBe(0);
    });

    it('bounds a card between its own min and max', () => {
        expect(cardWidth.min).toBeLessThan(cardWidth.max);
        expect(cardWidth.min % SPACING_BASE).toBe(0);
        expect(cardWidth.max % SPACING_BASE).toBe(0);
    });
});

describe('spacing aliases', () => {
    /** Aliases, not new values — every one has to already exist on the 4-point scale. */
    it('resolves every alias to a step of the scale', () => {
        const steps = new Set(Object.values(spacing));

        for (const value of Object.values(spacingAliases)) {
            expect(steps).toContain(value);
        }
    });

    it('orders the aliases from tightest to loosest', () => {
        const values = [
            spacingAliases.hair,
            spacingAliases.tight,
            spacingAliases.snug,
            spacingAliases.base,
            spacingAliases.loose,
        ];

        expect(values).toEqual([...values].sort((a, b) => a - b));
    });
});

describe('the Catalogue type ramp', () => {
    it('covers every role exactly once', () => {
        expect(Object.keys(textRoles).sort()).toEqual([...TEXT_ROLE_NAMES].sort());
    });

    it('never sets a line height below its own size', () => {
        for (const role of TEXT_ROLE_NAMES) {
            expect(textRoles[role].lineHeight).toBeGreaterThan(textRoles[role].size);
        }
    });

    it('rises from micro to display', () => {
        const sizes = TEXT_ROLE_NAMES.map((role) => textRoles[role].size);

        expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    });

    /**
     * The whole point of the ramp being additive: an admin role may not quietly redefine what a
     * screen outside the admin already renders.
     */
    it('leaves the numeric scale alone', () => {
        expect(fontSizes.base).toBe(16);
        expect(fontSizes.xs).toBe(12);
    });

    it('gives Arabic its own leading and Latin the tuned value', () => {
        for (const role of TEXT_ROLE_NAMES) {
            expect(textRoleLineHeight(role, 'latin')).toBe(textRoles[role].lineHeight);
            expect(textRoleLineHeight(role, 'arabic')).toBe(
                Math.round(textRoles[role].size * lineHeightMultipliers.arabic),
            );
        }
    });

    /**
     * Arabic is cursive: positive tracking separates letters that are joined in the script. The
     * two roles that carry it — `micro` column labels and `section` form headings — are both
     * translated, so this is enforced rather than remembered.
     */
    it('never gives Arabic positive tracking', () => {
        for (const role of TEXT_ROLE_NAMES) {
            expect(textRoleLetterSpacing(role, 'arabic')).toBeLessThanOrEqual(0);
        }
    });

    it('keeps Latin tracking as authored, in both directions', () => {
        expect(textRoleLetterSpacing('micro', 'latin')).toBeGreaterThan(0);
        expect(textRoleLetterSpacing('title', 'latin')).toBeLessThan(0);
        // Tightening does not break a cursive join, so it survives into Arabic.
        expect(textRoleLetterSpacing('title', 'arabic')).toBe(textRoles.title.letterSpacing);
    });

    it('resolves a tracking value for every role in every script', () => {
        for (const script of SCRIPTS) {
            for (const role of TEXT_ROLE_NAMES) {
                expect(Number.isFinite(textRoleLetterSpacing(role, script))).toBe(true);
            }
        }
    });
});
