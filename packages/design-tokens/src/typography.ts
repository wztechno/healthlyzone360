/**
 * Typography tokens.
 *
 * Two families, one per script: Inter for Latin, IBM Plex Sans Arabic for Arabic. Arabic script
 * needs materially more vertical room than Latin at the same optical size — ascenders, descenders
 * and diacritics collide at Latin line heights — so the line-height multiplier is per script
 * (1.5 Latin, 1.75 Arabic) rather than a single global value. Components read the multiplier for
 * the *active locale's script*, never a hard-coded number.
 */

export const SCRIPTS = ['latin', 'arabic'] as const;
export type Script = (typeof SCRIPTS)[number];

export interface FontFamilyTokens {
    /** Key registered with expo-font / the CSS `font-family` name. */
    readonly regular: string;
    readonly medium: string;
    readonly semibold: string;
    readonly bold: string;
    /** CSS font stack including fallbacks, used on web. */
    readonly stack: string;
}

export const fontFamilies: Readonly<Record<Script, FontFamilyTokens>> = {
    latin: {
        regular: 'Inter_400Regular',
        medium: 'Inter_500Medium',
        semibold: 'Inter_600SemiBold',
        bold: 'Inter_700Bold',
        stack: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    },
    arabic: {
        regular: 'IBMPlexSansArabic_400Regular',
        medium: 'IBMPlexSansArabic_500Medium',
        semibold: 'IBMPlexSansArabic_600SemiBold',
        bold: 'IBMPlexSansArabic_700Bold',
        stack: "'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
    },
};

/** Line-height multipliers, per script. Applied to the font size to get a line height. */
export const lineHeightMultipliers: Readonly<Record<Script, number>> = {
    latin: 1.5,
    arabic: 1.75,
};

/** Tighter multipliers for display-sized headings, where 1.5/1.75 looks loose. */
export const displayLineHeightMultipliers: Readonly<Record<Script, number>> = {
    latin: 1.2,
    arabic: 1.4,
};

export const FONT_SIZE_NAMES = [
    'xs',
    'sm',
    'base',
    'lg',
    'xl',
    '2xl',
    '3xl',
    '4xl',
    '5xl',
] as const;
export type FontSizeName = (typeof FONT_SIZE_NAMES)[number];

/** Sizes in density-independent pixels. */
export const fontSizes: Readonly<Record<FontSizeName, number>> = {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
    '5xl': 48,
};

/** Sizes at or above this use the display multipliers. */
export const DISPLAY_SIZE_THRESHOLD = 30;

export const fontWeights = {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
} as const;
export type FontWeightName = keyof typeof fontWeights;

/** Letter spacing in density-independent pixels. Arabic never receives positive tracking. */
export const letterSpacing = {
    tight: -0.4,
    normal: 0,
    wide: 0.4,
} as const;
export type LetterSpacingName = keyof typeof letterSpacing;

/**
 * Resolved line height for a size in a script, rounded to a whole pixel so text baselines line up
 * across platforms (React Native does not sub-pixel line heights consistently).
 */
export function lineHeightFor(size: FontSizeName, script: Script): number {
    const value = fontSizes[size];
    const multiplier =
        value >= DISPLAY_SIZE_THRESHOLD
            ? displayLineHeightMultipliers[script]
            : lineHeightMultipliers[script];
    return Math.round(value * multiplier);
}

/** Every size × script line height, precomputed for the generators. */
export const lineHeights: Readonly<Record<Script, Readonly<Record<FontSizeName, number>>>> = {
    latin: Object.fromEntries(
        FONT_SIZE_NAMES.map((name) => [name, lineHeightFor(name, 'latin')]),
    ) as Record<FontSizeName, number>,
    arabic: Object.fromEntries(
        FONT_SIZE_NAMES.map((name) => [name, lineHeightFor(name, 'arabic')]),
    ) as Record<FontSizeName, number>,
};

/** Maps a BCP-47 locale onto the script whose font metrics should be used. */
export function scriptForLocale(locale: string): Script {
    const language = locale.split('-')[0]?.toLowerCase() ?? '';
    return language === 'ar' ? 'arabic' : 'latin';
}
