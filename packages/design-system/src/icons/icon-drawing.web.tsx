import type { ReactElement } from 'react';

import { cx } from '../internal/class-names.ts';
import type { IconName, IconSize } from './icon.tsx';

/**
 * The drawn icons — web half.
 *
 * Paths are `icons.json` from the Workbench design project, on its 14×14 grid: `fill: none`,
 * `stroke: currentColor`, 1.25 stroke, round caps and joins. `currentColor` is the whole reason this
 * is an SVG and not a picture — the drawing takes whatever ink the caller's `className` sets, in
 * either theme, with no colour of its own to keep in step.
 *
 * `more` is the three dots on the same grid, filled rather than stroked, so it reads at the same
 * weight as the stroked marks beside it in a row.
 */
const DRAWINGS: Partial<Record<IconName, ReactElement>> = {
    eye: (
        <>
            <path d="M1.2 7C2.6 4.7 4.6 3.5 7 3.5s4.4 1.2 5.8 3.5c-1.4 2.3-3.4 3.5-5.8 3.5S2.6 9.3 1.2 7Z" />
            <circle cx="7" cy="7" r="1.6" />
        </>
    ),
    pen: (
        <>
            <path d="M9.6 2.1l2.3 2.3-6.5 6.5-3 .7.7-3 6.5-6.5Z" />
            <path d="M8.4 3.3l2.3 2.3" />
        </>
    ),
    archive: (
        <>
            <path d="M1.6 4.8h10.8v6.4H1.6z" />
            <path d="M0.9 2.6h12.2v2.2H0.9z" />
            <path d="M5.5 7.4h3" />
        </>
    ),
    calendar: (
        <>
            <path d="M2.1 3.5h9.8v8.4H2.1z" />
            <path d="M2.1 6.1h9.8" />
            <path d="M4.7 2.1v2.2" />
            <path d="M9.3 2.1v2.2" />
        </>
    ),
    clock: (
        <>
            <circle cx="7" cy="7" r="5.1" />
            <path d="M7 4.3V7l2 1.3" />
        </>
    ),
    more: (
        <g fill="currentColor" stroke="none">
            <circle cx="3" cy="7" r="1" />
            <circle cx="7" cy="7" r="1" />
            <circle cx="11" cy="7" r="1" />
        </g>
    ),
};

/** 13px at `sm` is `iconSize.sm` in `control.ts` — the row-action size the handoff names. */
const PIXELS: Readonly<Record<IconSize, number>> = { sm: 13, md: 16, lg: 20 };

export function drawIcon(
    name: IconName,
    size: IconSize,
    className: string | undefined,
    label: string | undefined,
    testID: string | undefined,
): ReactElement | null {
    const drawing = DRAWINGS[name];
    if (drawing === undefined) return null;
    const px = PIXELS[size];

    return (
        <svg
            data-testid={testID}
            width={px}
            height={px}
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cx('shrink-0', className)}
            {...(label === undefined
                ? { 'aria-hidden': true, focusable: 'false' }
                : { role: 'img', 'aria-label': label })}
        >
            {drawing}
        </svg>
    );
}
