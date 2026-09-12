/**
 * Typography tokens.
 *
 * **One family per script, and that is the whole list.** Schibsted Grotesk for Latin, IBM Plex Sans
 * Arabic for Arabic. Nothing picks a second face for emphasis: a heading, a price, a column label
 * and a paragraph are the same typeface at different sizes and weights.
 *
 * This is the end of the staging `CLAUDE.md` describes. The product briefly shipped four Latin
 * faces at once — Inter for body, Space Grotesk for headings, Schibsted Grotesk on the admin, IBM
 * Plex Mono for figures — because the Catalogue adopted the new family before the customer surfaces
 * did. Four faces is what a reader sees as "the fonts do not match", and it cost four webfont
 * payloads to say nothing. `displayFamilies` and `monoFamilies` survive as *roles* so callers keep
 * their meaning, but both now resolve to the same stack; `adminFamilies` is gone entirely.
 *
 * Figures that have to line up in a column get {@link TABULAR_NUMERIC_CLASS}, not a mono typeface.
 *
 * Arabic script needs materially more vertical room than Latin at the same optical size —
 * ascenders, descenders and diacritics collide at Latin line heights — so the line-height
 * multiplier is per script (1.5 Latin, 1.75 Arabic) rather than a single global value. Components
 * read the multiplier for the *active locale's script*, never a hard-coded number.
 */

/**
 * How a column of figures lines up on its digits now that there is no mono face.
 *
 * Proportional digits are why a total never appears to sit under its addends. A monospaced
 * *typeface* fixes that and costs a second family on every screen carrying a price; `tabular-nums`
 * fixes it inside the family already loaded, by asking for the fixed-advance figures Schibsted
 * Grotesk ships. Web-only in effect — React Native maps it where it can and ignores it otherwise,
 * which degrades to proportional figures rather than to a wrong font.
 */
export const TABULAR_NUMERIC_CLASS = 'tabular-nums';

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
        regular: 'SchibstedGrotesk_400Regular',
        medium: 'SchibstedGrotesk_500Medium',
        semibold: 'SchibstedGrotesk_600SemiBold',
        bold: 'SchibstedGrotesk_700Bold',
        stack: "'Schibsted Grotesk', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    },
    arabic: {
        regular: 'IBMPlexSansArabic_400Regular',
        medium: 'IBMPlexSansArabic_500Medium',
        semibold: 'IBMPlexSansArabic_600SemiBold',
        bold: 'IBMPlexSansArabic_700Bold',
        stack: "'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
    },
};

/**
 * Display role — the same family, at its bold cuts.
 *
 * It was Space Grotesk, a second typeface reserved for headings, KPIs and numeric emphasis. A
 * heading does not need a different *typeface* to read as a heading; it needs size, weight and
 * space, all of which the ramp already gives it. Keeping the role while collapsing the family is
 * deliberate: call sites that mean "this is display type" keep saying so, and there is exactly one
 * place to change if that ever stops being true.
 *
 * Arabic keeps IBM Plex Sans Arabic. Schibsted Grotesk carries no Arabic glyphs, and the Latin
 * stack lists Plex next so the web's per-glyph fallback renders a mixed heading correctly.
 */
export const displayFamilies: Readonly<Record<Script, FontFamilyTokens>> = {
    latin: {
        regular: 'SchibstedGrotesk_600SemiBold',
        medium: 'SchibstedGrotesk_600SemiBold',
        semibold: 'SchibstedGrotesk_700Bold',
        bold: 'SchibstedGrotesk_700Bold',
        stack: "'Schibsted Grotesk', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    },
    arabic: {
        regular: 'IBMPlexSansArabic_600SemiBold',
        medium: 'IBMPlexSansArabic_600SemiBold',
        semibold: 'IBMPlexSansArabic_700Bold',
        bold: 'IBMPlexSansArabic_700Bold',
        stack: "'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif",
    },
};

/**
 * Numeric role — the same family, with {@link TABULAR_NUMERIC_CLASS} doing the alignment.
 *
 * It was IBM Plex Mono. The job was never "look like code"; it was that a right-aligned cost column
 * must line up on its digits, which proportional figures break. `tabular-nums` buys exactly that
 * from the family already loaded, so a price sits under a price without a fourth webfont and
 * without a price looking like it came from a different product than the label beside it.
 *
 * The role stays so callers keep saying "this is a figure" — `Text variant="mono"` still means
 * something, and it is still the one variant that opts out of nothing.
 */
export const monoFamilies: Readonly<Record<Script, FontFamilyTokens>> = {
    latin: {
        regular: 'SchibstedGrotesk_400Regular',
        medium: 'SchibstedGrotesk_500Medium',
        semibold: 'SchibstedGrotesk_600SemiBold',
        bold: 'SchibstedGrotesk_700Bold',
        stack: "'Schibsted Grotesk', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
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
/** The CSS/RN weight string a name resolves to. */
export type FontWeightValue = (typeof fontWeights)[FontWeightName];

/** Letter spacing in density-independent pixels. Arabic never receives positive tracking. */
export const letterSpacing = {
    tight: -0.4,
    normal: 0,
    wide: 0.4,
} as const;
export type LetterSpacingName = keyof typeof letterSpacing;

/**
 * Display tracking — for Space Grotesk at {@link DISPLAY_SIZE_THRESHOLD} and above.
 *
 * Expressed in `em` rather than px, which is why it is not a fourth stop on {@link letterSpacing}:
 * the three above are absolute and the same at every size, but display tracking has to scale with
 * the type or it means nothing. `tight` (−0.4px) is a tenth of what a 48px heading needs, and large
 * display type set at normal tracking genuinely reads loose.
 *
 * Web only in practice: React Native's `letterSpacing` takes a number of points and has no `em`, so
 * native headings keep their default tracking. The design is reviewed on the web, and inventing a
 * single px value here would be wrong at three of the four display sizes.
 */
export const displayLetterSpacing = '-0.02em';

/**
 * The Catalogue's type ramp — eight roles, named for the job rather than the size.
 *
 * **Additive.** {@link fontSizes} is untouched, so every screen outside the admin renders exactly
 * as it did. A role is opted into (`<Text role="body">`), never inherited, which is what keeps the
 * customer surfaces out of an admin redesign.
 *
 * Named rather than numbered because the point of the ramp is that a decision is made once: a
 * column label is `micro` everywhere, and nobody re-picks between 10 and 11 per screen. The eight
 * cover what the Catalogue actually renders and no more — `handoff-claude-code.md` §1.2.
 *
 * **Tracking is resolved to absolute pixels, not `em`.** {@link displayLetterSpacing} has to be
 * `em` because one value serves four display sizes; a role has exactly one size, so its `em` can be
 * multiplied out here — and React Native takes points and cannot read `em` at all, so this is the
 * only form that means the same thing on both platforms. The source values are −0.01em on `title`
 * and −0.015em on `display`; `micro` and `section` were 0.06em and 0.02em while they were set in
 * capitals, and went to zero with the capitals.
 */
export const TEXT_ROLE_NAMES = [
    'micro',
    'caption',
    'body',
    'label',
    'strong',
    'section',
    'title',
    'display',
] as const;
export type TextRoleName = (typeof TEXT_ROLE_NAMES)[number];

export interface TextRole {
    /** Size in dp. */
    readonly size: number;
    /** Latin line height in dp — hand-tuned per role, not the body multiplier. */
    readonly lineHeight: number;
    readonly weight: FontWeightValue;
    /** Absolute tracking in dp, already resolved from the design's `em`. */
    readonly letterSpacing: number;
    readonly uppercase: boolean;
}

export const textRoles: Readonly<Record<TextRoleName, TextRole>> = {
    /**
     * Column labels and eyebrows.
     *
     * Sentence case, and tracked at zero. Both were once the opposite — 0.06em of open tracking on
     * capitals — and the pair went together: tracking is what makes a run of capitals legible, and
     * on sentence case the same value only pulls words apart. Dropping the capitals without
     * dropping the tracking is the half-change that reads as a bug.
     */
    micro: { size: 10, lineHeight: 14, weight: '600', letterSpacing: 0, uppercase: false },
    /** Helper text, meta, the list summary line. */
    caption: { size: 11, lineHeight: 16, weight: '400', letterSpacing: 0, uppercase: false },
    /** Body copy, table cells, input values. */
    body: { size: 12, lineHeight: 18, weight: '400', letterSpacing: 0, uppercase: false },
    /** Field labels, tabs, button text. Same size as `body`, tighter leading and more weight. */
    label: { size: 12, lineHeight: 16, weight: '500', letterSpacing: 0, uppercase: false },
    /** A list item's or card's title. */
    strong: { size: 13, lineHeight: 18, weight: '600', letterSpacing: 0, uppercase: false },
    /** Section headings inside a form. Sentence case, for the reason `micro` states. */
    section: { size: 13, lineHeight: 18, weight: '600', letterSpacing: 0, uppercase: false },
    /** The page title — 16, where the current admin uses 30. */
    title: { size: 16, lineHeight: 22, weight: '600', letterSpacing: -0.16, uppercase: false },
    /** One number, rarely. */
    display: { size: 20, lineHeight: 26, weight: '700', letterSpacing: -0.3, uppercase: false },
};

/**
 * Line height for a role in a script.
 *
 * Latin takes the role's own hand-tuned value; Arabic is derived from
 * {@link lineHeightMultipliers} instead, because a ramp tuned to Latin ascenders collides with
 * Arabic diacritics at every one of these sizes. Rounded to a whole pixel for the same reason
 * {@link lineHeightFor} rounds.
 */
export function textRoleLineHeight(role: TextRoleName, script: Script): number {
    const { size, lineHeight } = textRoles[role];

    return script === 'latin' ? lineHeight : Math.round(size * lineHeightMultipliers[script]);
}

/**
 * Tracking for a role in a script — the enforcement of {@link letterSpacing}'s standing rule that
 * Arabic never receives positive tracking.
 *
 * Latin letters sit apart already, so opening them further is a stylistic choice. Arabic is
 * cursive: letters in a word are joined, and positive tracking pulls those joins apart into
 * something that is not merely loose but genuinely harder to read.
 *
 * No role carries positive tracking today — `micro` and `section` were the two, and lost it when
 * they stopped being set in capitals — so this currently changes nothing. It stays because it is a
 * *rule* about the ramp rather than a fix for two entries in it: the next role that wants an open
 * eyebrow gets caught here instead of shipping broken Arabic.
 *
 * Negative tracking is passed through: tightening does not break a join.
 */
export function textRoleLetterSpacing(role: TextRoleName, script: Script): number {
    const { letterSpacing: tracking } = textRoles[role];

    return script !== 'latin' && tracking > 0 ? 0 : tracking;
}

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
