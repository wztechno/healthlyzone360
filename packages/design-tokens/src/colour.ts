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
 *
 * ## Changing a colour
 *
 * Edit {@link palette}, then `pnpm build:tokens`. Every ramp stop, theme role and gradient that *is*
 * a mood board colour reads it from there by name, so one edit re-colours every screen. The values
 * written as literals further down are the ones that are *not* a mood board colour: tints, dark-theme
 * counterparts, and stops darkened for contrast — edit those in place. `colour.test.ts` fails the
 * build if a change drops any pair below AA.
 */

import { withAlpha } from './contrast.ts';

/**
 * The mood board's palette — Option 02, "Wellness Green + AI" — as the board itself writes it.
 *
 * **The one place a brand colour is typed.** The names follow the board's own `:root` variables so
 * the two can be read side by side. Two of the board's colours are deliberately absent because no
 * role carries them yet, and an entry that changes nothing when edited is a trap: Sky Blue
 * (`#38bdf8`, "supporting") and the dark ink it puts on the lime (`#0f172a`).
 */
export const palette = {
    /** Emerald Green — primary buttons, the sidebar, the active pill, the brand ramp's `500`. */
    primary: '#16a34a',
    /** Sage/lime — the hero gradient's bright middle. */
    secondary: '#84cc16',
    /** Deep Violet — the AI / premium accent, and the far end of both signature gradients. */
    ai: '#6d28d9',
    /** Status colours at full strength — chart strokes and indicator dots, never small text. */
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    /** Mint White — the light page canvas. */
    background: '#f7fcf9',
    /** White — cards, panels, the top bar. */
    surface: '#ffffff',
    /** Forest Charcoal — primary text. */
    textPrimary: '#1f2937',
    /** Grey — the board's secondary text. The light theme's role is darkened from it; see there. */
    textSecondary: '#6b7280',
    /** Soft Green Grey — hairlines and card borders. */
    border: '#d1fae5',
    /** Text and icons on `primary`. */
    onPrimary: '#ffffff',
    /** Text and icons on `ai`. */
    onAi: '#ffffff',
} as const;

export type ColourRamp = Readonly<Record<ColourStop, string>>;

export const COLOUR_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ColourStop = (typeof COLOUR_STOPS)[number];

/** Brand — vital green: fresh lime at the light end (`300`), emerald in the middle (`500`, the mood
 * board's `#16a34a`), deep forest at the dark end. `brandSurface` is `500` itself, the mood board's
 * primary, with white text on it by choice — see `colour.test.ts`. */
export const brand: ColourRamp = {
    50: '#f2fcf4',
    100: '#dcf7e1',
    200: '#bbedc6',
    300: '#8ad79b',
    400: '#49b264',
    500: palette.primary,
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
    700: palette.ai,
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
    500: palette.textSecondary,
    600: '#4b5563',
    700: '#374151',
    800: palette.textPrimary,
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
    /**
     * The app shell's sidebar — the panel the modules live in. The primary green in light mode, with
     * white items on it and the active item as a white pill in green text.
     */
    readonly surfaceSidebar: string;
    /** Item text on the sidebar. */
    readonly onSidebar: string;
    /** Group headings, icons and quiet controls on the sidebar. */
    readonly onSidebarMuted: string;
    /** The active item's pill. */
    readonly sidebarActive: string;
    /** The active item's text and icon. */
    readonly onSidebarActive: string;
    /** Violet tint for AI surfaces. Pairs with `onAccentSubtle`, never with `textPrimary`. */
    readonly accentSubtle: string;
    readonly onAccentSubtle: string;
    /** Gold, for Rating stars — the one place a warm point-of-emphasis colour earns its keep. */
    readonly ratingStar: string;
    readonly overlay: string;
}

export const themeLight: ThemeColours = {
    surfaceBase: palette.background, // mint-white page canvas
    surfaceRaised: palette.surface, // cards and the top bar sit white on the mint page
    surfaceSunken: '#edf6f0',
    surfaceInverse: '#14231c',
    textPrimary: palette.textPrimary, // forest charcoal
    textSecondary: '#5b6673', // slate grey, darkened from `palette.textSecondary` so it clears AA on the semantic-subtle panels too
    textDisabled: '#646e7c', // slate, still AA on white/mint/sunken — axe flags muted text even where the control is not marked disabled
    textInverse: palette.background,
    textOnBrand: palette.onPrimary,
    borderSubtle: palette.border, // the mood board's soft green grey — card borders and hairlines
    borderDefault: '#aaddc0',
    borderStrong: '#5f8f76',
    focusRing: '#157043',
    // The mood board's primary, exactly: buttons, selected tabs, the active pill. White text on it is
    // 3.05:1 — below AA for 12–14px labels, and a decision taken knowingly (see `colour.test.ts`).
    brandSurface: palette.primary,
    brandSurfaceSubtle: '#dcfce7', // soft green — panels, active pill
    onBrandSurfaceSubtle: '#14532d',
    accentSurface: palette.ai, // violet — the AI / premium accent, white-text-safe
    onAccentSurface: palette.onAi,
    surfaceCanopy: '#0b3b26', // deep forest band
    surfaceCanopyDeep: '#124f33', // gradient partner
    onCanopy: '#ffffff',
    onCanopyMuted: '#dcfce7',
    surfaceSidebar: palette.primary, // the primary green
    onSidebar: palette.onPrimary, // 3.05:1 — see "brand green, as chosen" in colour.test.ts
    onSidebarMuted: palette.onPrimary, // headings differ by weight and size, not by a fainter ink
    sidebarActive: palette.onPrimary, // white pill
    onSidebarActive: palette.primary, // green text on it, 3.05:1
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
    surfaceSidebar: '#16241b',
    onSidebar: '#bcc7be',
    onSidebarMuted: '#8b968c',
    sidebarActive: '#153a26',
    onSidebarActive: '#86efac',
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

/**
 * A multi-stop gradient, in the shape `expo-linear-gradient` takes: colours, and where each one sits
 * along the sweep. The direction is the caller's — it depends on the surface, not on the palette.
 */
export interface GradientToken {
    readonly colours: readonly [string, string, ...string[]];
    readonly locations: readonly [number, number, ...number[]];
}

export const GRADIENT_NAMES = [
    'hero',
    'accent',
    'aiBand',
    'aiRail',
    'canopy',
    'heroScrim',
    'accentScrim',
    'canopyScrim',
] as const;
export type GradientName = (typeof GRADIENT_NAMES)[number];

/**
 * The signature gradients.
 *
 * They are the same in both themes: each one is a brand surface carrying its own light text, not a
 * page colour that has to invert. A gradient cannot be a CSS custom property that a class swap
 * re-themes the way the roles above are, so these are read from here as values — never re-typed at
 * a call site, which is how two heroes drift a shade apart.
 *
 * Each `*Scrim` is the dark → transparent layer laid along the reading direction over the gradient
 * of the same name, so light text lands on the dark side and clears AA. axe cannot measure contrast
 * over a gradient; the scrim is for the reader.
 */
export const gradients: Readonly<Record<GradientName, GradientToken>> = {
    /** Emerald → lime → violet: the mood board's hero / brand gradient. */
    hero: { colours: [palette.primary, palette.secondary, palette.ai], locations: [0, 0.52, 1] },
    /** Violet → emerald: the AI / premium accent — brand marks and AI entry points. */
    accent: { colours: [palette.ai, palette.primary], locations: [0, 1] },
    /**
     * The AI surface's band — §4 Rule 5, `linear-gradient(120deg, #6D28D9 0%, #4C1D95 62%, #157043
     * 160%)`: two violets settling into a deep green foot. The third stop sits at 1 rather than 1.6
     * because that is what renders — the library clamps it — and a token that says 1.6 while the
     * browser draws 1.0 costs somebody an afternoon.
     */
    aiBand: { colours: [palette.ai, violet[900], '#157043'], locations: [0, 0.62, 1] },
    /** The AI surface's leading rail — steeper, and only the two violets. */
    aiRail: { colours: [palette.ai, violet[900]], locations: [0, 1] },
    /** Deep forest into a brighter green: the page-hero and storefront band, and the auth aside. */
    canopy: {
        colours: [themeLight.surfaceCanopy, themeLight.surfaceCanopyDeep, '#0e6b41'],
        locations: [0, 0.58, 1],
    },
    heroScrim: { colours: ['rgba(6,20,12,0.82)', 'rgba(6,20,12,0.28)'], locations: [0, 1] },
    accentScrim: { colours: ['rgba(12,10,34,0.72)', 'rgba(6,20,12,0.42)'], locations: [0, 1] },
    canopyScrim: {
        colours: [withAlpha(themeLight.surfaceCanopy, 0.92), withAlpha(themeLight.surfaceCanopy, 0.35)],
        locations: [0, 1],
    },
};

/**
 * Chart inks — the few graphic colours a chart needs that no surface role covers.
 *
 * Per theme, because a gridline that reads on the mint page vanishes on the dark one. Fills and
 * gridlines are translucent on purpose: they sit *under* a stroke and must let the surface through.
 */
export interface ChartColours {
    readonly stroke: string;
    readonly areaFill: string;
    readonly grid: string;
    /** The unfilled remainder of a ring. */
    readonly track: string;
}

export const chartColours: Readonly<Record<ThemeName, ChartColours>> = {
    light: {
        stroke: palette.primary,
        areaFill: withAlpha(palette.primary, 0.14),
        grid: withAlpha(neutral[900], 0.08),
        track: withAlpha(neutral[400], 0.25),
    },
    dark: {
        stroke: palette.primary,
        areaFill: withAlpha(palette.primary, 0.22),
        grid: withAlpha(pureWhite, 0.08),
        track: withAlpha(neutral[400], 0.25),
    },
};
