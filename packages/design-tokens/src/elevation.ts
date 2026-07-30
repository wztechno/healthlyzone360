/**
 * Elevation.
 *
 * Six levels (0–5). Each level is emitted twice — as a React Native shadow object and as a CSS
 * `box-shadow` string — because the two platforms model shadows differently and there is no lossless
 * conversion: React Native (iOS) takes offset/opacity/radius, Android takes a single `elevation`
 * number, and the web takes a layered box-shadow. Declaring all three from one source keeps them
 * visually matched instead of drifting apart in component files.
 */

export const ELEVATION_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type ElevationLevel = (typeof ELEVATION_LEVELS)[number];

export interface NativeShadow {
    readonly shadowColor: string;
    readonly shadowOffset: { readonly width: number; readonly height: number };
    readonly shadowOpacity: number;
    readonly shadowRadius: number;
    /** Android only; ignored on iOS and web. */
    readonly elevation: number;
}

export interface ElevationToken {
    readonly level: ElevationLevel;
    readonly native: NativeShadow;
    /** CSS `box-shadow` value for react-native-web and the web export. */
    readonly web: string;
}

/** Warm near-black, matched to the neutral ramp so shadows do not read as cold grey. */
const SHADOW_COLOUR = '#171514';

function token(
    level: ElevationLevel,
    height: number,
    opacity: number,
    radius: number,
    web: string,
): ElevationToken {
    return {
        level,
        native: {
            shadowColor: SHADOW_COLOUR,
            shadowOffset: { width: 0, height },
            shadowOpacity: opacity,
            shadowRadius: radius,
            elevation: level === 0 ? 0 : level * 2,
        },
        web,
    };
}

export const elevation: Readonly<Record<ElevationLevel, ElevationToken>> = {
    0: token(0, 0, 0, 0, 'none'),
    1: token(
        1,
        1,
        0.06,
        2,
        '0 1px 2px 0 rgb(23 21 20 / 0.06), 0 1px 1px -1px rgb(23 21 20 / 0.04)',
    ),
    2: token(
        2,
        2,
        0.08,
        4,
        '0 2px 4px -1px rgb(23 21 20 / 0.08), 0 1px 2px -1px rgb(23 21 20 / 0.05)',
    ),
    3: token(
        3,
        4,
        0.1,
        8,
        '0 4px 8px -2px rgb(23 21 20 / 0.10), 0 2px 4px -2px rgb(23 21 20 / 0.06)',
    ),
    4: token(
        4,
        8,
        0.12,
        16,
        '0 8px 16px -4px rgb(23 21 20 / 0.12), 0 4px 8px -4px rgb(23 21 20 / 0.07)',
    ),
    5: token(
        5,
        16,
        0.16,
        28,
        '0 16px 32px -8px rgb(23 21 20 / 0.16), 0 8px 16px -8px rgb(23 21 20 / 0.08)',
    ),
};

/** Semantic aliases so components ask for a role, not a number. */
export const elevationRoles = {
    flat: 0,
    card: 1,
    raised: 2,
    dropdown: 3,
    drawer: 4,
    dialog: 5,
} as const satisfies Readonly<Record<string, ElevationLevel>>;
export type ElevationRole = keyof typeof elevationRoles;
