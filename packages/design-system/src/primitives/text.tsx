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
    micro: 'text-role-micro',
    caption: 'text-xs',
    body: 'text-base',
    bodyStrong: 'text-base font-semibold',
    label: 'text-sm font-medium',
    strong: 'text-role-strong',
    section: 'text-role-section',
    title: 'text-role-title',
    display: 'text-role-display',
    mono: 'text-sm tabular-nums',
};

/** The Catalogue ladder. Every size is a `role-*` token; none is written here. */
const COMPACT_VARIANT_CLASS: Readonly<Record<TextVariant, string>> = {
    micro: 'text-role-micro',
    caption: 'text-role-caption',
    body: 'text-role-body',
    bodyStrong: 'text-role-strong',
    label: 'text-role-label',
    strong: 'text-role-strong',
    section: 'text-role-section',
    title: 'text-role-title',
    display: 'text-role-display',
    mono: 'text-role-body tabular-nums',
};

const VARIANT_CLASS: Readonly<Record<Density, Readonly<Record<TextVariant, string>>>> = {
    comfortable: COMFORTABLE_VARIANT_CLASS,
    compact: COMPACT_VARIANT_CLASS,
};

/**
 * Kept as an empty string, deliberately, for one release.
 *
 * There is one Latin family now, set on `html` per script, so no component has to name a face —
 * `font-admin` does not exist in the preset any more. This stays as a named constant rather than
 * being deleted outright because it was exported from the package root and third-party call sites
 * concatenate it; an empty class is inert wherever it lands, while a missing export is a build
 * break. Delete it, and {@link densityFontClass}, on the next breaking change.
 *
 * @deprecated There is one family. Nothing needs to ask for it.
 */
export const ADMIN_FONT_CLASS = '';

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

/**
 * The one place a component asked "which family does text take here?".
 *
 * Always `null`, and no longer called anywhere in this package: the answer is the same everywhere,
 * so `Text`, `Heading`, `Button`, `Card` and `Select` state no family at all. It is kept, like
 * {@link ADMIN_FONT_CLASS}, only because it was exported from the package root — a `null` return
 * is inert in a `cx(…)` wherever a third party still calls it, while a missing export is a build
 * break. Delete both on the next breaking change.
 *
 * @deprecated There is one family. Nothing needs to ask for it.
 */
export function densityFontClass(_density: Density, _variant: TextVariant = 'body'): string | null {
    return null;
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
            // No family class: one Latin family, set on `html` per script. `mono` differs by
            // asking for fixed-advance digits (`tabular-nums`), not by asking for another face.
            className={cx(
                VARIANT_CLASS[density][variant],
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
    3: 'text-role-section',
    4: 'text-role-section',
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
            // No family class at all. A heading used to carry `font-display` (Space Grotesk) on the
            // customer surfaces and `font-admin` (Schibsted Grotesk) on the admin — two faces, and
            // a third on the page under them. There is one family now, set on `html` per script, so
            // a heading is the ramp's size and weight and nothing else. That also retires the
            // hydration hazard the old comment described: no family class means no class that could
            // differ between the static export and the client.
            className={cx(
                HEADING_CLASS[density][level],
                TONE_CLASS[tone],
                ALIGN_CLASS[align],
                className,
            )}
        >
            {children}
        </RNText>
    );
}
