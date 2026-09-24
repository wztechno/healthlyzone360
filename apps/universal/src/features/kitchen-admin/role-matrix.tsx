import { Icon, Text, cx } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

/**
 * The role editor's permission matrix: a matrix in shape, drawn in the kitchen tables' style.
 *
 * ```
 * PAGE                         No access    Can look     Can change    Also allowed
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ORDERS                                                                        <- band
 * Order book                   [        ]  [        ]  [   ✓    ]    [✓ New sale]
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
 * What stays the matrix's own is the cells: a fixed row-label track, then one flexible track per
 * column, each cell a 32px well — tinted and
 * ticked when on, plain when off — pressable where the plan grid's are read-only, because here the
 * matrix *is* the editor. Wide on purpose: below its floor it scrolls sideways inside its own port
 * rather than squeezing the columns into slivers.
 *
 * The pieces are separate so the two steps compose them differently: Pages draws its level columns
 * as a pick-one row (`role="radio"`), Advanced draws each well as its own tick (`role="checkbox"`).
 * A cell always announces the whole sentence — row and column — since a tick means nothing alone.
 */

/**
 * A row-label track wide enough for a page name and most of its "Also opens" line — a longer one
 * wraps under it — and `minmax(120px, 1fr)` columns.
 */
export const MATRIX_ROW_TRACK = 320;
export const MATRIX_CELL_FLOOR = 120;

/**
 * A column's share of the width. A tick column is `1`; a column of named chips — Also allowed,
 * Other — is wider, so its names are read whole rather than cut to an ellipsis. The header and every
 * row take the same weights, which is what keeps the tracks aligned.
 */
function trackStyle(weight: number) {
    return { flex: weight, minWidth: MATRIX_CELL_FLOOR * weight };
}

/** `CatalogueList`'s panel — the frame every kitchen table sits in. */
const PANEL =
    'flex-col overflow-hidden rounded-panel border border-brand-100 bg-surface-raised shadow-elevation-card';

/** The width below which the matrix scrolls sideways: the name track plus each column's floor. */
export function matrixFloor(weights: readonly number[]): number {
    return MATRIX_ROW_TRACK + weights.reduce((sum, weight) => sum + weight, 0) * MATRIX_CELL_FLOOR;
}

export function MatrixFrame({
    label,
    floor,
    children,
    testID,
}: {
    /** Accessible name for the grid as a whole. */
    readonly label: string;
    /** The width below which the grid scrolls sideways rather than squeezing. */
    readonly floor: number;
    readonly children: ReactNode;
    readonly testID: string;
}) {
    return (
        // `flexGrow: 1` on the content: without it a horizontal scroller sizes its content to the
        // content's own minimum, and the matrix sat at its floor on a wide screen, squeezing every
        // name in it. With it the matrix fills the panel and scrolls only below its floor.
        <View className={PANEL}>
            <ScrollView
                horizontal
                testID={testID}
                contentContainerStyle={{ flexGrow: 1 }}
                contentContainerClassName="flex-col"
            >
                <View
                    accessibilityLabel={label}
                    style={{ minWidth: floor }}
                    className="flex-1 flex-col"
                >
                    {children}
                </View>
            </ScrollView>
        </View>
    );
}

export interface MatrixColumn {
    readonly key: string;
    readonly label: string;
    /** See {@link trackStyle}. `1` when omitted. */
    readonly weight?: number | undefined;
}

/**
 * The header row. An entry that is itself a list is drawn as one group — the way a row draws its
 * pick-one cells inside one `radiogroup` — so the header's tracks and the row's line up exactly.
 */
export function MatrixHeader({
    rowHeader,
    columns,
}: {
    readonly rowHeader: string;
    readonly columns: readonly (MatrixColumn | readonly MatrixColumn[])[];
}) {
    // `DataList`'s header: the brand's subtle band, labels a step heavier than the cells under it.
    const cell = (column: MatrixColumn) => (
        <View key={column.key} style={trackStyle(column.weight ?? 1)} className="py-1.5">
            <Text variant="strong" align="center" className="text-content-on-brand-subtle">
                {column.label}
            </Text>
        </View>
    );

    return (
        <View className="min-h-row-sm flex-row items-center gap-tight border-b border-stroke-subtle bg-surface-brand-subtle px-control-sm">
            <View style={{ width: MATRIX_ROW_TRACK }} className="py-1.5">
                <Text variant="strong" className="text-content-on-brand-subtle">
                    {rowHeader}
                </Text>
            </View>
            {columns.map((entry) =>
                isGroup(entry) ? (
                    <View
                        key={entry.map((column) => column.key).join('+')}
                        style={{
                            flex: entry.reduce((sum, column) => sum + (column.weight ?? 1), 0),
                        }}
                        className="flex-row gap-tight"
                    >
                        {entry.map(cell)}
                    </View>
                ) : (
                    cell(entry)
                ),
            )}
        </View>
    );
}

function isGroup(entry: MatrixColumn | readonly MatrixColumn[]): entry is readonly MatrixColumn[] {
    return Array.isArray(entry);
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
    return (
        // No hairline: `DataList`'s rows are told apart by height and the hover tint alone.
        <View
            testID={testID}
            className="min-h-row-md flex-row items-center gap-tight px-control-sm py-1 hover:bg-surface-sunken"
        >
            <View style={{ width: MATRIX_ROW_TRACK }} className="min-w-0 flex-col">
                <Text testID={`${testID}-name`}>{title}</Text>
                {caption}
            </View>
            {children}
        </View>
    );
}

/** One column's slot in a row. Holds a cell, several chips, or nothing. */
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
    return (
        <View
            testID={testID}
            style={trackStyle(weight)}
            className="flex-row flex-wrap items-center justify-center gap-hair"
        >
            {children}
        </View>
    );
}

/**
 * One pressable well. `word` is drawn inside it — a chip names its permission, a column cell draws
 * only the tick because its column header already says what it is. `label` is what is announced.
 */
export function MatrixCell({
    on,
    kind,
    label,
    word,
    marker,
    disabled,
    readOnly = false,
    onPress,
    testID,
}: {
    readonly on: boolean;
    readonly kind: 'radio' | 'checkbox';
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
    return (
        <Pressable
            testID={testID}
            role={kind}
            accessibilityRole={kind}
            accessibilityLabel={label}
            aria-label={label}
            aria-checked={on}
            accessibilityState={{ checked: on, disabled: disabled || readOnly }}
            aria-readonly={readOnly}
            disabled={disabled || readOnly}
            onPress={onPress}
            {...({ title: label } as object)}
            className={cx(
                'flex-row items-center justify-center gap-hair rounded-sm border px-2',
                // A tick fills its track; a chip is as wide as its name, wrapping inside the slot
                // and growing a line taller rather than cutting the name off.
                word === undefined ? 'h-control-sm w-full' : 'min-h-control-sm max-w-full py-1',
                on
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : cx(
                          'border-stroke-subtle bg-surface-raised',
                          readOnly ? null : 'hover:bg-surface-sunken',
                      ),
                disabled ? 'opacity-50' : null,
            )}
        >
            {on ? <Icon name="check" size="sm" className="text-content-on-brand-subtle" /> : null}
            {word === undefined ? null : (
                <Text
                    variant="caption"
                    className={cx(
                        'shrink',
                        on ? 'text-content-on-brand-subtle' : 'text-content-secondary',
                    )}
                >
                    {word}
                </Text>
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
