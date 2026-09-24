import { View } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { Skeleton } from './skeleton.tsx';

/**
 * Skeletons shaped like the screens they stand in for.
 *
 * A loading state used to be whatever bars the screen's author reached for — five full-width
 * `h-row-sm` strips on one list, an `h-8` and two `h-32` slabs on an editor, a single `h-40` on a
 * calendar — so the page jumped when the data landed, and two lists of the same kind loaded
 * differently. These are the loaded layouts with their content greyed: the list panel with its
 * header rule and 32px rows, the editor's heading, tab strip and 280px fields, the stat tiles, the
 * card grid. A screen picks the one its loaded state is, and the swap from skeleton to content moves
 * nothing but ink.
 *
 * Each keeps `testID` on the region and numbers its repeated parts `{partTestID}-skeleton-{n}` from
 * 1 — `partTestID` defaulting to `testID` — the ids the hand-drawn loading states already exposed, so the tests that wait on them still find them.
 * Every part is a `Skeleton`, so reduced motion and the hidden-from-assistive-technology rule come
 * with it; the region is what a caller marks busy.
 */

/** The list panel's frame — `catalogue-list.tsx`'s `FRAME_CLASS`, so the skeleton sits where the rows will. */
const PANEL_CLASS =
    'flex-col overflow-hidden rounded-panel border border-brand-100 bg-surface-raised shadow-elevation-card';

/**
 * Cell widths, cycled by row and column so the rows read as text of different lengths rather than
 * as a ruled grid. Fixed, not random: a skeleton that reshuffles on every render flickers.
 */
const CELL_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-4/5', 'w-1/3'] as const;

function cellWidth(row: number, column: number): string {
    return CELL_WIDTHS[(row * 2 + column) % CELL_WIDTHS.length] ?? 'w-1/2';
}

export interface TableSkeletonProps {
    /** Rows to draw. Five by default — the fold of a list page at desk height. */
    readonly rows?: number | undefined;
    /** Columns to draw, the title column included. Four by default. */
    readonly columns?: number | undefined;
    /** Draw the column-label row above the rows. On by default, as `DataList` draws one. */
    readonly header?: boolean | undefined;
    readonly testID?: string | undefined;
    /** Prefix for the numbered parts, where it differs from the region's id. Defaults to `testID`. */
    readonly partTestID?: string | undefined;
}

/**
 * A list page's table: the panel, a header of short upper labels over a rule, then `row-md` rows,
 * each a wide title cell and narrower ones after it. Row `n` is `{partTestID}-skeleton-{n}`.
 */
export function TableSkeleton({
    rows = 5,
    columns = 4,
    header = true,
    testID,
    partTestID = testID,
}: TableSkeletonProps) {
    const columnIndexes = Array.from({ length: Math.max(1, columns) }, (_, index) => index);

    return (
        <View testID={testID} aria-busy className={PANEL_CLASS}>
            {header ? (
                <View className="min-h-row-sm flex-row items-center gap-snug border-b border-stroke-subtle px-control-sm">
                    {columnIndexes.map((column) => (
                        <View
                            key={column}
                            className={cx('min-w-0', column === 0 ? 'flex-[2]' : 'flex-1')}
                        >
                            <Skeleton
                                heightClassName="h-2"
                                widthClassName={column === 0 ? 'w-1/4' : 'w-1/2'}
                            />
                        </View>
                    ))}
                </View>
            ) : null}
            {Array.from({ length: rows }, (_, row) => (
                <View
                    key={row}
                    testID={
                        partTestID === undefined
                            ? undefined
                            : `${partTestID}-skeleton-${String(row + 1)}`
                    }
                    className={cx(
                        'min-h-row-md flex-row items-center gap-snug px-control-sm',
                        row < rows - 1 ? 'border-b border-stroke-subtle' : null,
                    )}
                >
                    {columnIndexes.map((column) => (
                        <View
                            key={column}
                            className={cx('min-w-0', column === 0 ? 'flex-[2]' : 'flex-1')}
                        >
                            <Skeleton
                                heightClassName="h-3"
                                widthClassName={cellWidth(row, column)}
                            />
                        </View>
                    ))}
                </View>
            ))}
        </View>
    );
}

export interface FormSkeletonProps {
    /** Draw the page heading and its trailing buttons. Off when the screen's own header is already up. */
    readonly heading?: boolean | undefined;
    /**
     * Tabs in the strip under the heading; `0` draws the plain rule a one-step form has instead, or
     * nothing at all without a heading — a form embedded under a header that already drew its rule.
     */
    readonly tabs?: number | undefined;
    /** Titled sections of fields. */
    readonly sections?: number | undefined;
    /** Fields per section. */
    readonly fields?: number | undefined;
    readonly testID?: string | undefined;
    /** Prefix for the numbered parts, where it differs from the region's id. Defaults to `testID`. */
    readonly partTestID?: string | undefined;
}

/**
 * A record editor: the heading with its Back and Save buttons, the tab strip, then titled sections
 * of label-over-field pairs at the Catalogue's fixed 280px field width, wrapping as `FormGrid` does.
 * Section `n` is `{partTestID}-skeleton-{n}`.
 */
export function FormSkeleton({
    heading = true,
    tabs = 4,
    sections = 2,
    fields = 4,
    testID,
    partTestID = testID,
}: FormSkeletonProps) {
    return (
        <View testID={testID} aria-busy className="flex-col gap-loose">
            <View className="flex-col gap-snug">
                {heading ? (
                    <View className="flex-row items-center justify-between gap-tight">
                        <Skeleton heightClassName="h-6" widthClassName="w-56" />
                        <View className="flex-row items-center gap-tight">
                            <Skeleton
                                heightClassName="h-control-sm"
                                widthClassName="w-20"
                                rounded="md"
                            />
                            <Skeleton
                                heightClassName="h-control-sm"
                                widthClassName="w-24"
                                rounded="md"
                            />
                        </View>
                    </View>
                ) : null}
                {heading || tabs > 0 ? (
                    <View className="flex-row items-end gap-loose border-b border-stroke-subtle pb-tight">
                        {Array.from({ length: tabs }, (_, tab) => (
                            <Skeleton
                                key={tab}
                                heightClassName="h-3"
                                widthClassName={tab === 0 ? 'w-20' : 'w-16'}
                            />
                        ))}
                    </View>
                ) : null}
            </View>

            {Array.from({ length: sections }, (_, section) => (
                <View
                    key={section}
                    testID={
                        partTestID === undefined
                            ? undefined
                            : `${partTestID}-skeleton-${String(section + 1)}`
                    }
                    className="flex-col gap-snug"
                >
                    <Skeleton heightClassName="h-4" widthClassName="w-40" />
                    <View className="flex-row flex-wrap gap-snug">
                        {Array.from({ length: fields }, (_, field) => (
                            <View key={field} className="w-field max-w-full flex-col gap-hair">
                                <Skeleton heightClassName="h-2.5" widthClassName="w-24" />
                                <Skeleton heightClassName="h-control-md" rounded="md" />
                            </View>
                        ))}
                    </View>
                </View>
            ))}
        </View>
    );
}

export interface StatTilesSkeletonProps {
    /** Tiles in the row. */
    readonly count?: number | undefined;
    readonly testID?: string | undefined;
    /** Prefix for the numbered parts, where it differs from the region's id. Defaults to `testID`. */
    readonly partTestID?: string | undefined;
}

/**
 * The stat-tile row a report or hub opens with: raised tiles, each a short label over a large
 * figure, wrapping on a narrow page. Tile `n` is `{partTestID}-skeleton-{n}`.
 */
export function StatTilesSkeleton({
    count = 4,
    testID,
    partTestID = testID,
}: StatTilesSkeletonProps) {
    return (
        <View testID={testID} aria-busy className="flex-row flex-wrap gap-snug">
            {Array.from({ length: count }, (_, tile) => (
                <View
                    key={tile}
                    testID={
                        partTestID === undefined
                            ? undefined
                            : `${partTestID}-skeleton-${String(tile + 1)}`
                    }
                    className="min-w-card flex-1 flex-col gap-tight rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
                >
                    <Skeleton heightClassName="h-2.5" widthClassName="w-1/3" />
                    <Skeleton heightClassName="h-8" widthClassName="w-1/2" />
                </View>
            ))}
        </View>
    );
}

export interface CardGridSkeletonProps {
    /** Cards to draw. */
    readonly count?: number | undefined;
    /** Draw each card's 4:3 picture above its text, as a `Card` with `aspect="card"` media does. */
    readonly media?: boolean | undefined;
    readonly testID?: string | undefined;
    /** Prefix for the numbered parts, where it differs from the region's id. Defaults to `testID`. */
    readonly partTestID?: string | undefined;
}

/**
 * A grid of cards: each a raised card with an optional 4:3 picture, a title line and a shorter line
 * under it, wrapping at the card minimum. Card `n` is `{partTestID}-skeleton-{n}`.
 */
export function CardGridSkeleton({
    count = 6,
    media = true,
    testID,
    partTestID = testID,
}: CardGridSkeletonProps) {
    return (
        <View testID={testID} aria-busy className="flex-row flex-wrap gap-4">
            {Array.from({ length: count }, (_, card) => (
                <View
                    key={card}
                    testID={
                        partTestID === undefined
                            ? undefined
                            : `${partTestID}-skeleton-${String(card + 1)}`
                    }
                    className="min-w-card flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-stroke-subtle bg-surface-raised shadow-elevation-card"
                >
                    {media ? (
                        <View className="aspect-[4/3] w-full">
                            <Skeleton variant="shimmer" heightClassName="h-full" rounded="sm" />
                        </View>
                    ) : null}
                    <View className="flex-col gap-tight p-4">
                        <Skeleton heightClassName="h-4" widthClassName={cellWidth(card, 0)} />
                        <Skeleton heightClassName="h-3" widthClassName={cellWidth(card, 1)} />
                    </View>
                </View>
            ))}
        </View>
    );
}

export interface RecordSkeletonProps {
    /** Draw the page heading and its trailing buttons. Off inside a frame that already drew one. */
    readonly heading?: boolean | undefined;
    /** Figure tiles under the heading; `0` for a record that opens straight onto its lines. */
    readonly tiles?: number | undefined;
    /** Rows in the lines table. */
    readonly rows?: number | undefined;
    readonly testID?: string | undefined;
    /** Prefix for the numbered table rows. Defaults to `testID`. */
    readonly partTestID?: string | undefined;
}

/**
 * A record read rather than edited — a batch, a supply order, a report: the heading, a row of figure
 * tiles, then the lines table. Row `n` of the table is `{partTestID}-skeleton-{n}`.
 */
export function RecordSkeleton({
    heading = true,
    tiles = 3,
    rows = 5,
    testID,
    partTestID = testID,
}: RecordSkeletonProps) {
    return (
        <View testID={testID} aria-busy className="flex-col gap-loose">
            {heading ? (
                <View className="flex-row items-center justify-between gap-tight">
                    <Skeleton heightClassName="h-6" widthClassName="w-56" />
                    <Skeleton heightClassName="h-control-sm" widthClassName="w-24" rounded="md" />
                </View>
            ) : null}
            {tiles > 0 ? <StatTilesSkeleton count={tiles} /> : null}
            <TableSkeleton rows={rows} partTestID={partTestID} />
        </View>
    );
}
