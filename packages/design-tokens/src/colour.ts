/**
 * Colour tokens.
 *
 * Palette intent: a *desaturated* teal-green brand (calm and clinical rather than "wellness app
 * neon"), a warm clay accent for emphasis, and warm neutrals so long reading surfaces do not feel
 * cold. Every semantic role ships as a background plus a matching `on*` foreground, and the pair is
 * contrast-tested (`colour.test.ts`) at WCAG AA for normal text in both themes — the ramps are not
 * decorative, they are the accessibility budget.
 */

export type ColourRamp = Readonly<Record<ColourStop, string>>;

export const COLOUR_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ColourStop = (typeof COLOUR_STOPS)[number];

/** Brand — desaturated teal-green. */
export const brand: ColourRamp = {
    50: '#f1f7f5',
    100: '#dbeae6',
    200: '#b8d5ce',
    300: '#8bb8ae',
    400: '#5c968b',
    500: '#3f7a6f',
    600: '#2f6157',
    700: '#284e46',
    800: '#213f39',
    900: '#1c342f',
    950: '#0e1d1a',
};

/** Accent — warm clay. Used sparingly: highlights, empty-state illustration, focus accents. */
export const clay: ColourRamp = {
    50: '#fdf5f1',
    100: '#f8e7dd',
    200: '#efcbb8',
    300: '#e2a78a',
    400: '#d07f5c',
    500: '#b9603d',
    600: '#9c4c30',
    700: '#7f3e29',
    800: '#683425',
    900: '#562d22',
    950: '#2e1611',
};

/** Warm neutrals — the surface and text family. */
export const neutral: ColourRamp = {
    50: '#faf9f7',
    100: '#f2f0ec',
    200: '#e5e1da',
    300: '#d0cabf',
    400: '#a9a195',
    500: '#847c70',
    600: '#68615a',
    700: '#514c47',
    800: '#393532',
    900: '#282522',
    950: '#171514',
};

export const pureWhite = '#ffffff';
export const pureBlack = '#000000';

export const RAMPS = { brand, clay, neutral } as const;
export type RampName = keyof typeof RAMPS;

/**
 * Status colours. `subtle` is a tinted background for banners and badges, `default` is the solid
 * fill, `strong` is the pressed/high-emphasis fill. Each has its own foreground so no consumer ever
 * has to guess whether white or dark text is legible.
 */
export interface SemanticColourSet {
    readonly subtle: string;
    readonly onSubtle: string;
    readonly default: string;
    readonly onDefault: string;
    readonly strong: string;
    readonly onStrong: string;
    /** Hairline that separates a subtle surface from the page. Non-text, 3:1 target. */
    readonly border: string;
}

export const SEMANTIC_ROLES = ['success', 'warning', 'danger', 'info'] as const;
export type SemanticRole = (typeof SEMANTIC_ROLES)[number];

export const semanticLight: Readonly<Record<SemanticRole, SemanticColourSet>> = {
    success: {
        subtle: '#e8f4ec',
        onSubtle: '#1b4b2e',
        default: '#256c41',
        onDefault: '#ffffff',
        strong: '#194b2d',
        onStrong: '#ffffff',
        border: '#659d7b',
    },
    warning: {
        subtle: '#fbf1de',
        onSubtle: '#5a3c07',
        default: '#7a5209',
        onDefault: '#ffffff',
        strong: '#573a06',
        onStrong: '#ffffff',
        border: '#b48a3a',
    },
    danger: {
        subtle: '#fbeceb',
        onSubtle: '#7a201b',
        default: '#a52b24',
        onDefault: '#ffffff',
        strong: '#761d18',
        onStrong: '#ffffff',
        border: '#d1746c',
    },
    info: {
        subtle: '#e9f0f8',
        onSubtle: '#1d3f63',
        default: '#2a5a8a',
        onDefault: '#ffffff',
        strong: '#1e4062',
        onStrong: '#ffffff',
        border: '#6690bc',
    },
};

export const semanticDark: Readonly<Record<SemanticRole, SemanticColourSet>> = {
    success: {
        subtle: '#16301f',
        onSubtle: '#9fd6b3',
        default: '#8ecda6',
        onDefault: '#0d2418',
        strong: '#b7e2c6',
        onStrong: '#0d2418',
        border: '#4a7d5d',
    },
    warning: {
        subtle: '#33240a',
        onSubtle: '#e8c073',
        default: '#e5bb6a',
        onDefault: '#2a1d04',
        strong: '#f0d295',
        onStrong: '#2a1d04',
        border: '#8a6a2a',
    },
    danger: {
        subtle: '#3a1512',
        onSubtle: '#efa19a',
        default: '#ee9a92',
        onDefault: '#2e100d',
        strong: '#f5bcb6',
        onStrong: '#2e100d',
        border: '#a85049',
    },
    info: {
        subtle: '#132335',
        onSubtle: '#9dc0e2',
        default: '#95bbe0',
        onDefault: '#0f2033',
        strong: '#bcd5ec',
        onStrong: '#0f2033',
        border: '#456e97',
    },
};

/**
 * Nutrition scale.
 *
 * Five ordered stops from optimal to excessive. **Every stop carries a `pattern` token as well as a
 * colour** so meaning is never conveyed by colour alone (WCAG 1.4.1) — charts, chips and bars must
 * render the pattern, not just the fill. `patternId` is the SVG `<pattern>` identifier the design
 * system registers; `ordinal` gives a colour-blind-safe sort order for tables and legends.
 */
export const NUTRITION_LEVELS = ['optimal', 'good', 'moderate', 'high', 'excessive'] as const;
export type NutritionLevel = (typeof NUTRITION_LEVELS)[number];

export type NutritionPattern =
    'solid' | 'diagonal-sparse' | 'diagonal-dense' | 'crosshatch' | 'dots-dense';

export interface NutritionStop {
    readonly ordinal: number;
    readonly colour: string;
    readonly on: string;
    readonly pattern: NutritionPattern;
    readonly patternId: string;
}

export const nutritionLight: Readonly<Record<NutritionLevel, NutritionStop>> = {
    optimal: {
        ordinal: 1,
        colour: '#1f6b4c',
        on: '#ffffff',
        pattern: 'solid',
        patternId: 'nutrition-optimal',
    },
    good: {
        ordinal: 2,
        colour: '#3f7a6f',
        on: '#ffffff',
        pattern: 'diagonal-sparse',
        patternId: 'nutrition-good',
    },
    moderate: {
        ordinal: 3,
        colour: '#7a5209',
        on: '#ffffff',
        pattern: 'diagonal-dense',
        patternId: 'nutrition-moderate',
    },
    high: {
        ordinal: 4,
        colour: '#9c4c30',
        on: '#ffffff',
        pattern: 'crosshatch',
        patternId: 'nutrition-high',
    },
    excessive: {
        ordinal: 5,
        colour: '#8a201a',
        on: '#ffffff',
        pattern: 'dots-dense',
        patternId: 'nutrition-excessive',
    },
};

export const nutritionDark: Readonly<Record<NutritionLevel, NutritionStop>> = {
    optimal: {
        ordinal: 1,
        colour: '#7fc9a4',
        on: '#0d2418',
        pattern: 'solid',
        patternId: 'nutrition-optimal',
    },
    good: {
        ordinal: 2,
        colour: '#8bb8ae',
        on: '#0e1d1a',
        pattern: 'diagonal-sparse',
        patternId: 'nutrition-good',
    },
    moderate: {
        ordinal: 3,
        colour: '#e5bb6a',
        on: '#2a1d04',
        pattern: 'diagonal-dense',
        patternId: 'nutrition-moderate',
    },
    high: {
        ordinal: 4,
        colour: '#e2a78a',
        on: '#2e1611',
        pattern: 'crosshatch',
        patternId: 'nutrition-high',
    },
    excessive: {
        ordinal: 5,
        colour: '#ee9a92',
        on: '#2e100d',
        pattern: 'dots-dense',
        patternId: 'nutrition-excessive',
    },
};

/** Surface / text / border roles per theme. */
export interface ThemeColours {
    readonly surfaceBase: string;
    readonly surfaceRaised: string;
    readonly surfaceSunken: string;
    readonly surfaceInverse: string;
    readonly textPrimary: string;
    readonly textSecondary: string;
    readonly textDisabled: string;
    readonly textInverse: string;
    readonly textOnBrand: string;
    readonly borderSubtle: string;
    readonly borderDefault: string;
    readonly borderStrong: string;
    readonly focusRing: string;
    readonly brandSurface: string;
    readonly brandSurfaceSubtle: string;
    readonly onBrandSurfaceSubtle: string;
    readonly accentSurface: string;
    readonly onAccentSurface: string;
    readonly overlay: string;
}

export const themeLight: ThemeColours = {
    surfaceBase: '#ffffff',
    surfaceRaised: '#faf9f7',
    surfaceSunken: '#f2f0ec',
    surfaceInverse: '#282522',
    textPrimary: '#282522',
    textSecondary: '#514c47',
    textDisabled: '#68615a', // neutral.600 - AA (>=4.5:1) on base and raised surfaces
    textInverse: '#faf9f7',
    textOnBrand: '#ffffff',
    borderSubtle: '#e5e1da',
    borderDefault: '#d0cabf',
    borderStrong: '#847c70',
    focusRing: '#2f6157',
    brandSurface: '#2f6157',
    brandSurfaceSubtle: '#dbeae6',
    onBrandSurfaceSubtle: '#213f39',
    accentSurface: '#9c4c30',
    onAccentSurface: '#ffffff',
    overlay: '#17151499',
};

export const themeDark: ThemeColours = {
    surfaceBase: '#171514',
    surfaceRaised: '#211f1d',
    surfaceSunken: '#0f0e0d',
    surfaceInverse: '#f2f0ec',
    textPrimary: '#f2f0ec',
    textSecondary: '#c9c3b9',
    textDisabled: '#a9a195', // neutral.400 - AA on dark surfaces
    textInverse: '#282522',
    textOnBrand: '#0e1d1a',
    borderSubtle: '#393532',
    borderDefault: '#514c47',
    borderStrong: '#847c70',
    focusRing: '#8bb8ae',
    brandSurface: '#8bb8ae',
    brandSurfaceSubtle: '#213f39',
    onBrandSurfaceSubtle: '#b8d5ce',
    accentSurface: '#e2a78a',
    onAccentSurface: '#2e1611',
    overlay: '#000000b3',
};

export const THEMES = ['light', 'dark'] as const;
export type ThemeName = (typeof THEMES)[number];

export interface ThemeTokens {
    readonly colours: ThemeColours;
    readonly semantic: Readonly<Record<SemanticRole, SemanticColourSet>>;
    readonly nutrition: Readonly<Record<NutritionLevel, NutritionStop>>;
}

export const themes: Readonly<Record<ThemeName, ThemeTokens>> = {
    light: { colours: themeLight, semantic: semanticLight, nutrition: nutritionLight },
    dark: { colours: themeDark, semantic: semanticDark, nutrition: nutritionDark },
};
