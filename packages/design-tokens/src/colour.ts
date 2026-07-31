/**
 * Colour tokens.
 *
 * Palette intent: an *editorial nutrition-marketplace* look. A **deep-forest** brand carries the
 * primary actions and navigation; **green is an accent, not a wash**, so the light page is a
 * **warm cream** with white cards lifted on top of it. A **fresh lime** (`brand.300`) is the bright
 * accent, **soft green** the panel tint, **terracotta** the appetite accent, and **gold** is
 * reserved for one job — the rating stars. Every semantic role ships as a background plus a matching
 * `on*` foreground, and the pair is contrast-tested (`colour.test.ts`) at WCAG AA for normal text in
 * both themes — the ramps are not decorative, they are the accessibility budget.
 */

export type ColourRamp = Readonly<Record<ColourStop, string>>;

export const COLOUR_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ColourStop = (typeof COLOUR_STOPS)[number];

/** Brand — deep-forest green, with a fresh lime at the light end (`300`, the fresh-green accent). */
export const brand: ColourRamp = {
    50: '#f3f8eb',
    100: '#e4f1d2',
    200: '#c9e6a9',
    300: '#a8d672',
    400: '#79b451',
    500: '#4e8a37',
    600: '#2c6533',
    700: '#174c3c',
    800: '#143f31',
    900: '#103328',
    950: '#08160f',
};

/** Accent — warm terracotta (appetite). `400` is the bright appetite accent; `600` is text-safe. */
export const clay: ColourRamp = {
    50: '#fdf3ee',
    100: '#fbe0d3',
    200: '#f5c2ab',
    300: '#ef9f7b',
    400: '#e9784a',
    500: '#cf5a2d',
    600: '#ac4a26',
    700: '#8c3d22',
    800: '#72331f',
    900: '#5e2c1e',
    950: '#331410',
};

/** Cool green-grey neutrals — borders and text (the warm-cream page surface is a per-theme role). */
export const neutral: ColourRamp = {
    50: '#f6f7f3',
    100: '#ecefe8',
    200: '#dde3dd',
    300: '#c4ccc2',
    400: '#99a298',
    500: '#66706b',
    600: '#515a54',
    700: '#3f4741',
    800: '#2b322d',
    900: '#18221e',
    950: '#0d130f',
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
        border: '#458060',
    },
    warning: {
        subtle: '#fbf1de',
        onSubtle: '#5a3c07',
        default: '#7a5209',
        onDefault: '#ffffff',
        strong: '#573a06',
        onStrong: '#ffffff',
        border: '#8a691e',
    },
    danger: {
        subtle: '#fbeceb',
        onSubtle: '#7a201b',
        default: '#a52b24',
        onDefault: '#ffffff',
        strong: '#761d18',
        onStrong: '#ffffff',
        border: '#b6534b',
    },
    info: {
        subtle: '#e9f0f8',
        onSubtle: '#1d3f63',
        default: '#2a5a8a',
        onDefault: '#ffffff',
        strong: '#1e4062',
        onStrong: '#ffffff',
        border: '#4874a2',
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
    /** Gold, for Rating stars — the one place a warm point-of-emphasis colour earns its keep. */
    readonly ratingStar: string;
    readonly overlay: string;
}

export const themeLight: ThemeColours = {
    surfaceBase: '#f7f5ef', // warm-cream page canvas — green is an accent here, not a wash
    surfaceRaised: '#ffffff', // cards and the top bar sit white on the cream page
    surfaceSunken: '#f1f2ea',
    surfaceInverse: '#18221e',
    textPrimary: '#18221e',
    textSecondary: '#636c67', // ~#66706b, nudged so neutral secondary text clears AA on danger/info-subtle panels too
    textDisabled: '#6b746e',
    textInverse: '#f7f5ef',
    textOnBrand: '#ffffff',
    borderSubtle: '#e7e9e2',
    borderDefault: '#d5dcd4',
    borderStrong: '#767f79',
    focusRing: '#174c3c',
    brandSurface: '#174c3c', // deep forest — primary buttons, active nav
    brandSurfaceSubtle: '#eaf4df', // soft green — panels, active pill
    onBrandSurfaceSubtle: '#1c5031',
    accentSurface: '#ac4a26', // terracotta, white-text-safe
    onAccentSurface: '#ffffff',
    ratingStar: '#b57d0d', // gold, AA on cream and white
    overlay: '#18221ecc',
};

export const themeDark: ThemeColours = {
    surfaceBase: '#14160f',
    surfaceRaised: '#1f2018',
    surfaceSunken: '#0e0f09',
    surfaceInverse: '#f6f7f3',
    textPrimary: '#f2f4ea',
    textSecondary: '#c6ccbf',
    textDisabled: '#99a298',
    textInverse: '#18221e',
    textOnBrand: '#08160f',
    borderSubtle: '#31352a',
    borderDefault: '#454b3d',
    borderStrong: '#767f79',
    focusRing: '#a8d672',
    brandSurface: '#a8d672', // fresh lime reads as the brand on dark surfaces
    brandSurfaceSubtle: '#153a2c',
    onBrandSurfaceSubtle: '#bde3a6',
    accentSurface: '#ef9f7b',
    onAccentSurface: '#331410',
    ratingStar: '#d99614', // gold, brighter for dark surfaces
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
