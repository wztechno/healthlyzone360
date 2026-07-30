import { describe, expect, it } from 'vitest';

import { COLOUR_STOPS, NUTRITION_LEVELS, RAMPS, SEMANTIC_ROLES, THEMES, themes } from './colour.ts';
import type { SemanticRole, ThemeName } from './colour.ts';
import {
    WCAG_AA_NON_TEXT,
    WCAG_AA_NORMAL_TEXT,
    contrastRatio,
    formatContrast,
    hexToRgb,
    isHexColour,
    relativeLuminance,
} from './contrast.ts';

describe('relative luminance and contrast (WCAG 2.2)', () => {
    it('anchors on the reference values', () => {
        expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
        expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6);
        expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 10);
    });

    it('matches a hand-checked mid-grey (#767676 is the classic 4.54:1 on white)', () => {
        expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
    });

    it('is symmetric', () => {
        expect(contrastRatio('#3f7a6f', '#ffffff')).toBeCloseTo(
            contrastRatio('#ffffff', '#3f7a6f'),
            10,
        );
    });

    it('expands shorthand hex and rejects malformed input', () => {
        expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
        expect(hexToRgb('#2F6157')).toEqual({ r: 47, g: 97, b: 87 });
        expect(isHexColour('#12345')).toBe(false);
        expect(() => hexToRgb('rgb(0,0,0)')).toThrow(/Not a hex colour/);
    });

    it('formats ratios for assertion messages', () => {
        expect(formatContrast(4.5039)).toBe('4.5:1');
    });
});

/**
 * The accessibility budget. Every semantic foreground/background pair that ships must clear WCAG AA
 * for normal text in *both* themes — this is the test that stops a palette tweak quietly breaking
 * legibility.
 */
describe('semantic colour pairs meet WCAG AA for normal text', () => {
    const pairs: Array<[ThemeName, SemanticRole, string, string, string]> = [];
    for (const theme of THEMES) {
        for (const role of SEMANTIC_ROLES) {
            const set = themes[theme].semantic[role];
            pairs.push([theme, role, 'onSubtle/subtle', set.onSubtle, set.subtle]);
            pairs.push([theme, role, 'onDefault/default', set.onDefault, set.default]);
            pairs.push([theme, role, 'onStrong/strong', set.onStrong, set.strong]);
        }
    }

    it('covers all 24 semantic pairs (2 themes × 4 roles × 3 slots)', () => {
        expect(pairs).toHaveLength(24);
    });

    it.each(pairs)('%s %s %s', (_theme, _role, _slot, foreground, background) => {
        const ratio = contrastRatio(foreground, background);
        expect(
            ratio,
            `${foreground} on ${background} is only ${formatContrast(ratio)}`,
        ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });
});

describe('surface and text pairs meet WCAG AA for normal text', () => {
    const pairs: Array<[ThemeName, string, string, string]> = [];
    for (const theme of THEMES) {
        const c = themes[theme].colours;
        for (const surface of ['surfaceBase', 'surfaceRaised', 'surfaceSunken'] as const) {
            pairs.push([theme, `textPrimary/${surface}`, c.textPrimary, c[surface]]);
            pairs.push([theme, `textSecondary/${surface}`, c.textSecondary, c[surface]]);
        }
        pairs.push([theme, 'textInverse/surfaceInverse', c.textInverse, c.surfaceInverse]);
        pairs.push([theme, 'textOnBrand/brandSurface', c.textOnBrand, c.brandSurface]);
        pairs.push([
            theme,
            'onBrandSurfaceSubtle/brandSurfaceSubtle',
            c.onBrandSurfaceSubtle,
            c.brandSurfaceSubtle,
        ]);
        pairs.push([theme, 'onAccentSurface/accentSurface', c.onAccentSurface, c.accentSurface]);
    }

    it.each(pairs)('%s %s', (_theme, _label, foreground, background) => {
        const ratio = contrastRatio(foreground, background);
        expect(ratio, `only ${formatContrast(ratio)}`).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });
});

describe('non-text contrast (WCAG 1.4.11, 3:1)', () => {
    const pairs: Array<[ThemeName, string, string, string]> = [];
    for (const theme of THEMES) {
        const c = themes[theme].colours;
        pairs.push([theme, 'borderStrong/surfaceBase', c.borderStrong, c.surfaceBase]);
        pairs.push([theme, 'focusRing/surfaceBase', c.focusRing, c.surfaceBase]);
        for (const role of SEMANTIC_ROLES) {
            pairs.push([
                theme,
                `${role}.border/surfaceBase`,
                themes[theme].semantic[role].border,
                c.surfaceBase,
            ]);
        }
    }

    it.each(pairs)('%s %s', (_theme, _label, foreground, background) => {
        const ratio = contrastRatio(foreground, background);
        expect(ratio, `only ${formatContrast(ratio)}`).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
    });

    it('keeps hairline dividers visible without pretending they are UI boundaries', () => {
        // borderSubtle/borderDefault are decorative separators (WCAG 1.4.11 does not apply); they must
        // still be perceptible against their surface.
        for (const theme of THEMES) {
            const c = themes[theme].colours;
            expect(contrastRatio(c.borderSubtle, c.surfaceBase)).toBeGreaterThan(1.05);
            expect(contrastRatio(c.borderDefault, c.surfaceBase)).toBeGreaterThan(1.2);
        }
    });
});

describe('nutrition scale', () => {
    it('has five ordered stops with unique ordinals', () => {
        expect([...NUTRITION_LEVELS]).toEqual(['optimal', 'good', 'moderate', 'high', 'excessive']);
        for (const theme of THEMES) {
            const ordinals = NUTRITION_LEVELS.map(
                (level) => themes[theme].nutrition[level].ordinal,
            );
            expect(ordinals).toEqual([1, 2, 3, 4, 5]);
        }
    });

    it('never conveys meaning by colour alone — every stop has a distinct pattern', () => {
        for (const theme of THEMES) {
            const patterns = NUTRITION_LEVELS.map(
                (level) => themes[theme].nutrition[level].pattern,
            );
            expect(new Set(patterns).size).toBe(NUTRITION_LEVELS.length);

            const patternIds = NUTRITION_LEVELS.map(
                (level) => themes[theme].nutrition[level].patternId,
            );
            expect(new Set(patternIds).size).toBe(NUTRITION_LEVELS.length);
        }
    });

    it('uses the same pattern for a given level in both themes', () => {
        for (const level of NUTRITION_LEVELS) {
            expect(themes.light.nutrition[level].pattern).toBe(
                themes.dark.nutrition[level].pattern,
            );
            expect(themes.light.nutrition[level].patternId).toBe(
                themes.dark.nutrition[level].patternId,
            );
        }
    });

    it('keeps every stop legible against its own foreground and visible on the page', () => {
        for (const theme of THEMES) {
            const surface = themes[theme].colours.surfaceBase;
            for (const level of NUTRITION_LEVELS) {
                const stop = themes[theme].nutrition[level];
                expect(
                    contrastRatio(stop.on, stop.colour),
                    `${theme}.${level} label`,
                ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
                expect(
                    contrastRatio(stop.colour, surface),
                    `${theme}.${level} fill`,
                ).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
            }
        }
    });
});

describe('ramps', () => {
    it('declare all eleven stops', () => {
        for (const [name, ramp] of Object.entries(RAMPS)) {
            expect(
                Object.keys(ramp)
                    .map(Number)
                    .sort((a, b) => a - b),
                name,
            ).toEqual([...COLOUR_STOPS]);
        }
    });

    it('are strictly monotonic — luminance decreases from 50 to 950', () => {
        for (const [name, ramp] of Object.entries(RAMPS)) {
            const luminances = COLOUR_STOPS.map((stop) => relativeLuminance(ramp[stop]));
            for (let index = 1; index < luminances.length; index += 1) {
                expect(
                    luminances[index]!,
                    `${name}: stop ${COLOUR_STOPS[index]} is not darker than ${COLOUR_STOPS[index - 1]}`,
                ).toBeLessThan(luminances[index - 1]!);
            }
        }
    });

    it('contain only valid six-digit hex colours', () => {
        for (const ramp of Object.values(RAMPS)) {
            for (const value of Object.values(ramp)) {
                expect(value).toMatch(/^#[0-9a-f]{6}$/);
            }
        }
    });

    it('span a usable range — the lightest stop is near-white and the darkest near-black', () => {
        for (const [name, ramp] of Object.entries(RAMPS)) {
            expect(relativeLuminance(ramp[50]), `${name}.50`).toBeGreaterThan(0.85);
            expect(relativeLuminance(ramp[950]), `${name}.950`).toBeLessThan(0.05);
        }
    });
});

describe('theme completeness', () => {
    it('defines the same keys in light and dark', () => {
        expect(Object.keys(themes.light.colours).sort()).toEqual(
            Object.keys(themes.dark.colours).sort(),
        );
        for (const role of SEMANTIC_ROLES) {
            expect(Object.keys(themes.light.semantic[role]).sort()).toEqual(
                Object.keys(themes.dark.semantic[role]).sort(),
            );
        }
    });

    it('inverts overall lightness between themes', () => {
        expect(relativeLuminance(themes.light.colours.surfaceBase)).toBeGreaterThan(0.8);
        expect(relativeLuminance(themes.dark.colours.surfaceBase)).toBeLessThan(0.05);
    });
});
