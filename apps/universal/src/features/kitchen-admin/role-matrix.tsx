import { Icon, Text, cx, useContentWidth } from '@healthy360/design-system';
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

/**
 * The role editor's permission matrix: a matrix in shape, drawn in the kitchen tables' style.
 *
 * ```
 * PAGE                    View   Edit   Also allowed
 * ──────────────────────────────────────────────────────────────────
 * ORDERS                                                     <- band
 * Order book              [✓]    [✓]    [✓ New sale] [+ New customer]
 * Also opens: Calendar
 * ```
 *
 * ## The table's style, the matrix's shape
 *
 * The frame, the header and the rows are `CatalogueList`'s (`DataList`): a raised panel, a green
 * header band that is the table's one rule, and rows with **no hairline between them** — told apart
 * by their height and the hover tint, because a rule under every row stripes a page into a ledger.
 * A sidebar section is a sunken band across the full width, not a line.
 *
 * What stays the matrix's own is the cells. A tick column is a **fixed narrow track** holding a
 * checkbox — `Checkbox`'s box, filled and ticked when on — and the one column of named chips takes
 * whatever width is left. The tick columns used to be flexible tracks with a well stretched across
 * each, which on a wide page pushed View a long way from the name it belongs to and drew a row of
 * empty bars rather than boxes anyone would read as ticks. Below its floor the matrix scrolls
 * sideways inside its own port rather than squeezing the columns into slivers.
 *
 * Every cell is a checkbox. A cell always announces the whole sentence — row and column — since a
 * tick means nothing alone.
 */

/** A row-label track wide enough for a page name and most of its "Also opens" line. */
export const MATRIX_ROW_TRACK = 320;
/** A tick column: its header word and a checkbox, and nothing more. */
export const MATRIX_CELL_FLOOR = 112;

/**
 * The same two on a laptop's page. A page name still fits 240 — its "Also opens" line wraps under
 * it — and a checkbox sits in 96 with room to spare.
 */
const MATRIX_ROW_TRACK_COMPACT = 240;
const MATRIX_CELL_FLOOR_COMPACT = 96;

/**
 * The narrow row track, for a matrix whose row names are a word or two (Advanced's areas). At the
 * page track an area name sat beside two hundred pixels of nothing before its first tick.
 */
const MATRIX_ROW_TRACK_NARROW = 200;
const MATRIX_ROW_TRACK_NARROW_COMPACT = 160;

/** Below this much page, the matrix draws its compact tracks. */
const MATRIX_FULL_MIN = 1160;

/** How wide a matrix's row names run — see {@link MATRIX_ROW_TRACK_NARROW}. */
export type MatrixRowWidth = 'wide' | 'narrow';

export interface MatrixTracks {
    readonly row: number;
    readonly cell: number;
}

/** The frame's row width, read by its header and rows so every track lines up. */
const RowWidthContext = createContext<MatrixRowWidth>('wide');

function tracksFor(full: boolean, rows: MatrixRowWidth): MatrixTracks {
    if (rows === 'narrow') {
        return full
            ? { row: MATRIX_ROW_TRACK_NARROW, cell: MATRIX_CELL_FLOOR }
            : { row: MATRIX_ROW_TRACK_NARROW_COMPACT, cell: MATRIX_CELL_FLOOR_COMPACT };
    }
    return full
        ? { row: MATRIX_ROW_TRACK, cell: MATRIX_CELL_FLOOR }
        : { row: MATRIX_ROW_TRACK_COMPACT, cell: MATRIX_CELL_FLOOR_COMPACT };
}

/** The tracks for the page this matrix is on — the content column, not the window. */
export function useMatrixTracks(rows?: MatrixRowWidth): MatrixTracks {
    const fromFrame = useContext(RowWidthContext);
    const full = useContentWidth().atLeast(MATRIX_FULL_MIN);
    return tracksFor(full, rows ?? fromFrame);
}

/**
 * A column's track. A tick column (`1`) is a fixed width, so its checkbox sits beside the row name
 * whatever the page. A column of named chips — Also allowed, Other — is wider and takes the rest,
 * so its names are read whole rather than cut to an ellipsis. The header and every row take the
 * same weights, which is what keeps the tracks aligned.
 */
function trackStyle(weight: number, tracks: MatrixTracks) {
    return weight === 1 ? { width: tracks.cell } : { flex: weight, minWidth: tracks.cell * weight };
}

/** `CatalogueList`'s panel — the frame every kitchen table sits in. */
const PANEL =
    'flex-col overflow-hidden rounded-panel border border-brand-100 bg-surface-raised shadow-elevation-card';

/** The width below which the matrix scrolls sideways: the name track plus each column's floor. */
export function matrixFloor(
    weights: readonly number[],
    tracks: MatrixTracks = { row: MATRIX_ROW_TRACK, cell: MATRIX_CELL_FLOOR },
): number {
    return tracks.row + weights.reduce((sum, weight) => sum + weight, 0) * tracks.cell;
}

/** `matrixFloor` at the tracks this page draws. */
export function useMatrixFloor(weights: readonly number[], rows: MatrixRowWidth = 'wide'): number {
    return matrixFloor(weights, useMatrixTracks(rows));
}

export function MatrixFrame({
    label,
    floor,
    rows = 'wide',
    children,
    testID,
}: {
    /** Accessible name for the grid as a whole. */
    readonly label: string;
    /** The width below which the grid scrolls sideways rather than squeezing. */
    readonly floor: number;
    /** How wide the row names run. The same value the floor was measured with. */
    readonly rows?: MatrixRowWidth | undefined;
    readonly children: ReactNode;
    readonly testID: string;
}) {
    // The port's own width, measured. The matrix is drawn at exactly that — or at its floor, and
    // scrolled, when the port is narrower. Left to size itself, a horizontal scroller's content
    // takes its max-content width: every chip column laid out on one line, so a long chip ran off
    // the panel instead of wrapping.
    const [port, setPort] = useState(0);

    return (
        <RowWidthContext.Provider value={rows}>
            <View className={PANEL}>
                <ScrollView
                    horizontal
                    testID={testID}
                    onLayout={(event) => {
                        setPort(event.nativeEvent.layout.width);
                    }}
                    contentContainerStyle={{ flexGrow: 1 }}
                    contentContainerClassName="flex-col"
                >
                    <View
                        accessibilityLabel={label}
                        style={port === 0 ? { minWidth: floor } : { width: Math.max(floor, port) }}
                        className="flex-1 flex-col"
                    >
                        {children}
                    </View>
                </ScrollView>
            </View>
        </RowWidthContext.Provider>
    );
}

export interface MatrixColumn {
    readonly key: string;
    readonly label: string;
    /** See {@link trackStyle}. `1` when omitted. */
    readonly weight?: number | undefined;
}

export function MatrixHeader({
    rowHeader,
    columns,
}: {
    readonly rowHeader: string;
    readonly columns: readonly MatrixColumn[];
}) {
    const tracks = useMatrixTracks();

    return (
        // `DataList`'s header: the brand's subtle band, labels a step heavier than the cells under it.
        <View className="min-h-row-sm flex-row items-center gap-tight border-b border-stroke-subtle bg-surface-brand-subtle px-control-sm">
            <View style={{ width: tracks.row }} className="py-1.5">
                <Text variant="strong" className="text-content-on-brand-subtle">
                    {rowHeader}
                </Text>
            </View>
            {columns.map((column) => {
                const weight = column.weight ?? 1;
                return (
                    <View key={column.key} style={trackStyle(weight, tracks)} className="py-1.5">
                        {/* A tick column centres its word over the box; a chip column starts
                         * where its chips do. */}
                        <Text
                            variant="strong"
                            align={weight === 1 ? 'center' : 'start'}
                            className="text-content-on-brand-subtle"
                        >
                            {column.label}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

/** A group's heading across the whole width — a sidebar section, a permission area. */
export function MatrixBand({ label, testID }: { readonly label: string; readonly testID: string }) {
    return (
        <View
            testID={testID}
            className="min-h-row-sm flex-row items-center bg-surface-sunken px-control-sm"
        >
            <Text variant="label" tone="secondary">
                {label}
            </Text>
        </View>
    );
}

export function MatrixRow({
    title,
    caption,
    children,
    testID,
}: {
    readonly title: string;
    /** Under the title: what else the row opens. Wraps in full rather than ending in an ellipsis. */
    readonly caption?: ReactNode | undefined;
    readonly children: ReactNode;
    readonly testID: string;
}) {
    const tracks = useMatrixTracks();
    return (
        // No hairline: `DataList`'s rows are told apart by height and the hover tint alone.
        <View
            testID={testID}
            className="min-h-row-md flex-row items-center gap-tight px-control-sm py-1 hover:bg-surface-sunken"
        >
            <View style={{ width: tracks.row }} className="min-w-0 flex-col">
                <Text testID={`${testID}-name`}>{title}</Text>
                {caption}
            </View>
            {children}
        </View>
    );
}

/** One column's slot in a row. Holds a checkbox, several chips, or nothing. */
export function MatrixSlot({
    children,
    weight = 1,
    testID,
}: {
    readonly children?: ReactNode;
    /** The same weight its header column was given. */
    readonly weight?: number | undefined;
    readonly testID?: string | undefined;
}) {
    const tracks = useMatrixTracks();
    return (
        <View
            testID={testID}
            style={trackStyle(weight, tracks)}
            className={cx(
                'flex-row flex-wrap items-center gap-hair',
                weight === 1 ? 'justify-center' : 'justify-start',
            )}
        >
            {children}
        </View>
    );
}

/**
 * One tick. Without `word` it is a checkbox — the column header already says what it is. With
 * `word` it is a chip naming its permission. `label` is what is announced, either way.
 */
export function MatrixCell({
    on,
    label,
    word,
    marker,
    disabled,
    readOnly = false,
    onPress,
    testID,
}: {
    readonly on: boolean;
    readonly label: string;
    readonly word?: string | undefined;
    /** Drawn after the tick — the "you do not hold this" warning. */
    readonly marker?: ReactNode | undefined;
    readonly disabled: boolean;
    /**
     * A matrix that reports rather than edits — what a person's roles add up to. Not pressable, and
     * not dimmed either: nothing is unavailable, there is simply nothing to change here.
     */
    readonly readOnly?: boolean | undefined;
    readonly onPress: () => void;
    readonly testID: string;
}) {
    const chip = word !== undefined;
    return (
        <Pressable
            testID={testID}
            role="checkbox"
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            aria-label={label}
            aria-checked={on}
            accessibilityState={{ checked: on, disabled: disabled || readOnly }}
            aria-readonly={readOnly}
            disabled={disabled || readOnly}
            onPress={onPress}
            {...({ title: label } as object)}
            className={cx(
                'flex-row items-center justify-center gap-hair rounded-sm',
                chip
                    ? cx(
                          // A chip is as wide as its name, wrapping inside the slot and growing a
                          // line taller rather than cutting the name off.
                          'min-h-control-sm max-w-full border px-2 py-1',
                          on
                              ? 'border-surface-brand bg-surface-brand-subtle'
                              : 'border-stroke-subtle bg-surface-raised',
                      )
                    : // A 32px target around a 20px box — the box is `Checkbox`'s.
                      'h-control-sm min-w-8 px-1',
                readOnly ? null : 'hover:bg-surface-sunken',
                disabled ? 'opacity-50' : null,
            )}
        >
            {chip ? (
                <>
                    {on ? (
                        <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                    ) : null}
                    <Text
                        variant="caption"
                        className={cx(
                            'shrink',
                            on ? 'text-content-on-brand-subtle' : 'text-content-secondary',
                        )}
                    >
                        {word}
                    </Text>
                </>
            ) : (
                <View
                    className={cx(
                        'size-5 shrink-0 items-center justify-center rounded-sm border',
                        on
                            ? 'border-transparent bg-surface-brand'
                            : 'border-stroke-strong bg-surface-raised',
                    )}
                >
                    {on ? <Icon name="check" size="sm" className="text-content-on-brand" /> : null}
                </View>
            )}
            {marker}
        </Pressable>
    );
}

/** A column this row has no permission for: an inert dash, so the grid keeps its shape. */
export function MatrixNone() {
    return (
        <Text tone="disabled" align="center">
            {'—'}
        </Text>
    );
}
