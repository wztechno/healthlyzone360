import { NUTRITION_LEVELS, RAMPS, SEMANTIC_ROLES } from '../colour.ts';
import { ELEVATION_LEVELS, NAMED_ELEVATIONS, elevation, namedElevation } from '../elevation.ts';
import {
    cardWidth,
    controlGap,
    controlHeight,
    controlPaddingX,
    fieldWidth,
    iconSize,
    rowHeight,
} from '../control.ts';
import { breakpoints, focusRing, radius, spacing, spacingAliases, zIndex } from '../layout.ts';
import { DURATION_NAMES, durations, easings } from '../motion.ts';
import {
    FONT_SIZE_NAMES,
    displayFamilies,
    displayLetterSpacing,
    adminFamilies,
    fontFamilies,
    fontSizes,
    fontWeights,
    letterSpacing,
    lineHeights,
    monoFamilies,
    TEXT_ROLE_NAMES,
    textRoles,
} from '../typography.ts';
import { GENERATED_BANNER, kebab, variableReference } from './shared.ts';

const px = (value: number) => `${value}px`;

/**
 * The 44px touch floor, as a literal rather than a token — deliberately, and temporarily.
 *
 * `MIN_TOUCH_TARGET` is retired: `control.ts` explains why the Catalogue does not want it, and
 * nothing in the admin reads it any more. But `min-h-touch` and `min-w-touch` are still applied at
 * two dozen call sites across the design system and the customer app — phone surfaces, where a
 * fingertip really does need the room. Deleting the utilities along with the token would not have
 * *changed* those screens so much as quietly stopped generating their classes: NativeWind emits
 * nothing for a utility the preset does not define, and the minimum would vanish with no error to
 * notice.
 *
 * So the utilities keep working while the admin stops asking for them. This literal is what
 * survives of the constant, and it should live exactly as long as the last `min-h-touch` in the
 * customer app — that sweep is its own change, on its own reasoning about the phone.
 *
 * @deprecated Remove with the last `min-h-touch` / `min-w-touch` call site.
 */
const DEPRECATED_TOUCH_TARGET_PX = 44;

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
        'accent-subtle': variableReference('accent-subtle'),
        canopy: variableReference('surface-canopy'),
        'canopy-deep': variableReference('surface-canopy-deep'),
    };

    result['content'] = {
        primary: variableReference('text-primary'),
        secondary: variableReference('text-secondary'),
        disabled: variableReference('text-disabled'),
        inverse: variableReference('text-inverse'),
        'on-brand': variableReference('text-on-brand'),
        'on-brand-subtle': variableReference('on-brand-surface-subtle'),
        'on-accent': variableReference('on-accent-surface'),
        'on-accent-subtle': variableReference('on-accent-subtle'),
        'on-canopy': variableReference('on-canopy'),
        'on-canopy-muted': variableReference('on-canopy-muted'),
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
                // Aliases only. `control-*` is deliberately NOT here: padding and gap carry
                // different values at the same size name, so one shared `spacing` entry would
                // make `gap-control-sm` silently resolve to the padding number.
                spacing: {
                    ...Object.fromEntries(Object.entries(spacing).map(([k, v]) => [k, px(v)])),
                    ...Object.fromEntries(
                        Object.entries(spacingAliases).map(([k, v]) => [k, px(v)]),
                    ),
                },
                padding: Object.fromEntries(
                    Object.entries(controlPaddingX).map(([k, v]) => [`control-${k}`, px(v)]),
                ),
                gap: Object.fromEntries(
                    Object.entries(controlGap).map(([k, v]) => [`control-${k}`, px(v)]),
                ),
                borderRadius: Object.fromEntries(
                    Object.entries(radius).map(([k, v]) => [k === 'md' ? 'DEFAULT' : k, px(v)]),
                ),
                borderWidth: { focus: px(focusRing.width) },
                outlineOffset: { focus: px(focusRing.offset) },
                fontFamily: {
                    latin: [fontFamilies.latin.regular, ...fontFamilies.latin.stack.split(', ')],
                    arabic: [fontFamilies.arabic.regular, ...fontFamilies.arabic.stack.split(', ')],
                    display: [displayFamilies.latin.bold, ...displayFamilies.latin.stack.split(', ')],
                    // New numeric role — see `monoFamilies`. Nothing rendered before this existed.
                    mono: [monoFamilies.latin.regular, ...monoFamilies.latin.stack.split(', ')],
                    // Transitional, Catalogue-scoped. Folds into `latin` when the product follows.
                    admin: [adminFamilies.latin.regular, ...adminFamilies.latin.stack.split(', ')],
                },
                fontSize: {
                    ...fontSizeScale(),
                    // The Catalogue ramp — `text-role-body`, `text-role-micro`. Prefixed so it
                    // cannot collide with the numeric scale above, which is untouched: a screen
                    // outside the admin keeps rendering exactly as it did.
                    ...Object.fromEntries(
                        TEXT_ROLE_NAMES.map((name) => [
                            `role-${name}`,
                            [
                                px(textRoles[name].size),
                                {
                                    lineHeight: px(textRoles[name].lineHeight),
                                    letterSpacing: px(textRoles[name].letterSpacing),
                                    fontWeight: textRoles[name].weight,
                                },
                            ],
                        ]),
                    ),
                },
                lineHeight: lineHeightScale(),
                fontWeight: fontWeights,
                letterSpacing: {
                    ...Object.fromEntries(
                        Object.entries(letterSpacing).map(([k, v]) => [k, px(v)]),
                    ),
                    display: displayLetterSpacing,
                },
                screens: Object.fromEntries(
                    Object.entries(breakpoints)
                        .filter(([, value]) => value > 0)
                        .map(([name, value]) => [name, px(value)]),
                ),
                zIndex: Object.fromEntries(Object.entries(zIndex).map(([k, v]) => [k, String(v)])),
                boxShadow: Object.fromEntries([
                    ...ELEVATION_LEVELS.map((level) => [
                        `elevation-${level}`,
                        elevation[level].web,
                    ]),
                    ...NAMED_ELEVATIONS.map((name) => [
                        `elevation-${name}`,
                        namedElevation[name].web,
                    ]),
                ]),
                transitionDuration: Object.fromEntries(
                    DURATION_NAMES.map((name) => [name, `${durations[name]}ms`]),
                ),
                transitionTimingFunction: Object.fromEntries(
                    Object.entries(easings).map(([name, token]) => [kebab(name), token.css]),
                ),
                minWidth: { touch: px(DEPRECATED_TOUCH_TARGET_PX), card: px(cardWidth.min) },
                minHeight: { touch: px(DEPRECATED_TOUCH_TARGET_PX) },
                height: {
                    // `h-control-sm`, `h-row-md` — the Catalogue's density, one knob.
                    ...Object.fromEntries(
                        Object.entries(controlHeight).map(([k, v]) => [`control-${k}`, px(v)]),
                    ),
                    ...Object.fromEntries(
                        Object.entries(rowHeight).map(([k, v]) => [`row-${k}`, px(v)]),
                    ),
                    ...Object.fromEntries(
                        Object.entries(iconSize).map(([k, v]) => [`icon-${k}`, px(v)]),
                    ),
                },
                width: {
                    // `w-field` is the no-stretch rule's one fixed width.
                    field: px(fieldWidth),
                    ...Object.fromEntries(
                        Object.entries(iconSize).map(([k, v]) => [`icon-${k}`, px(v)]),
                    ),
                },
                maxWidth: { field: px(fieldWidth), card: px(cardWidth.max) },
            },
        },
    };

    return `${GENERATED_BANNER}\n\nmodule.exports = ${JSON.stringify(preset, null, 2)};\n`;
}
