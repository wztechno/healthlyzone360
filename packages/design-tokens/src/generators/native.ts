import { NUTRITION_LEVELS, SEMANTIC_ROLES, themes } from '../colour.ts';
import {
    cardWidth,
    controlGap,
    controlHeight,
    controlPaddingX,
    fieldWidth,
    iconSize,
    rowHeight,
} from '../control.ts';
import {
    ELEVATION_LEVELS,
    NAMED_ELEVATIONS,
    elevation,
    elevationRoles,
    namedElevation,
} from '../elevation.ts';
import { breakpoints, focusRing, radius, spacing, spacingAliases, zIndex } from '../layout.ts';
import { durations, easings, reducedDurations } from '../motion.ts';
import {
    SCRIPTS,
    TEXT_ROLE_NAMES,
    displayLetterSpacing,
    fontFamilies,
    fontSizes,
    fontWeights,
    letterSpacing,
    lineHeights,
    monoFamilies,
    textRoleLetterSpacing,
    textRoleLineHeight,
    textRoles,
} from '../typography.ts';
import { GENERATED_BANNER } from './shared.ts';

/**
 * Emits `tokens.native.ts`: the same tokens as plain JavaScript values, for React Native code paths
 * that cannot go through a class name — `StyleSheet.create`, Reanimated worklets, chart primitives,
 * navigator theming.
 *
 * Shadows are emitted as React Native shadow objects here and as `box-shadow` strings in
 * `tokens.css`; both come from the same `elevation` source so they cannot drift.
 */
export function renderTokensNative(): string {
    const payload = {
        themes: Object.fromEntries(
            (['light', 'dark'] as const).map((theme) => [
                theme,
                {
                    colours: themes[theme].colours,
                    semantic: Object.fromEntries(
                        SEMANTIC_ROLES.map((role) => [role, themes[theme].semantic[role]]),
                    ),
                    nutrition: Object.fromEntries(
                        NUTRITION_LEVELS.map((level) => [level, themes[theme].nutrition[level]]),
                    ),
                },
            ]),
        ),
        spacing,
        spacingAliases,
        radius,
        breakpoints,
        zIndex,
        focusRing,
        control: {
            height: controlHeight,
            paddingX: controlPaddingX,
            gap: controlGap,
            iconSize,
            rowHeight,
            fieldWidth,
            cardWidth,
        },
        typography: {
            fontFamilies,
            monoFamilies,
            fontSizes,
            fontWeights,
            letterSpacing,
            displayLetterSpacing,
            lineHeights,
            textRoles,
            // Pre-resolved per script, because the caller here is a `StyleSheet` and cannot run
            // the resolver: React Native takes a number for `lineHeight` and `letterSpacing`, and
            // the value it takes depends on which script is being set.
            textRoleMetrics: Object.fromEntries(
                SCRIPTS.map((script) => [
                    script,
                    Object.fromEntries(
                        TEXT_ROLE_NAMES.map((role) => [
                            role,
                            {
                                fontSize: textRoles[role].size,
                                lineHeight: textRoleLineHeight(role, script),
                                letterSpacing: textRoleLetterSpacing(role, script),
                                fontWeight: textRoles[role].weight,
                            },
                        ]),
                    ),
                ]),
            ),
        },
        elevation: Object.fromEntries(
            ELEVATION_LEVELS.map((level) => [level, elevation[level].native]),
        ),
        namedElevation: Object.fromEntries(
            NAMED_ELEVATIONS.map((name) => [name, namedElevation[name].native]),
        ),
        elevationRoles,
        motion: { durations, reducedDurations, easings },
    };

    return `${GENERATED_BANNER}

export const nativeTokens = ${JSON.stringify(payload, null, 2)} as const;

export type NativeTokens = typeof nativeTokens;
export type NativeThemeName = keyof NativeTokens['themes'];
export type NativeThemeTokens = NativeTokens['themes'][NativeThemeName];

export default nativeTokens;
`;
}
