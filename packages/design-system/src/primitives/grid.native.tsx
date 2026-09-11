import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';

import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { cx } from '../internal/class-names.ts';
import { GRID_GAP, RESPONSIVE_COLUMNS, fieldWidth, resolveSpan, spanWidth } from './grid-shared.ts';
import type { GridColumnCount, GridProps, GridSpanProps } from './grid-shared.ts';

export type { GridColumnCount, GridProps, GridSpanProps } from './grid-shared.ts';

/**
 * Grid — native.
 *
 * React Native has no CSS grid, so the same geometry is built from a wrapping row whose children
 * state a fixed `width` and refuse to grow: `flexGrow: 0, flexShrink: 0`. That triple is the
 * native spelling of `justify-content: start` + `minmax(0, 280px)` — remove `flexGrow: 0` and the
 * last row of a wrapped form stretches its two fields across the whole width, which is exactly the
 * failure the no-stretch rule exists to prevent.
 *
 * Widths are dp numbers rather than utilities on purpose. `w-field` exists and is right for a
 * single field, but a `span={2}` item is 280×2 *plus the gap it swallows* — arithmetic a utility
 * class cannot do, and {@link spanWidth} is where it lives so both halves agree on the answer.
 */

function columnsFor(atLeast: (name: 'md' | 'lg') => boolean): GridColumnCount {
    if (atLeast('lg')) return RESPONSIVE_COLUMNS.lg;
    if (atLeast('md')) return RESPONSIVE_COLUMNS.md;
    return RESPONSIVE_COLUMNS.sm;
}

function cells(children: ReactNode, columns: number, trackWidth: number): ReactNode {
    return Children.map(children, (child) => {
        if (!isValidElement(child)) return child;

        const span = resolveSpan(columns, (child as ReactElement<GridSpanProps>).props);
        return (
            <View style={{ width: spanWidth(span, trackWidth), flexGrow: 0, flexShrink: 0 }}>
                {child}
            </View>
        );
    });
}

function GridBase({
    children,
    columns,
    className,
    testID,
    trackWidth,
}: GridProps & { readonly trackWidth: number }) {
    const { atLeast } = useBreakpoint();
    const resolved = columns ?? columnsFor(atLeast);

    return (
        <View
            testID={testID}
            className={cx('flex-row flex-wrap', className)}
            style={{ rowGap: GRID_GAP.row, columnGap: GRID_GAP.column }}
        >
            {cells(children, resolved, trackWidth)}
        </View>
    );
}

/** FormGrid — `sm: 1 · md: 2 · lg+: 3`, and 280px at every one of them. */
export function FormGrid(props: GridProps) {
    return <GridBase {...props} trackWidth={fieldWidth} />;
}
