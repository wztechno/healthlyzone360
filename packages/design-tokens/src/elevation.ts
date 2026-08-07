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

/**
 * Named elevations — shadows that are not a step on the 0–5 ramp.
 *
 * The ramp is a single warm-black shadow at increasing distance, which is right for menus, drawers
 * and dialogs that sit *above* the page. A content card in a grid is doing something else: it has to
 * lift off a tinted page without reading as a floating overlay. That takes two layers — a 1px
 * contact shadow that defines the edge, and a wide, heavily-offset green-black cast that gives the
 * lift — and the pair cannot be expressed as a level, so it is named instead.
 *
 * The cast is tinted with the canopy (`#0b3b26`) rather than the ramp's neutral `#171514`: a warm
 * grey shadow on the mint page reads as dirt, and a green-black one reads as depth.
 *
 * Note these are distinct from {@link elevationRoles}, which maps a role onto a *numeric* level.
 */
export const NAMED_ELEVATIONS = ['card', 'card-hover'] as const;
export type NamedElevationName = (typeof NAMED_ELEVATIONS)[number];

export interface NamedElevationToken {
    readonly native: NativeShadow;
    readonly web: string;
}

/** Approximates a two-layer web shadow with the single shadow React Native supports. */
function namedToken(height: number, opacity: number, radius: number, web: string): NamedElevationToken {
    return {
        native: {
            shadowColor: '#0b3b26',
            shadowOffset: { width: 0, height },
            shadowOpacity: opacity,
            shadowRadius: radius,
            elevation: height,
        },
        web,
    };
}

export const namedElevation: Readonly<Record<NamedElevationName, NamedElevationToken>> = {
    card: namedToken(
        6,
        0.18,
        15,
        '0 1px 2px rgb(23 21 20 / 0.05), 0 14px 30px -18px rgb(11 59 38 / 0.35)',
    ),
    'card-hover': namedToken(
        10,
        0.26,
        23,
        '0 1px 2px rgb(23 21 20 / 0.05), 0 24px 46px -20px rgb(11 59 38 / 0.5)',
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
