import { NUTRITION_LEVELS, RAMPS, SEMANTIC_ROLES } from '../colour.ts';
import { ELEVATION_LEVELS, elevation } from '../elevation.ts';
import { breakpoints, focusRing, MIN_TOUCH_TARGET, radius, spacing, zIndex } from '../layout.ts';
import { DURATION_NAMES, durations, easings } from '../motion.ts';
import {
    FONT_SIZE_NAMES,
    displayFamilies,
    fontFamilies,
    fontSizes,
    fontWeights,
    letterSpacing,
    lineHeights,
} from '../typography.ts';
import { GENERATED_BANNER, kebab, variableReference } from './shared.ts';

const px = (value: number) => `${value}px`;

function colours(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, ramp] of Object.entries(RAMPS)) {
        result[name] = Object.fromEntries(Object.entries(ramp).map(([stop, hex]) => [stop, hex]));
    }

    // Theme-dependent roles, grouped so utilities read as `bg-surface-base`, `text-content-primary`,
    // `border-stroke-subtle`.
    result['surface'] = {
        base: variableReference('surface-base'),
        raised: variableReference('surface-raised'),
        sunken: variableReference('surface-sunken'),
        inverse: variableReference('surface-inverse'),
        brand: variableReference('brand-surface'),
        'brand-subtle': variableReference('brand-surface-subtle'),
        accent: variableReference('accent-surface'),
    };

    result['content'] = {
        primary: variableReference('text-primary'),
        secondary: variableReference('text-secondary'),
        disabled: variableReference('text-disabled'),
        inverse: variableReference('text-inverse'),
        'on-brand': variableReference('text-on-brand'),
        'on-brand-subtle': variableReference('on-brand-surface-subtle'),
        'on-accent': variableReference('on-accent-surface'),
    };

    result['stroke'] = {
        subtle: variableReference('border-subtle'),
        DEFAULT: variableReference('border-default'),
        strong: variableReference('border-strong'),
        focus: variableReference('focus-ring'),
    };

    result['overlay'] = variableReference('overlay');
    result['rating'] = variableReference('rating-star');

    for (const role of SEMANTIC_ROLES) {
        result[role] = {
            subtle: variableReference(`${role}-subtle`),
            'on-subtle': variableReference(`${role}-on-subtle`),
            DEFAULT: variableReference(`${role}-default`),
            'on-default': variableReference(`${role}-on-default`),
            strong: variableReference(`${role}-strong`),
            'on-strong': variableReference(`${role}-on-strong`),
            border: variableReference(`${role}-border`),
        };
    }

    result['nutrition'] = Object.fromEntries(
        NUTRITION_LEVELS.flatMap((level) => [
            [level, variableReference(`nutrition-${level}`)],
            [`${level}-on`, variableReference(`nutrition-${level}-on`)],
        ]),
    );

    return result;
}

function fontSizeScale(): Record<string, [string, string]> {
    return Object.fromEntries(
        FONT_SIZE_NAMES.map((name) => [
            name,
            [px(fontSizes[name]), px(lineHeights.latin[name])] as [string, string],
        ]),
    );
}

function lineHeightScale(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const script of ['latin', 'arabic'] as const) {
        for (const name of FONT_SIZE_NAMES) {
            result[`${script}-${name}`] = px(lineHeights[script][name]);
        }
    }
    return result;
}

/**
 * Emits the Tailwind preset consumed by `apps/universal/tailwind.config.js`.
 *
 * It only ever writes into `theme.extend`: the design system adds vocabulary, it does not delete
 * Tailwind's, so an unrecognised utility in a component is a genuine mistake rather than a token
 * that was quietly removed.
 */
export function renderTailwindPreset(): string {
    const preset = {
        theme: {
            extend: {
                colors: colours(),
                spacing: Object.fromEntries(Object.entries(spacing).map(([k, v]) => [k, px(v)])),
                borderRadius: Object.fromEntries(
                    Object.entries(radius).map(([k, v]) => [k === 'md' ? 'DEFAULT' : k, px(v)]),
                ),
                borderWidth: { focus: px(focusRing.width) },
                outlineOffset: { focus: px(focusRing.offset) },
                fontFamily: {
                    latin: [fontFamilies.latin.regular, ...fontFamilies.latin.stack.split(', ')],
                    arabic: [fontFamilies.arabic.regular, ...fontFamilies.arabic.stack.split(', ')],
                    display: [displayFamilies.latin.bold, ...displayFamilies.latin.stack.split(', ')],
                },
                fontSize: fontSizeScale(),
                lineHeight: lineHeightScale(),
                fontWeight: fontWeights,
                letterSpacing: Object.fromEntries(
                    Object.entries(letterSpacing).map(([k, v]) => [k, px(v)]),
                ),
                screens: Object.fromEntries(
                    Object.entries(breakpoints)
                        .filter(([, value]) => value > 0)
                        .map(([name, value]) => [name, px(value)]),
                ),
                zIndex: Object.fromEntries(Object.entries(zIndex).map(([k, v]) => [k, String(v)])),
                boxShadow: Object.fromEntries(
                    ELEVATION_LEVELS.map((level) => [`elevation-${level}`, elevation[level].web]),
                ),
                transitionDuration: Object.fromEntries(
                    DURATION_NAMES.map((name) => [name, `${durations[name]}ms`]),
                ),
                transitionTimingFunction: Object.fromEntries(
                    Object.entries(easings).map(([name, token]) => [kebab(name), token.css]),
                ),
                minWidth: { touch: px(MIN_TOUCH_TARGET) },
                minHeight: { touch: px(MIN_TOUCH_TARGET) },
            },
        },
    };

    return `${GENERATED_BANNER}\n\nmodule.exports = ${JSON.stringify(preset, null, 2)};\n`;
}
