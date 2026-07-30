import { NUTRITION_LEVELS, SEMANTIC_ROLES, themes } from '../colour.ts';
import { ELEVATION_LEVELS, elevation, elevationRoles } from '../elevation.ts';
import { breakpoints, focusRing, MIN_TOUCH_TARGET, radius, spacing, zIndex } from '../layout.ts';
import { durations, easings, reducedDurations } from '../motion.ts';
import { fontFamilies, fontSizes, fontWeights, letterSpacing, lineHeights } from '../typography.ts';
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
        radius,
        breakpoints,
        zIndex,
        focusRing,
        minTouchTarget: MIN_TOUCH_TARGET,
        typography: {
            fontFamilies,
            fontSizes,
            fontWeights,
            letterSpacing,
            lineHeights,
        },
        elevation: Object.fromEntries(
            ELEVATION_LEVELS.map((level) => [level, elevation[level].native]),
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
