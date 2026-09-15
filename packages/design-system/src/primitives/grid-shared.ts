import { fieldWidth } from '@healthy360/design-tokens';
import type { ReactNode } from 'react';

/**
 * Grid geometry — the no-stretch rule, in one place both platform halves read.
 *
 * The rule the handoff (§2) is built around: **a field is 280px at every breakpoint.** A viewport
 * change moves the *column count*, never the column width. This is not a stylistic preference —
 * `1fr` tracks are how a two-character unit field ends up 900px wide on a desk monitor, which is
 * the single loudest complaint about the forms this system replaces.
 *
 * Consequently nothing here returns a fraction, a percentage or a flex weight. The web half spends
 * `minmax(0, 280px)` with `justify-content: start`; the native half spends a fixed `width` with
 * `flexGrow: 0`. Same geometry, two mechanisms, and the shared arithmetic below so they cannot
 * drift apart.
 */

export const GRID_COLUMNS = [1, 2, 3, 4] as const;
export type GridColumnCount = (typeof GRID_COLUMNS)[number];

/**
 * The responsive ladder: one column on a phone, two on a tablet, three from `lg` up.
 *
 * `lg` is the top of the ladder on purpose. A fourth 280px column plus gaps needs ~1200px of
 * *content* box, and the Catalogue's forms sit inside a shell with a 224px rail — so a four-column
 * form would appear only on the widest desks and would read as a different layout rather than the
 * same one, wider. Callers that genuinely want four pass `columns` explicitly.
 */
export const RESPONSIVE_COLUMNS = { sm: 1, md: 2, lg: 3 } as const;

/** Gaps, in dp. Row gap is tighter than column gap: fields stack closer than they sit apart. */
export const GRID_GAP = { row: 12, column: 16 } as const;

export interface GridSpanProps {
    /**
     * How many columns this child occupies. Clamped to the grid's column count, because a
     * `span={3}` field in a one-column phone layout must be one column wide, not overflow by two.
     */
    readonly span?: number | undefined;
    /** Spans the full declared column count. Sugar for `span={columns}`, and the common case. */
    readonly fullWidth?: boolean | undefined;
}

export interface GridProps {
    readonly children: ReactNode;
    /**
     * Fixed column count. Omit to take the responsive ladder above, which is what every form
     * wants; state it when a layout is deliberately not responsive (a two-up comparison).
     */
    readonly columns?: GridColumnCount | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** The width one grid item resolves to, in dp — the fixed track times its span, plus the gaps it swallows. */
export function spanWidth(span: number, trackWidth: number = fieldWidth): number {
    const columns = Math.max(1, Math.trunc(span));
    return columns * trackWidth + (columns - 1) * GRID_GAP.column;
}

/**
 * Resolves a child's requested span against the grid's actual column count.
 *
 * Clamping here rather than at the call site is what makes `span={2}` safe to write once and
 * correct at every breakpoint — the field author states an intent ("this textarea is wide") and the
 * grid decides whether the viewport can honour it.
 */
export function resolveSpan(columns: number, { span, fullWidth = false }: GridSpanProps): number {
    if (fullWidth) return columns;
    if (span === undefined) return 1;
    return Math.min(Math.max(1, Math.trunc(span)), columns);
}

export { fieldWidth };
