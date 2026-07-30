import { Text as RNText } from 'react-native';
import type { TextProps as RNTextProps } from 'react-native';

import { cx } from '../internal/class-names.ts';

/**
 * Typography.
 *
 * Alignment is always logical (`text-start` / `text-end`), never `text-left` / `text-right` — the
 * physical utilities are banned by the root ESLint config, because they do not mirror for Arabic.
 * Script-aware families and line heights come from the token preset via `html:lang(...)` on web and
 * the font stack on native, so nothing here has to know which script it is rendering.
 */

export const TEXT_VARIANTS = ['body', 'bodyStrong', 'caption', 'label', 'mono'] as const;
export type TextVariant = (typeof TEXT_VARIANTS)[number];

export const TEXT_TONES = [
    'primary',
    'secondary',
    'disabled',
    'inverse',
    'danger',
    'success',
    'warning',
    'info',
] as const;
export type TextTone = (typeof TEXT_TONES)[number];

export const TEXT_ALIGNMENTS = ['start', 'end', 'center'] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

const VARIANT_CLASS: Readonly<Record<TextVariant, string>> = {
    body: 'text-base',
    bodyStrong: 'text-base font-semibold',
    caption: 'text-xs',
    label: 'text-sm font-medium',
    mono: 'text-sm',
};

const TONE_CLASS: Readonly<Record<TextTone, string>> = {
    primary: 'text-content-primary',
    secondary: 'text-content-secondary',
    disabled: 'text-content-disabled',
    inverse: 'text-content-inverse',
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

export interface TextProps extends Omit<RNTextProps, 'className' | 'style'> {
    readonly variant?: TextVariant | undefined;
    readonly tone?: TextTone | undefined;
    readonly align?: TextAlignment | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Text({
    variant = 'body',
    tone = 'primary',
    align = 'start',
    className,
    children,
    ...rest
}: TextProps) {
    return (
        <RNText
            {...rest}
            className={cx(VARIANT_CLASS[variant], TONE_CLASS[tone], ALIGN_CLASS[align], className)}
        >
            {children}
        </RNText>
    );
}

export const HEADING_LEVELS = [1, 2, 3, 4] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

const HEADING_CLASS: Readonly<Record<HeadingLevel, string>> = {
    1: 'text-3xl font-bold',
    2: 'text-2xl font-semibold',
    3: 'text-xl font-semibold',
    4: 'text-base font-semibold',
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
    return (
        <RNText
            {...rest}
            accessibilityRole="header"
            aria-level={level}
            className={cx(HEADING_CLASS[level], TONE_CLASS[tone], ALIGN_CLASS[align], className)}
        >
            {children}
        </RNText>
    );
}
