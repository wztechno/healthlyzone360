import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { cx } from '../internal/class-names.ts';

/**
 * Typography.
 *
 * Alignment is always logical (`text-start` / `text-end`), never `text-left` / `text-right` — the
 * physical utilities are banned by the root ESLint config, because they do not mirror for Arabic.
 * Script-aware families and line heights come from the token preset via `html:lang(...)` on web and
 * the font stack on native, so nothing here has to know which script it is rendering.
 *
 * ## Two ramps, one component
 *
 * The eight `role-*` sizes are the Catalogue ramp from the handoff (§1.2) — 10/11/12/13/16/20px,
 * with their weights and tracking baked into the token so a caller cannot set 13px at the wrong
 * weight. They render at those sizes only under `DensityProvider value="compact"`; on the customer
 * surfaces the same variant names resolve to the shipped 12/14/16px scale, so moving a screen onto
 * this ramp is a density change rather than a rewrite.
 *
 * `micro` / `strong` / `section` / `title` / `display` are new and have no customer-side history,
 * so they take the role sizes in both densities — there is nothing to preserve.
 */

export const TEXT_VARIANTS = [
    'micro',
    'caption',
    'body',
    'bodyStrong',
    'label',
    'strong',
    'section',
    'title',
    'display',
    'mono',
] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

export const TEXT_TONES = [
    'primary',
    'secondary',
    'disabled',
    'inverse',
    'brand',
    'danger',
    'success',
    'warning',
    'info',
] as const;
export type TextTone = (typeof TEXT_TONES)[number];

export const TEXT_ALIGNMENTS = ['start', 'end', 'center'] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

/**
 * The customer ladder. `body`, `bodyStrong`, `caption`, `label` and `mono` keep exactly the classes
 * they shipped with — a phone reads 12px body as fine print, and this pass does not change what the
 * customer app renders.
 */
const COMFORTABLE_VARIANT_CLASS: Readonly<Record<TextVariant, string>> = {
    micro: 'text-role-micro uppercase',
    caption: 'text-xs',
    body: 'text-base',
    bodyStrong: 'text-base font-semibold',
    label: 'text-sm font-medium',
    strong: 'text-role-strong',
    section: 'text-role-section uppercase',
    title: 'text-role-title',
    display: 'text-role-display',
    mono: 'text-sm font-mono',
};

/** The Catalogue ladder. Every size is a `role-*` token; none is written here. */
const COMPACT_VARIANT_CLASS: Readonly<Record<TextVariant, string>> = {
    micro: 'text-role-micro uppercase',
    caption: 'text-role-caption',
    body: 'text-role-body',
    bodyStrong: 'text-role-strong',
    label: 'text-role-label',
    strong: 'text-role-strong',
    section: 'text-role-section uppercase',
    title: 'text-role-title',
    display: 'text-role-display',
    mono: 'text-role-body font-mono',
};

const VARIANT_CLASS: Readonly<Record<Density, Readonly<Record<TextVariant, string>>>> = {
    comfortable: COMFORTABLE_VARIANT_CLASS,
    compact: COMPACT_VARIANT_CLASS,
};

/**
 * Schibsted Grotesk, on the admin only.
 *
 * `font-admin` is additive in the preset — it does not replace `latin`, so the customer app keeps
 * Inter and never asks the browser for a face it does not render. `mono` states its own family, so
 * it is excluded rather than being left to lose on source order.
 */
export const ADMIN_FONT_CLASS = 'font-admin';

const TONE_CLASS: Readonly<Record<TextTone, string>> = {
    primary: 'text-content-primary',
    secondary: 'text-content-secondary',
    disabled: 'text-content-disabled',
    inverse: 'text-content-inverse',
    // The ink that reads as "brand" on an ordinary page surface. `onBrandSurfaceSubtle` rather
    // than the brand fill itself: the fill is a *background* role and putting it on text is how a
    // figure ends up at 2.4:1 on white. `Badge`'s brand tone already spends exactly this pair.
    brand: 'text-content-on-brand-subtle',
    danger: 'text-danger-strong',
    success: 'text-success-strong',
    warning: 'text-warning-strong',
    info: 'text-info-strong',
};

const ALIGN_CLASS: Readonly<Record<TextAlignment, string>> = {
    start: 'text-start',
    end: 'text-end',
    center: 'text-center',
};

/** The one place a component asks "which family does text take here?". */
export function densityFontClass(density: Density, variant: TextVariant = 'body'): string | null {
    if (density !== 'compact') return null;
    return variant === 'mono' ? null : ADMIN_FONT_CLASS;
}

export interface TextProps extends Omit<RNTextProps, 'className' | 'style'> {
    readonly variant?: TextVariant | undefined;
    readonly tone?: TextTone | undefined;
    readonly align?: TextAlignment | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Body text.
 *
 * **`className` cannot reliably recolour or resize this.** The variant and tone classes are emitted
 * ahead of a caller's `className`, and which of two same-specificity utilities wins is decided by
 * stylesheet order, not by the order they appear in the attribute. `<Text className="text-2xl
 * text-content-on-canopy">` has shipped as 16px `content-primary` more than once, and one of those
 * was 2.13:1 on a dark chip until axe caught it.
 *
 * So: pick the `variant` and `tone` that say what you mean. If neither can — a display-face price,
 * a 48px hero title, a label on the canopy, none of which this scale covers — reach for React
 * Native's own `Text` and state the classes there, where nothing competes with them.
 */
export function Text({
    variant = 'body',
    tone = 'primary',
    align = 'start',
    className,
    children,
    ...rest
}: TextProps) {
    const density = useDensity();

    return (
        <RNText
            {...rest}
            className={cx(
                VARIANT_CLASS[density][variant],
                densityFontClass(density, variant),
                TONE_CLASS[tone],
                ALIGN_CLASS[align],
                className,
            )}
        >
            {children}
        </RNText>
    );
}

export const HEADING_LEVELS = [1, 2, 3, 4] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

const COMFORTABLE_HEADING_CLASS: Readonly<Record<HeadingLevel, string>> = {
    1: 'text-3xl font-bold',
    2: 'text-2xl font-semibold',
    3: 'text-xl font-semibold',
    4: 'text-base font-semibold',
};

/**
 * The admin has one page title and one section title, not four heading sizes. Levels 1 and 2 both
 * land on `role-title` (16px — the handoff's "was `text-3xl`") and 3 and 4 on `role-section`, so
 * the document outline stays intact for a screen reader while the page stops shouting.
 */
const COMPACT_HEADING_CLASS: Readonly<Record<HeadingLevel, string>> = {
    1: 'text-role-title',
    2: 'text-role-title',
    3: 'text-role-section uppercase',
    4: 'text-role-section uppercase',
};

const HEADING_CLASS: Readonly<Record<Density, Readonly<Record<HeadingLevel, string>>>> = {
    comfortable: COMFORTABLE_HEADING_CLASS,
    compact: COMPACT_HEADING_CLASS,
};

export interface HeadingProps extends Omit<TextProps, 'variant'> {
    readonly level?: HeadingLevel | undefined;
}

/**
 * A heading carries `accessibilityRole="header"` and, on the web, an `aria-level`. Without the
 * level, react-native-web renders every heading as an unlevelled `role="heading"`, which axe
 * reports and which flattens the document outline for screen reader users.
 */
export function Heading({
    level = 2,
    tone = 'primary',
    align = 'start',
    className,
    children,
    ...rest
}: HeadingProps) {
    const density = useDensity();

    return (
        <RNText
            {...rest}
            accessibilityRole="header"
            aria-level={level}
            // Headings carry the display face (Space Grotesk). It is a *static* class rather than one
            // chosen by a runtime `useIsRtl()` hook on purpose: a hook-driven class differs between
            // the static web export and client hydration and throws React #418, which strands the
            // page un-hydrated. Arabic stays legible through the display stack's per-glyph fallback to
            // IBM Plex Sans Arabic (see typography.ts).
            //
            // The admin has no display face: Schibsted Grotesk sets body and headings alike, so the
            // compact branch takes `font-admin` in its place rather than stacking the two.
            className={cx(
                HEADING_CLASS[density][level],
                density === 'compact' ? ADMIN_FONT_CLASS : 'font-display',
                TONE_CLASS[tone],
                ALIGN_CLASS[align],
                className,
            )}
        >
            {children}
        </RNText>
    );
}
