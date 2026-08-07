/**
 * Colour tokens.
 *
 * Palette intent: **Wellness Green + AI** (mood board Option 02). A vital **emerald** brand carries
 * the primary actions and navigation; the light page is a **mint white** with white cards lifted on
 * top of it. A **fresh lime** (`brand.300`) is the bright green accent, **soft green** the panel
 * tint, and a deep **violet** (`violet.700`) is the AI/premium accent that the signature
 * green→violet gradients run into. **Gold** is reserved for one job — the rating stars.
 *
 * The mood board's vivid hexes (emerald `#16a34a`, amber `#f59e0b`, coral `#ef4444`, lime, sky) are
 * the *surfaces, tints and accents* here; where a role needs legible text on a solid fill its
 * `default`/`strong` stop is darkened to clear WCAG AA, because white on `#16a34a` is only 3.3:1.
 * Every semantic role ships as a background plus a matching `on*` foreground, and the pair is
 * contrast-tested (`colour.test.ts`) at WCAG AA in both themes — the ramps are the accessibility
 * budget, not decoration.
 */

export type ColourRamp = Readonly<Record<ColourStop, string>>;

export const COLOUR_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ColourStop = (typeof COLOUR_STOPS)[number];

/** Brand — vital green: fresh lime at the light end (`300`), emerald in the middle (`500`, the mood
 * board's `#16a34a`), deep forest at the dark end. `brandSurface` sits below `500` so white text on it
 * clears AA. */
export const brand: ColourRamp = {
    50: '#f2fcf4',
    100: '#dcf7e1',
    200: '#bbedc6',
    300: '#8ad79b',
    400: '#49b264',
    500: '#16a34a',
    600: '#158043',
    700: '#146a3a',
    800: '#11532e',
    900: '#0d3d23',
    950: '#07160e',
};

/** Accent — deep violet (AI / premium). `400` is the bright accent for dark surfaces; `700` is the
 * mood board's `#6d28d9`, text-safe with white on light surfaces and the end of the AI gradient. */
export const violet: ColourRamp = {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
    950: '#2e1065',
};

/** Cool slate neutrals — borders and text (`800` is the mood board's `#1f2937`, `500` its `#6b7280`).
 * The page surfaces are a per-theme role and carry the mint tint, not these. */
export const neutral: ColourRamp = {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
    950: '#030712',
};

export const pureWhite = '#ffffff';
export const pureBlack = '#000000';

export const RAMPS = { brand, violet, neutral } as const;
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
        subtle: '#dcfce7',
        onSubtle: '#14532d',
        default: '#157347',
        onDefault: '#ffffff',
        strong: '#0f5132',
        onStrong: '#ffffff',
        border: '#3f9d6a',
    },
    warning: {
        subtle: '#fdf2d6',
        onSubtle: '#79480a',
        default: '#8a5a09',
        onDefault: '#ffffff',
        strong: '#5f3d05',
        onStrong: '#ffffff',
        border: '#b3841f',
    },
    danger: {
        subtle: '#fde5e3',
        onSubtle: '#8f1f1a',
        default: '#c02722',
        onDefault: '#ffffff',
        strong: '#8a1c17',
        onStrong: '#ffffff',
        border: '#d16a64',
    },
    info: {
        subtle: '#e2f1fb',
        onSubtle: '#0b4a6f',
        default: '#0369a1',
        onDefault: '#ffffff',
        strong: '#0b4a6f',
        onStrong: '#ffffff',
        border: '#3690bf',
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
        subtle: '#0e2636',
        onSubtle: '#9fcdec',
        default: '#8fc4ec',
        onDefault: '#0a2033',
        strong: '#bcdcf3',
        onStrong: '#0a2033',
        border: '#3f80ad',
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
    /**
     * Canopy — the deep forest band behind page heroes, the marketplace footer and the shell
     * chrome. Dark enough that white headings and `onCanopyMuted` body copy both clear AA on it,
     * which is the whole reason it is a role of its own rather than `brand.900`.
     */
    readonly surfaceCanopy: string;
    /** The canopy gradient's second stop. Never used as a flat fill on its own. */
    readonly surfaceCanopyDeep: string;
    readonly onCanopy: string;
    /**
     * Body copy on the canopy. **Minimum alpha 0.62** — at that opacity it is 5.42:1 on
     * `surfaceCanopy`, and 0.45 is 3.60:1 and fails. Navigation sits at 0.74–0.78, body at
     * 0.82–0.86.
     */
    readonly onCanopyMuted: string;
    /** Violet tint for AI surfaces. Pairs with `onAccentSubtle`, never with `textPrimary`. */
    readonly accentSubtle: string;
    readonly onAccentSubtle: string;
    /** Gold, for Rating stars — the one place a warm point-of-emphasis colour earns its keep. */
    readonly ratingStar: string;
    readonly overlay: string;
}

export const themeLight: ThemeColours = {
    surfaceBase: '#f7fcf9', // mint-white page canvas
    surfaceRaised: '#ffffff', // cards and the top bar sit white on the mint page
    surfaceSunken: '#edf6f0',
    surfaceInverse: '#14231c',
    textPrimary: '#1f2937', // forest charcoal (mood board #1f2937)
    textSecondary: '#5b6673', // slate grey, darkened from the mood board's #6b7280 so it clears AA on the semantic-subtle panels too
    textDisabled: '#646e7c', // slate, still AA on white/mint/sunken — axe flags muted text even where the control is not marked disabled
    textInverse: '#f7fcf9',
    textOnBrand: '#ffffff',
    borderSubtle: '#cceeda',
    borderDefault: '#aaddc0',
    borderStrong: '#5f8f76',
    focusRing: '#157043',
    brandSurface: '#157043', // emerald — primary buttons, active nav (below brand.500 so white text clears AA)
    brandSurfaceSubtle: '#dcfce7', // soft green — panels, active pill
    onBrandSurfaceSubtle: '#14532d',
    accentSurface: '#6d28d9', // violet — the AI / premium accent, white-text-safe
    onAccentSurface: '#ffffff',
    surfaceCanopy: '#0b3b26', // deep forest band
    surfaceCanopyDeep: '#124f33', // gradient partner
    onCanopy: '#ffffff',
    onCanopyMuted: '#dcfce7',
    accentSubtle: '#f1ebfd', // violet tint, AI surfaces
    onAccentSubtle: '#4c1d95',
    ratingStar: '#b57d0d', // gold, AA on mint and white
    overlay: '#14231ccc',
};

export const themeDark: ThemeColours = {
    surfaceBase: '#0e1712',
    surfaceRaised: '#16241b',
    surfaceSunken: '#0a110b',
    surfaceInverse: '#f6f7f3',
    textPrimary: '#eef4ee',
    textSecondary: '#bcc7be',
    textDisabled: '#8b968c',
    textInverse: '#14231c',
    textOnBrand: '#06160c',
    borderSubtle: '#26352b',
    borderDefault: '#3a4b3f',
    borderStrong: '#79877e',
    focusRing: '#86efac',
    brandSurface: '#86efac', // bright mint-emerald reads as the brand on dark surfaces
    brandSurfaceSubtle: '#153a26',
    onBrandSurfaceSubtle: '#b6e8c2',
    accentSurface: '#a78bfa', // violet accent, lightened for dark surfaces
    onAccentSurface: '#1e1541',
    // Lifted off the near-black page so the hero band still reads as a band; in light mode the
    // canopy is darker than the page, in dark mode it is lighter, and both directions separate.
    surfaceCanopy: '#123324',
    surfaceCanopyDeep: '#17402c',
    // The canopy is dark in *both* themes, so its foregrounds do not flip. Declared here because
    // every role needs a value per theme, not because these two change.
    onCanopy: '#ffffff',
    onCanopyMuted: '#dcfce7',
    accentSubtle: '#251b3d', // the pale violet tint inverts; a lavender panel on a dark page does not
    onAccentSubtle: '#cdbcf7',
    ratingStar: '#e0a92a', // gold, brighter for dark surfaces
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
