import { Text as RNText, View } from 'react-native';

import { cx } from '../internal/class-names.ts';

export const AVATAR_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

const SIZE_CLASS: Readonly<Record<AvatarSize, string>> = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16',
};

const SIZE_TEXT_CLASS: Readonly<Record<AvatarSize, string>> = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-xl',
};

/**
 * Token-driven surfaces a generated identity may land on.
 *
 * Every entry pairs a background with the foreground the contrast tests already prove legible on
 * it, so a hash can never select an illegible combination.
 */
const IDENTITY_SURFACES = [
    { surface: 'bg-surface-brand-subtle', on: 'text-content-on-brand-subtle' },
    { surface: 'bg-info-subtle', on: 'text-info-on-subtle' },
    { surface: 'bg-success-subtle', on: 'text-success-on-subtle' },
    { surface: 'bg-warning-subtle', on: 'text-warning-on-subtle' },
    { surface: 'bg-surface-sunken', on: 'text-content-primary' },
] as const;

/**
 * A stable 32-bit hash of a seed string.
 *
 * Deterministic on purpose: the same kitchen gets the same colour on every device, in every
 * session, in both locales, with no state stored anywhere and no request to a remote avatar
 * service — which is also the rule this design system is held to (no remote images at all).
 */
export function seedHash(seed: string): number {
    let hash = 2166136261;
    for (const codePoint of seed) {
        hash ^= codePoint.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash | 0);
}

/**
 * Up to two initials, taken by code point so Arabic and any other non-Latin script survive.
 * `String.prototype[0]` would split a surrogate pair and render half a character.
 */
export function initialsFrom(name: string): string {
    const words = name
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0);
    if (words.length === 0) return '';
    const first = Array.from(words[0]!)[0] ?? '';
    if (words.length === 1) return first.toLocaleUpperCase();
    const last = Array.from(words.at(-1)!)[0] ?? '';
    return `${first}${last}`.toLocaleUpperCase();
}

export interface AvatarProps {
    /** Shown as initials and announced as the accessible name. */
    readonly name: string;
    /** Overrides what the colour is derived from — an id keeps the colour stable across renames. */
    readonly seed?: string | undefined;
    readonly size?: AvatarSize | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Avatar — generated, never fetched.
 *
 * There are no remote images anywhere in this design system. A prototype that loads portraits from
 * a third party leaks its users' identifiers to that party, breaks offline, and makes the
 * screenshot suite depend on somebody else's uptime. Initials on a deterministic surface carry the
 * same "who is this" signal with none of that.
 */
export function Avatar({ name, seed, size = 'md', className, testID }: AvatarProps) {
    const identity = IDENTITY_SURFACES[seedHash(seed ?? name) % IDENTITY_SURFACES.length]!;

    return (
        <View
            testID={testID}
            accessibilityRole="image"
            accessibilityLabel={name}
            aria-label={name}
            className={cx(
                'items-center justify-center rounded-full',
                SIZE_CLASS[size],
                identity.surface,
                className,
            )}
        >
            <RNText
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className={cx('font-semibold', SIZE_TEXT_CLASS[size], identity.on)}
            >
                {initialsFrom(name)}
            </RNText>
        </View>
    );
}

export const IMAGE_PLACEHOLDER_ASPECTS = ['square', 'wide', 'tall'] as const;
export type ImagePlaceholderAspect = (typeof IMAGE_PLACEHOLDER_ASPECTS)[number];

const ASPECT_CLASS: Readonly<Record<ImagePlaceholderAspect, string>> = {
    square: 'aspect-square',
    wide: 'aspect-video',
    tall: 'aspect-[3/4]',
};

/** Pattern glyphs, chosen by hash. Purely typographic — no asset, no network, no licence. */
const PATTERN_GLYPHS = ['◇', '◈', '○', '◍', '△', '▢'] as const;

export interface ImagePlaceholderProps {
    /** What the placeholder stands in for — a meal name, a kitchen id. Drives the pattern. */
    readonly seed: string;
    /** Accessible description of the missing image. */
    readonly label: string;
    readonly aspect?: ImagePlaceholderAspect | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Stands in for a photograph that this prototype does not have and must not borrow.
 *
 * The reference research is explicit that protected photographs may not be copied, and the
 * prototype ships no photography of its own, so every image slot renders a generated pattern
 * instead of an empty grey box. The pattern is derived from the seed, so the same meal always looks
 * the same and a grid of meals looks varied rather than repetitive.
 */
export function ImagePlaceholder({
    seed,
    label,
    aspect = 'wide',
    className,
    testID,
}: ImagePlaceholderProps) {
    const hash = seedHash(seed);
    const identity = IDENTITY_SURFACES[hash % IDENTITY_SURFACES.length]!;
    const glyph = PATTERN_GLYPHS[hash % PATTERN_GLYPHS.length]!;
    const density = 3 + (hash % 3);

    return (
        <View
            testID={testID}
            accessibilityRole="image"
            accessibilityLabel={label}
            aria-label={label}
            className={cx(
                'w-full items-center justify-center overflow-hidden rounded-lg',
                ASPECT_CLASS[aspect],
                identity.surface,
                className,
            )}
        >
            <RNText
                testID={testID === undefined ? undefined : `${testID}-pattern`}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className={cx('text-2xl tracking-widest opacity-60', identity.on)}
            >
                {glyph.repeat(density)}
            </RNText>
        </View>
    );
}
