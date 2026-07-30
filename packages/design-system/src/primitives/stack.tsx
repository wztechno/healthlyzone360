import { View } from 'react-native';
import type { ViewProps } from 'react-native';

import { cx } from '../internal/class-names.ts';

/**
 * Layout primitives.
 *
 * `Stack` is a column, `Inline` a row. Both space their children with `gap-*`, which is
 * direction-neutral and therefore needs no mirroring at all — the single most effective RTL
 * decision available, because a layout with no physical margins cannot get RTL wrong.
 *
 * Cross-axis alignment uses `items-start` / `items-end`, which are flexbox *logical* keywords
 * (`flex-start` / `flex-end`) and follow the writing direction. They are not the banned physical
 * `text-left` family.
 */

export const SPACE_STEPS = ['none', 'xs', 'sm', 'md', 'lg', 'xl'] as const;
export type SpaceStep = (typeof SPACE_STEPS)[number];

const GAP_CLASS: Readonly<Record<SpaceStep, string>> = {
    none: 'gap-0',
    xs: 'gap-1',
    sm: 'gap-2',
    md: 'gap-4',
    lg: 'gap-6',
    xl: 'gap-8',
};

export const ALIGNMENTS = ['start', 'center', 'end', 'stretch', 'baseline'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

const ALIGN_ITEMS_CLASS: Readonly<Record<Alignment, string>> = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
    stretch: 'items-stretch',
    baseline: 'items-baseline',
};

export const JUSTIFICATIONS = ['start', 'center', 'end', 'between', 'around'] as const;
export type Justification = (typeof JUSTIFICATIONS)[number];

const JUSTIFY_CLASS: Readonly<Record<Justification, string>> = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
    around: 'justify-around',
};

export interface StackProps extends Omit<ViewProps, 'className' | 'style'> {
    readonly space?: SpaceStep | undefined;
    readonly align?: Alignment | undefined;
    readonly justify?: Justification | undefined;
    readonly grow?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function Stack({
    space = 'md',
    align,
    justify,
    grow,
    className,
    children,
    ...rest
}: StackProps) {
    return (
        <View
            {...rest}
            className={cx(
                'flex-col',
                GAP_CLASS[space],
                align === undefined ? null : ALIGN_ITEMS_CLASS[align],
                justify === undefined ? null : JUSTIFY_CLASS[justify],
                grow === true ? 'flex-1' : null,
                className,
            )}
        >
            {children}
        </View>
    );
}

export interface InlineProps extends StackProps {
    /** Allow items to wrap onto the next line. On by default: unwrapped rows overflow in Arabic. */
    readonly wrap?: boolean | undefined;
}

export function Inline({
    space = 'sm',
    align = 'center',
    justify,
    wrap = true,
    grow,
    className,
    children,
    ...rest
}: InlineProps) {
    return (
        <View
            {...rest}
            className={cx(
                'flex-row',
                wrap ? 'flex-wrap' : 'flex-nowrap',
                GAP_CLASS[space],
                ALIGN_ITEMS_CLASS[align],
                justify === undefined ? null : JUSTIFY_CLASS[justify],
                grow === true ? 'flex-1' : null,
                className,
            )}
        >
            {children}
        </View>
    );
}
