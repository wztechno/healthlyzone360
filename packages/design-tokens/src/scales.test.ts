import { describe, expect, it } from 'vitest';

import { ELEVATION_LEVELS, elevation, elevationRoles } from './elevation.ts';
import {
    BREAKPOINT_NAMES,
    MIN_TOUCH_TARGET,
    RADIUS_NAMES,
    SPACING_BASE,
    SPACING_STEPS,
    breakpoints,
    radius,
    spacing,
    zIndex,
} from './layout.ts';
import {
    DURATION_NAMES,
    MAX_STAGGERED_ITEMS,
    MOTION_DISTANCE_NAMES,
    STAGGER_STEP_MS,
    durations,
    durationsFor,
    easings,
    motionDistances,
    motionDistancesFor,
    reducedDurations,
    reducedMotionDistances,
    staggerDelay,
} from './motion.ts';
import {
    DISPLAY_SIZE_THRESHOLD,
    FONT_SIZE_NAMES,
    displayLineHeightMultipliers,
    fontFamilies,
    fontSizes,
    lineHeightFor,
    lineHeights,
    lineHeightMultipliers,
    scriptForLocale,
} from './typography.ts';

describe('spacing', () => {
    it('is a strict 4-point scale', () => {
        expect(SPACING_BASE).toBe(4);
        for (const step of SPACING_STEPS) {
            expect(spacing[`${step}`]).toBe(step * SPACING_BASE);
        }
    });

    it('is monotonically increasing', () => {
        const values = SPACING_STEPS.map((step) => spacing[`${step}`]);
        for (let index = 1; index < values.length; index += 1) {
            expect(values[index]!).toBeGreaterThan(values[index - 1]!);
        }
    });

    it('produces whole pixels at every step', () => {
        for (const value of Object.values(spacing)) {
            expect(Number.isInteger(value)).toBe(true);
        }
    });
});

describe('radius', () => {
    it('declares every name and increases monotonically up to `full`', () => {
        expect(Object.keys(radius)).toEqual([...RADIUS_NAMES]);
        const ordered = RADIUS_NAMES.filter((name) => name !== 'full').map((name) => radius[name]);
        for (let index = 1; index < ordered.length; index += 1) {
            expect(ordered[index]!).toBeGreaterThan(ordered[index - 1]!);
        }
        expect(radius.full).toBeGreaterThan(radius['2xl']);
        expect(radius.none).toBe(0);
    });
});

describe('breakpoints', () => {
    it('are mobile-first and increase monotonically from zero', () => {
        expect(Object.keys(breakpoints)).toEqual([...BREAKPOINT_NAMES]);
        expect(breakpoints.xs).toBe(0);
        const values = BREAKPOINT_NAMES.map((name) => breakpoints[name]);
        for (let index = 1; index < values.length; index += 1) {
            expect(values[index]!).toBeGreaterThan(values[index - 1]!);
        }
        expect(values).toEqual([0, 480, 768, 1024, 1280]);
    });
});

describe('z-index', () => {
    it('orders overlays above content and tooltips above everything', () => {
        expect(zIndex.base).toBeLessThan(zIndex.sticky);
        expect(zIndex.sticky).toBeLessThan(zIndex.drawer);
        expect(zIndex.drawer).toBeLessThan(zIndex.dialog);
        expect(zIndex.dialog).toBeLessThan(zIndex.toast);
        expect(zIndex.toast).toBeLessThan(zIndex.tooltip);
    });
});

describe('typography', () => {
    it('runs the size scale from 12 to 48 without repeats', () => {
        const values = FONT_SIZE_NAMES.map((name) => fontSizes[name]);
        expect(values).toEqual([12, 14, 16, 18, 20, 24, 30, 36, 48]);
        for (let index = 1; index < values.length; index += 1) {
            expect(values[index]!).toBeGreaterThan(values[index - 1]!);
        }
    });

    it('gives Arabic more vertical room than Latin at every body size', () => {
        expect(lineHeightMultipliers.latin).toBe(1.5);
        expect(lineHeightMultipliers.arabic).toBe(1.75);
        for (const name of FONT_SIZE_NAMES) {
            if (fontSizes[name] >= DISPLAY_SIZE_THRESHOLD) continue;
            expect(lineHeights.arabic[name], name).toBeGreaterThan(lineHeights.latin[name]);
        }
    });

    it('tightens display sizes but still favours Arabic', () => {
        expect(displayLineHeightMultipliers.latin).toBeLessThan(lineHeightMultipliers.latin);
        expect(displayLineHeightMultipliers.arabic).toBeLessThan(lineHeightMultipliers.arabic);
        expect(lineHeightFor('5xl', 'arabic')).toBeGreaterThan(lineHeightFor('5xl', 'latin'));
    });

    it('rounds line heights to whole pixels', () => {
        for (const script of ['latin', 'arabic'] as const) {
            for (const name of FONT_SIZE_NAMES) {
                expect(Number.isInteger(lineHeights[script][name]), `${script}.${name}`).toBe(true);
                expect(lineHeights[script][name]).toBeGreaterThanOrEqual(fontSizes[name]);
            }
        }
    });

    it('maps locales to the right script', () => {
        expect(scriptForLocale('en')).toBe('latin');
        expect(scriptForLocale('en-GB')).toBe('latin');
        expect(scriptForLocale('ar')).toBe('arabic');
        expect(scriptForLocale('ar-SA')).toBe('arabic');
        expect(scriptForLocale('AR-EG')).toBe('arabic');
        expect(scriptForLocale('en-XA')).toBe('latin');
    });

    it('names one font per weight for both scripts and keeps a web fallback stack', () => {
        for (const script of ['latin', 'arabic'] as const) {
            const family = fontFamilies[script];
            expect(
                new Set([family.regular, family.medium, family.semibold, family.bold]).size,
            ).toBe(4);
            expect(family.stack).toContain('sans-serif');
        }
        expect(fontFamilies.arabic.stack).toContain('IBM Plex Sans Arabic');
        expect(fontFamilies.latin.stack).toContain('Inter');
    });
});

describe('elevation', () => {
    it('declares six levels', () => {
        expect([...ELEVATION_LEVELS]).toEqual([0, 1, 2, 3, 4, 5]);
        expect(Object.keys(elevation).map(Number)).toEqual([...ELEVATION_LEVELS]);
    });

    it('emits both a native shadow object and a web box-shadow string for each level', () => {
        for (const level of ELEVATION_LEVELS) {
            const token = elevation[level];
            expect(token.level).toBe(level);
            expect(typeof token.web).toBe('string');
            expect(token.native.shadowColor).toMatch(/^#[0-9a-f]{6}$/);
            expect(token.native.shadowOffset.width).toBe(0);
        }
    });

    it('increases in strength monotonically', () => {
        for (let index = 1; index < ELEVATION_LEVELS.length; index += 1) {
            const previous = elevation[ELEVATION_LEVELS[index - 1]!];
            const current = elevation[ELEVATION_LEVELS[index]!];
            expect(current.native.shadowOffset.height).toBeGreaterThan(
                previous.native.shadowOffset.height,
            );
            expect(current.native.shadowRadius).toBeGreaterThan(previous.native.shadowRadius);
            expect(current.native.shadowOpacity).toBeGreaterThan(previous.native.shadowOpacity);
            expect(current.native.elevation).toBeGreaterThan(previous.native.elevation);
        }
    });

    it('renders level 0 as no shadow on either platform', () => {
        expect(elevation[0].web).toBe('none');
        expect(elevation[0].native.shadowOpacity).toBe(0);
        expect(elevation[0].native.elevation).toBe(0);
    });

    it('maps every semantic role to a declared level', () => {
        for (const [role, level] of Object.entries(elevationRoles)) {
            expect(ELEVATION_LEVELS, role).toContain(level);
        }
        expect(elevationRoles.dialog).toBeGreaterThan(elevationRoles.card);
    });
});

describe('motion', () => {
    it('zeroes every duration under reduced motion', () => {
        for (const name of DURATION_NAMES) {
            expect(reducedDurations[name], name).toBe(0);
        }
        expect(durationsFor(true)).toBe(reducedDurations);
        expect(durationsFor(false)).toBe(durations);
    });

    it('increases duration monotonically', () => {
        const values = DURATION_NAMES.map((name) => durations[name]);
        for (let index = 1; index < values.length; index += 1) {
            expect(values[index]!).toBeGreaterThan(values[index - 1]!);
        }
    });

    it('pairs every easing bezier with an equivalent CSS string', () => {
        for (const [name, token] of Object.entries(easings)) {
            expect(token.bezier, name).toHaveLength(4);
            expect(token.css).toBe(`cubic-bezier(${token.bezier.join(', ')})`);
        }
    });

    it('zeroes every travel distance under reduced motion', () => {
        for (const name of MOTION_DISTANCE_NAMES) {
            expect(reducedMotionDistances[name], name).toBe(0);
        }
        expect(motionDistancesFor(true)).toBe(reducedMotionDistances);
        expect(motionDistancesFor(false)).toBe(motionDistances);
    });

    it('increases travel distance monotonically from zero', () => {
        const values = MOTION_DISTANCE_NAMES.map((name) => motionDistances[name]);
        expect(values[0]).toBe(0);
        for (let index = 1; index < values.length; index += 1) {
            expect(values[index]!).toBeGreaterThan(values[index - 1]!);
        }
    });

    /** An uncapped stagger turns a long planner week into a wait rather than a flourish. */
    it('caps the stagger so a long list never queues behind an ever-growing delay', () => {
        expect(staggerDelay(0)).toBe(0);
        expect(staggerDelay(1)).toBe(STAGGER_STEP_MS);
        const capped = (MAX_STAGGERED_ITEMS - 1) * STAGGER_STEP_MS;
        expect(staggerDelay(MAX_STAGGERED_ITEMS - 1)).toBe(capped);
        expect(staggerDelay(200)).toBe(capped);
    });

    it('removes the stagger entirely under reduced motion', () => {
        expect(staggerDelay(5, true)).toBe(0);
    });
});

describe('touch targets', () => {
    it('meets the 44dp minimum', () => {
        expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
    });
});
