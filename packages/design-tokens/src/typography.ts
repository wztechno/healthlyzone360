/**
 * Typography tokens.
 *
 * **Two Latin faces, matching the mood board (Option 02, "Wellness Green + AI"): Inter for body,
 * UI, labels and data; Space Grotesk for display — headings, KPIs and numeric emphasis.** Arabic is
 * IBM Plex Sans Arabic in every role, because neither Latin face carries Arabic glyphs.
 *
 * ## Changing a font
 *
 * Edit {@link typefaces} — the family name as Google Fonts spells it, and the weights to load — add
 * its `@expo-google-fonts/*` package to this package's dependencies, and run `pnpm build:tokens`.
 * Everything else is derived from that one entry: the loader keys, the CSS stacks, the Tailwind
 * families, and `generated/fonts.ts`, the manifest the app registers the font files from. A family
 * whose package is missing fails `generators.test.ts` by name.
 *
 * ## Why the web registers families by name
 *
 * The product briefly shipped four Latin faces at once, then collapsed to Schibsted Grotesk alone —
 * and on the web neither state rendered. expo-font registers each file under its loader key
 * (`SchibstedGrotesk_400Regular`) while the CSS asked for the family name (`'Schibsted Grotesk'`),
 * so every screen fell back to the system face. The web now registers each file under its
 * {@link Typeface.family} name with its real weight — `apps/universal/src/brand-fonts.ts`.
 *
 * Figures that have to line up in a column get {@link TABULAR_NUMERIC_CLASS}, not a mono typeface.
 *
 * Arabic script needs materially more vertical room than Latin at the same optical size —
 * ascenders, descenders and diacritics collide at Latin line heights — so the line-height
 * multiplier is per script (1.5 Latin, 1.75 Arabic) rather than a single global value. Components
 * read the multiplier for the *active locale's script*, never a hard-coded number.
 */

/**
 * How a column of figures lines up on its digits without a mono face.
 *
 * Proportional digits are why a total never appears to sit under its addends. A monospaced
 * *typeface* fixes that and costs another family on every screen carrying a price; `tabular-nums`
 * fixes it inside the family already loaded, by asking for the fixed-advance figures Inter ships.
 * Web-only in effect — React Native maps it where it can and ignores it otherwise, which degrades
 * to proportional figures rather than to a wrong font.
 */
export const TABULAR_NUMERIC_CLASS = 'tabular-nums';

export const SCRIPTS = ['latin', 'arabic'] as const;
export type Script = (typeof SCRIPTS)[number];

export const fontWeights = {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
} as const;
export type FontWeightName = keyof typeof fontWeights;
/** The CSS/RN weight string a name resolves to. */
export type FontWeightValue = (typeof fontWeights)[FontWeightName];

/** A typeface the product loads. */
export interface Typeface {
    /** The family name exactly as Google Fonts spells it — `'Space Grotesk'`, not a loader key. */
    readonly family: string;
    /**
     * The cuts to load. A weight that is asked for but not listed renders in the nearest one that
     * is, by the CSS font-matching rules — which is how the mood board sets Space Grotesk: 500 and
     * 700 only, so a 600 heading draws at 700.
     */
    readonly weights: readonly FontWeightValue[];
}

export const TYPEFACE_ROLES = ['body', 'display', 'arabic'] as const;
export type TypefaceRole = (typeof TYPEFACE_ROLES)[number];

/** **The one place a font is chosen.** See "Changing a font" above. */
export const typefaces: Readonly<Record<TypefaceRole, Typeface>> = {
    /** Body, UI, labels, table data and figures. */
    body: { family: 'Inter', weights: ['400', '500', '600', '700'] },
    /** Headings, page titles, KPI values and numeric emphasis. */
    display: { family: 'Space Grotesk', weights: ['500', '700'] },
    /** Every role, in Arabic. */
    arabic: { family: 'IBM Plex Sans Arabic', weights: ['400', '500', '600', '700'] },
};

/** The suffix `@expo-google-fonts` names a cut by. */
const WEIGHT_SUFFIX: Readonly<Record<FontWeightValue, string>> = {
    '400': 'Regular',
    '500': 'Medium',
    '600': 'SemiBold',
    '700': 'Bold',
};

/** `'Space Grotesk'` → `'@expo-google-fonts/space-grotesk'` — the package that ships its files. */
export function typefacePackage(typeface: Typeface): string {
    return `@expo-google-fonts/${typeface.family.toLowerCase().replace(/\s+/g, '-')}`;
}

/** The subpath one cut lives at inside {@link typefacePackage} — `'700Bold'`. */
export function typefaceWeightPath(weight: FontWeightValue): string {
    return `${weight}${WEIGHT_SUFFIX[weight]}`;
}

/**
 * The loader key of one cut — `'SpaceGrotesk_700Bold'`. It is the name the file is exported under,
 * and the family name React Native knows it by once `useFonts` has registered it.
 */
export function typefaceKey(typeface: Typeface, weight: FontWeightValue): string {
    return `${typeface.family.replace(/\s+/g, '')}_${typefaceWeightPath(weight)}`;
}

/**
 * The loaded weight a requested one renders in — the CSS font-matching algorithm, so native (which
 * addresses one file per key) picks the same cut the browser does.
 */
export function resolveWeight(typeface: Typeface, desired: FontWeightValue): FontWeightValue {
    const loaded = [...typeface.weights].sort((a, b) => Number(a) - Number(b));
    const want = Number(desired);
    const above = loaded.filter((weight) => Number(weight) >= want);
    const below = loaded.filter((weight) => Number(weight) < want).reverse();
    // 400–500 look up as far as 500 first, then down, then beyond 500; heavier looks up first.
    let order: FontWeightValue[];
    if (want >= 400 && want <= 500) {
        order = [
            ...above.filter((weight) => Number(weight) <= 500),
            ...below,
            ...above.filter((weight) => Number(weight) > 500),
        ];
    } else if (want > 500) {
        order = [...above, ...below];
    } else {
        order = [...below, ...above];
    }
    const found = order[0];
    if (found === undefined) throw new Error(`${typeface.family} declares no weights`);
    return found;
}

export interface FontFamilyTokens {
    /** Key registered with expo-font — the name React Native addresses one cut by. */
    readonly regular: string;
    readonly medium: string;
    readonly semibold: string;
    readonly bold: string;
    /** CSS font stack including fallbacks, used on web. */
    readonly stack: string;
}

const quote = (family: string) => `'${family}'`;

const SYSTEM_FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const ARABIC_FALLBACK = "'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";

function familyTokens(
    typeface: Typeface,
    stack: string,
    slots: Readonly<Record<FontWeightName, FontWeightValue>> = fontWeights,
): FontFamilyTokens {
    const key = (slot: FontWeightName) =>
        typefaceKey(typeface, resolveWeight(typeface, slots[slot]));
    return {
        regular: key('regular'),
        medium: key('medium'),
        semibold: key('semibold'),
        bold: key('bold'),
        stack,
    };
}

/*
 * The Latin stacks list the Arabic face next, so the web's per-glyph fallback renders a mixed
 * Latin/Arabic string correctly rather than dropping to the system face for the Arabic run.
 */
const bodyStack = [typefaces.body.family, typefaces.arabic.family].map(quote).join(', ');
const displayStack = [typefaces.display.family, typefaces.body.family, typefaces.arabic.family]
    .map(quote)
    .join(', ');
const arabicStack = quote(typefaces.arabic.family);

export const fontFamilies: Readonly<Record<Script, FontFamilyTokens>> = {
    latin: familyTokens(typefaces.body, `${bodyStack}, ${SYSTEM_FALLBACK}`),
    arabic: familyTokens(typefaces.arabic, `${arabicStack}, ${ARABIC_FALLBACK}`),
};

/**
 * Display is set a step heavier than body at every slot: a display "regular" is the semibold cut,
 * which is what makes a heading read as one before its size does.
 */
const DISPLAY_SLOTS: Readonly<Record<FontWeightName, FontWeightValue>> = {
    regular: '600',
    medium: '600',
    semibold: '700',
    bold: '700',
};

/**
 * Display role — Space Grotesk, the mood board's face for headings, KPIs and numeric emphasis.
 *
 * On the web `global.css` applies it to `h1`–`h3` (the mood board's own rule) and to anything
 * carrying `font-display`. Arabic keeps IBM Plex Sans Arabic, at its heavier cuts.
 */
export const displayFamilies: Readonly<Record<Script, FontFamilyTokens>> = {
    latin: familyTokens(typefaces.display, `${displayStack}, ${SYSTEM_FALLBACK}`, DISPLAY_SLOTS),
    arabic: familyTokens(typefaces.arabic, `${arabicStack}, ${ARABIC_FALLBACK}`, DISPLAY_SLOTS),
};

/**
 * Numeric role — the body family, with {@link TABULAR_NUMERIC_CLASS} doing the alignment.
 *
 * The mood board sets data in Inter. A right-aligned cost column has to line up on its digits,
 * which `tabular-nums` buys from the family already loaded. The role stays so callers keep saying
 * "this is a figure" — `Text variant="mono"` still means something.
 */
export const monoFamilies: Readonly<Record<Script, FontFamilyTokens>> = fontFamilies;

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

/** Letter spacing in density-independent pixels. Arabic never receives positive tracking. */
export const letterSpacing = {
    tight: -0.4,
    normal: 0,
    wide: 0.4,
} as const;
export type LetterSpacingName = keyof typeof letterSpacing;

/**
 * Display tracking — for display type at {@link DISPLAY_SIZE_THRESHOLD} and above.
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
