import { Children, isValidElement, useMemo } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { cx } from '../internal/class-names.ts';
import { GRID_GAP, RESPONSIVE_COLUMNS, fieldWidth, resolveSpan } from './grid-shared.ts';
import type { GridColumnCount, GridProps, GridSpanProps } from './grid-shared.ts';

export type { GridColumnCount, GridProps, GridSpanProps } from './grid-shared.ts';

/**
 * Grid — web.
 *
 * A real CSS grid, written as a `<div>` for the same reason `slider-field.web.tsx` writes a real
 * `<input type="range">`: `grid-template-columns` has no React Native equivalent, and a flexbox
 * approximation of it is where the no-stretch rule leaks. `justify-content: start` is the load
 * bearing declaration — without it the browser distributes the free space back into the tracks and
 * the 280px ceiling silently becomes a 280px *minimum*.
 *
 * A `div` inside a React Native tree is legal here and nowhere else: this file is only ever bundled
 * for the web, and its native sibling is a `View`. Nothing above or below it needs to know which
 * one it got.
 */

function columnsFor(atLeast: (name: 'md' | 'lg') => boolean): GridColumnCount {
    if (atLeast('lg')) return RESPONSIVE_COLUMNS.lg;
    if (atLeast('md')) return RESPONSIVE_COLUMNS.md;
    return RESPONSIVE_COLUMNS.sm;
}

/**
 * Wraps each child in a cell whose `grid-column` carries its resolved span.
 *
 * Every element child gets a cell, including the `span`-less ones. A conditional wrapper was the
 * first attempt and it is wrong twice over: `display: contents` (the trick for making the wrapper
 * disappear) removes the box from layout altogether, which takes `grid-column` with it, and a mix
 * of wrapped and unwrapped children puts two different kinds of thing on the same auto-placement
 * pass. One uniform cell per child, `span 1` by default.
 */
function cells(children: ReactNode, columns: number): ReactNode {
    return Children.map(children, (child) => {
        if (!isValidElement(child)) return child;

        const span = resolveSpan(columns, (child as ReactElement<GridSpanProps>).props);
        // `span N` rather than an explicit line number: the item stays wherever auto-placement puts
        // it and only claims extra tracks, so re-ordering fields never re-flows the whole form. It
        // also mirrors under RTL with no second code path, because grid flow follows writing
        // direction. `minWidth: 0` stops a long unbroken value from forcing the track past its
        // ceiling — the one way a fixed track can still stretch.
        return <div style={{ gridColumn: `span ${String(span)}`, minWidth: 0 }}>{child}</div>;
    });
}

/**
 * The grid — fixed-width tracks, responsive count.
 *
 * `template` is the one knob, and {@link FormGrid} is the only caller: a track is `fieldWidth`
 * wide and never grows past it. The base stays factored out because the native half draws the
 * same arithmetic a different way, and the two must not drift.
 */
function GridBase({
    children,
    columns,
    className,
    testID,
    template,
}: GridProps & { readonly template: string }) {
    const { atLeast } = useBreakpoint();
    const resolved = columns ?? columnsFor(atLeast);

    const style = useMemo<CSSProperties>(
        () => ({
            display: 'grid',
            gridTemplateColumns: `repeat(${String(resolved)}, ${template})`,
            justifyContent: 'start',
            rowGap: GRID_GAP.row,
            columnGap: GRID_GAP.column,
        }),
        [resolved, template],
    );

    return (
        <div data-testid={testID} className={cx(className)} style={style}>
            {cells(children, resolved)}
        </div>
    );
}

/**
 * FormGrid — the field layout. `sm: 1 · md: 2 · lg+: 3`, 280px tracks at every one of them.
 *
 * `span={2}` and `fullWidth` are the only routes to a wider field, and both are stated by the
 * field rather than emerging from the container. A textarea is the intended `span={2}` user.
 */
export function FormGrid(props: GridProps) {
    return <GridBase {...props} template={`minmax(0, ${String(fieldWidth)}px)`} />;
}
