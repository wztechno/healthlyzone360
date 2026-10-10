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
 * `lg` is the top of the ladder on purpose, and a measured grid is capped by it too. Three
 * tracks is what a bounded form card holds (`formWidth`), and a fourth would read as a different
 * layout rather than the same one, wider. Callers that genuinely want four pass `columns`
 * explicitly.
 *
 * The ladder reads the *window*, and the kitchen's content area is narrower by the shell's nav (a
 * 56px module rail plus a 232px panel, collapsible) and by any rail beside the form — which is why
 * the web grid measures its own box and takes the ladder only as a ceiling.
 */
export const RESPONSIVE_COLUMNS = { sm: 1, md: 2, lg: 3 } as const;

/** Gaps, in dp. Row gap is tighter than column gap: fields stack closer than they sit apart. */
export const GRID_GAP = { row: 12, column: 16 } as const;

/**
 * The half track - 132px, which is a field *less its gap*, halved.
 *
 * Derived rather than stated, because the relationship is the point: two half tracks and the gap
 * between them are exactly one 280px field, so a `span={2}` item on a half grid lands on the same
 * width as a plain field on a full one and the two kinds of form line up column for column. The
 * desk editors (Catalogue Forms) set a unit picker or a percentage at one half track - a
 * two-character value in a 280px box is the stretch the no-stretch rule exists to prevent, one
 * size down - and a designation at two.
 */
export const HALF_TRACK_WIDTH = (fieldWidth - GRID_GAP.column) / 2;

/** The half grid's ladder: the full ladder, doubled, so every breakpoint holds the same width. */
export const HALF_TRACK_COLUMNS = { sm: 2, md: 4, lg: 6 } as const;

export const GRID_TRACKS = ['field', 'half'] as const;
export type GridTrack = (typeof GRID_TRACKS)[number];

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
    /**
     * `field` (the default) is the 280px track; `half` is {@link HALF_TRACK_WIDTH}, for a form that
     * sets short values at half a field and states `span={2}` on the rest.
     */
    readonly track?: GridTrack | undefined;
    /**
     * Caps the responsive ladder without fixing it - a half grid beside an image slot that has
     * room for four tracks at most, and should still fall to two on a phone.
     */
    readonly maxColumns?: number | undefined;
    /**
     * On the web the grid measures its own box and fits the track count to it ({@link fitTracks}),
     * still capped by the ladder's top and by `maxColumns`; `false` opts back into the window
     * ladder. Default true. Native ignores it. A grid beside a sibling in a `flex-row` must sit in
     * a region that owns its width (see the ingredient editor's identity row), or its own intrinsic
     * width is what it measures and the count ratchets down.
     */
    readonly fit?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * How many tracks fit a measured width: `n` tracks need `n × track + (n − 1) × gap`. Never zero.
 */
export function fitTracks(width: number, track: GridTrack = 'field'): number {
    // ponytail: +1 absorbs sub-pixel widths (871.99 for 872); a real half-pixel layout would need rounding instead
    return Math.max(
        1,
        Math.floor((width + GRID_GAP.column + 1) / (trackWidthOf(track) + GRID_GAP.column)),
    );
}

/**
 * The column count a grid resolves to: the fixed count when one is stated; otherwise, when the
 * grid's own box has been measured (`portWidth > 0`), the tracks that fit it, never more than the
 * ladder's top; otherwise the track's ladder at this breakpoint. `maxColumns` caps either.
 */
export function resolveColumns(
    atLeast: (name: 'md' | 'lg') => boolean,
    { columns, track = 'field', maxColumns }: Pick<GridProps, 'columns' | 'track' | 'maxColumns'>,
    portWidth = 0,
): number {
    if (columns !== undefined) return columns;
    const ladder = track === 'half' ? HALF_TRACK_COLUMNS : RESPONSIVE_COLUMNS;
    const laddered =
        portWidth > 0
            ? Math.min(ladder.lg, fitTracks(portWidth, track))
            : atLeast('lg')
              ? ladder.lg
              : atLeast('md')
                ? ladder.md
                : ladder.sm;
    return maxColumns === undefined ? laddered : Math.max(1, Math.min(laddered, maxColumns));
}

/** The track width a grid draws, in dp. */
export function trackWidthOf(track: GridTrack = 'field'): number {
    return track === 'half' ? HALF_TRACK_WIDTH : fieldWidth;
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
