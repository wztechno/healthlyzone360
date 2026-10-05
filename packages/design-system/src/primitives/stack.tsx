import { useContext } from 'react';
import { View } from 'react-native';
import type { ViewProps } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { TableCellTextContext } from './text.tsx';

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

export const GAP_CLASS: Readonly<Record<SpaceStep, string>> = {
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

/*
 * `z-auto` on both, and it is load-bearing rather than tidying.
 *
 * React Native Web's base `View` style carries `position: relative; z-index: 0`, so **every View is
 * a stacking context**. That makes a layout primitive silently decide painting order for everything
 * inside it: a `Select`'s anchored dropdown, opened in one `Stack`, painted *under* the next
 * `Stack` down the page no matter how high the panel's own z-index went, because the two Stacks were
 * being compared and the later one won.
 *
 * A row and a column have no opinion about depth. Opting out lets an overlay compete where it
 * should — against its ancestors' siblings — and changes nothing else: `auto` keeps document order,
 * which is what a stack of z-0 boxes was already doing.
 */
const LAYER_CLASS = 'z-auto';

/*
 * Inside a table cell, a row or column may be narrower than its content, and a row stays on one
 * line. A cell is one line with an ellipsis (see `TableCellTextContext`), and the ellipsis can only
 * appear if every box between the cell and the text is allowed to shrink: a flex item keeps its
 * content width by default, so a name-and-badge `Inline` would otherwise run straight into the next
 * column. Wrapping is off for the same reason — a badge that wrapped would make the row two lines.
 */
const CELL_CLASS = 'min-w-0 shrink';

export function Stack({
    space = 'md',
    align,
    justify,
    grow,
    className,
    children,
    ...rest
}: StackProps) {
    const cell = useContext(TableCellTextContext) !== null;
    return (
        <View
            {...rest}
            className={cx(
                LAYER_CLASS,
                'flex-col',
                cell ? CELL_CLASS : null,
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
    const cell = useContext(TableCellTextContext) !== null;
    return (
        <View
            {...rest}
            className={cx(
                LAYER_CLASS,
                'flex-row',
                wrap && !cell ? 'flex-wrap' : 'flex-nowrap',
                cell ? CELL_CLASS : null,
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
