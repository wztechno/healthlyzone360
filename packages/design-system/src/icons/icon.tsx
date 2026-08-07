import { useIsRtl } from '@healthy360/i18n';
import { Text } from 'react-native';
import type { TextProps } from 'react-native';

import { cx } from '../internal/class-names.ts';

/**
 * Icons.
 *
 * Phase 1 draws icons as typographic glyphs rather than pulling in `react-native-svg`. Two reasons,
 * both practical: an SVG library is a *native* module, which would mean a config plugin, an
 * expo-doctor entry and a rebuild of every development client for decorative artwork; and a glyph
 * inherits the surrounding text colour and size for free, which is what a design system wants
 * anyway. Every icon here is decorative — meaning always lives in an adjacent label — so nothing is
 * lost accessibly. Swapping the implementation later is a change to this one file.
 *
 * Direction: `chevronStart` / `chevronEnd` resolve their glyph from the *active locale*, not from a
 * CSS transform. That matters because the NativeWind spike found that inline logical style props do
 * not re-mirror on a live web `dir` change (notes/nativewind-spike.md §4) — but re-picking a
 * character does, since the component re-renders when the locale changes.
 */
export const ICON_GLYPHS = {
    chevronForward: '›',
    chevronBackward: '‹',
    chevronDown: '⌄',
    chevronUp: '⌃',
    check: '✓',
    close: '✕',
    plus: '+',
    minus: '−',
    eye: '◉',
    eyeOff: '◌',
    warning: '⚠',
    info: 'ⓘ',
    error: '✖',
    success: '✔',
    offline: '⊘',
    menu: '☰',
    search: '⌕',
    user: '◍',
    device: '▭',
    organisation: '◈',
    branch: '◇',
    signOut: '⇥',
    refresh: '⟳',
    prototype: '◊',
    dot: '•',
    dotOutline: '◦',
    star: '★',
    starOutline: '☆',
    filter: '⚟',
    calendar: '▤',
    more: '⋯',
    /*
     * Closing the gap `consumer-items.ts` and `onboarding/steps.ts` both used to record.
     *
     * Still characters, not drawings. The handoff's §2.8 originally specified stroked 24×24 SVGs;
     * that was written without this file in front of it, and adopting it would have meant
     * `react-native-svg` — a native module, a config plugin, an expo-doctor entry and a rebuild of
     * every development client — to draw seven decorative marks. The reference art in the design
     * files indicates *meaning and weight*, not form, so the nearest glyph that carries the right
     * meaning is the right answer and approximate fidelity is the accepted outcome.
     *
     * Note what is deliberately absent: `search`, `filter`, `calendar`, `refresh` and `user`
     * already existed. Five of the eight the handoff lists were never missing.
     */
    basket: '⛃',
    home: '⌂',
    plate: '◯',
    lock: '⚿',
    leaf: '❦',
    medicalCross: '✚',
    sparkle: '✧',
} as const;

export type IconGlyphName = keyof typeof ICON_GLYPHS;

/** Names that follow the writing direction instead of a fixed side. */
export const DIRECTIONAL_ICON_NAMES = ['chevronStart', 'chevronEnd'] as const;
export type DirectionalIconName = (typeof DIRECTIONAL_ICON_NAMES)[number];

export type IconName = IconGlyphName | DirectionalIconName;

export const ICON_SIZES = ['sm', 'md', 'lg'] as const;
export type IconSize = (typeof ICON_SIZES)[number];

const SIZE_CLASS: Readonly<Record<IconSize, string>> = {
    sm: 'text-xs',
    md: 'text-base',
    lg: 'text-xl',
};

export interface IconProps extends Omit<TextProps, 'children' | 'className' | 'style'> {
    readonly name: IconName;
    readonly size?: IconSize | undefined;
    readonly className?: string | undefined;
    /**
     * Only set this when the icon is the *sole* carrier of meaning. Everywhere else leave it off:
     * the icon is then hidden from assistive technology and the adjacent text does the talking.
     */
    readonly label?: string | undefined;
    readonly testID?: string | undefined;
}

export function resolveIconGlyph(name: IconName, isRtl: boolean): string {
    if (name === 'chevronEnd') {
        return isRtl ? ICON_GLYPHS.chevronBackward : ICON_GLYPHS.chevronForward;
    }
    if (name === 'chevronStart') {
        return isRtl ? ICON_GLYPHS.chevronForward : ICON_GLYPHS.chevronBackward;
    }
    return ICON_GLYPHS[name];
}

export function Icon({ name, size = 'md', className, label, testID, ...rest }: IconProps) {
    const isRtl = useIsRtl();
    const decorative = label === undefined;

    return (
        <Text
            {...rest}
            testID={testID}
            className={cx(SIZE_CLASS[size], 'leading-none', className)}
            accessible={!decorative}
            accessibilityElementsHidden={decorative}
            importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
            aria-hidden={decorative}
            {...(decorative ? {} : { accessibilityRole: 'image', accessibilityLabel: label })}
        >
            {resolveIconGlyph(name, isRtl)}
        </Text>
    );
}
