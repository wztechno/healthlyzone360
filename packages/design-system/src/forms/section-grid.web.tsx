import { formMinWidth, formWidth, spacingAliases } from '@healthy360/design-tokens';
import { Children, isValidElement } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { cx } from '../internal/class-names.ts';
import type { FormSectionProps } from './form-section.tsx';
import type { SectionGridProps } from './section-grid-shared.ts';

export type { SectionGridProps } from './section-grid-shared.ts';

/**
 * SectionGrid — web. An editor's sections, side by side where two fit.
 *
 * A real CSS grid, for the reason `grid.web.tsx` gives: `auto-fit` columns of at least
 * `formMinWidth` (a two-track card) and an equal share of the rest, so two bounded sections pair
 * from about 1236px of main width and stack below it. `min(…, 100%)` keeps one column from
 * overflowing a box narrower than the minimum.
 *
 * **Why the cells cap.** A `1fr` column on a wide monitor is wider than a card's three tracks, and
 * a card stretched past them is the empty-panel problem this exists to fix. So each bounded
 * child's cell stops at `formWidth`, start-aligned — a lone card in a wide column stops at 906 —
 * and a `flow="full"` child (the lines table, the plan matrix) spans every column instead. The
 * flag is read off the child's props, exactly as `FormGrid` reads `span`.
 *
 * RTL needs nothing: grid flow follows the writing direction. Nothing global changes — only an
 * editor that opts in lays out this way.
 */

const GRID_STYLE: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(min(${String(formMinWidth)}px, 100%), 1fr))`,
    gap: spacingAliases.base,
    alignItems: 'stretch',
};

const FULL_CELL: CSSProperties = { gridColumn: '1 / -1', minWidth: 0 };
const BOUNDED_CELL: CSSProperties = { maxWidth: formWidth, minWidth: 0 };

export function SectionGrid({ children, className, testID }: SectionGridProps) {
    return (
        <div data-testid={testID} className={cx(className)} style={GRID_STYLE}>
            {Children.map(children, (child) => {
                if (!isValidElement(child)) return child;
                const full =
                    (child as ReactElement<Pick<FormSectionProps, 'flow'>>).props.flow === 'full';
                return <div style={full ? FULL_CELL : BOUNDED_CELL}>{child}</div>;
            })}
        </div>
    );
}
