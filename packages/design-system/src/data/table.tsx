import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { GAP_CLASS } from '../primitives/stack.tsx';
import type { SpaceStep } from '../primitives/stack.tsx';

export type TableSortDirection = 'asc' | 'desc';

/**
 * Column headers: small, bold, upper-case and widely tracked, in the demoted text role.
 *
 * A header is a label for the column, not a competitor to the figures under it — so it is the
 * quietest thing in the table by colour and the most distinct by shape. `content-disabled` is the
 * demoted role rather than a grey invented for the purpose (§1.3 allows exactly two), and it still
 * owes the normal-text ratio because it carries real words: 5.17:1 on `surface-raised`, 4.69:1 on
 * `surface-sunken`. Both are asserted in `packages/design-tokens/src/colour.test.ts`.
 */
const HEADER_CELL_CLASS = 'text-xs font-bold uppercase tracking-widest text-content-disabled';

/**
 * A trailing per-row control — "View", "Edit", a menu. `header` names the column above `md` and is
 * what a screen reader meets before the buttons; it is required for that reason.
 */
export interface TableRowAction<Row> {
    readonly header: string;
    readonly render: (row: Row) => ReactNode;
}

export interface TableColumn<Row> {
    readonly key: string;
    readonly header: string;
    /** Aligns to the trailing edge so figures line up on their last digit. */
    readonly numeric?: boolean | undefined;
    /**
     * The one figure in the row a reader is actually comparing — a total, a price, a count. It is
     * set in the display face so the eye finds it without reading the row, and at most one column
     * should claim it: two "most important" numbers is none.
     */
    readonly primary?: boolean | undefined;
    /**
     * Marks the column that names the row. It becomes a `rowheader` in the table presentation and
     * the card's leading line in the stacked presentation. At most one column should set this.
     */
    readonly rowHeader?: boolean | undefined;
    /** Relative width inside the row. Defaults to 1. */
    readonly flex?: number | undefined;
    /**
     * Makes the column's header pressable and gives it an `aria-sort`. Only the wide presentation
     * has column headers, so this has no effect below `md`.
     */
    readonly sortable?: boolean | undefined;
    readonly render: (row: Row) => ReactNode;
}

export interface TableProps<Row> {
    /** The table's accessible name. Rendered visibly unless `captionHidden` is set. */
    readonly caption: string;
    readonly columns: readonly TableColumn<Row>[];
    readonly rows: readonly Row[];
    readonly rowKey: (row: Row) => string;
    readonly captionHidden?: boolean | undefined;
    readonly emptyLabel?: string | undefined;
    /** The `key` of the column the caller has sorted by, or `null` for "not sorted". */
    readonly sortKey?: string | null | undefined;
    /** Only meaningful together with `sortKey`. Defaults to `'asc'`. */
    readonly sortDirection?: TableSortDirection | undefined;
    readonly onSortChange?: ((key: string, direction: TableSortDirection) => void) | undefined;
    /** A trailing action column above `md`; a card footer below it. */
    readonly rowAction?: TableRowAction<Row> | undefined;
    /** The gap between columns, in both the header row and every data row. Defaults to 12px. */
    readonly columnGap?: SpaceStep | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Table — two presentations of one dataset.
 *
 * **Above `md`** it is a table: `role="table"` with `columnheader` and `rowheader` cells, named by
 * its caption through `aria-labelledby`. The roles are set explicitly rather than relying on HTML
 * elements because react-native-web renders every primitive as a `div` — an ARIA table is the one
 * contract that means the same thing on both platforms, and `columnheader` / `rowheader` express
 * exactly what `scope="col"` and `scope="row"` express in HTML.
 *
 * **Below `md`** it becomes stacked cards, one per row, each field labelled by its column header. A
 * five-column table at 360 px is either an unreadable squeeze or a sideways scroll, and the
 * research is unambiguous that horizontal scrolling must stay inside the component and never reach
 * the document (`08-responsive-behaviour.md`, RSP-01). The switch is a *branch*, not a responsive
 * class: rendering both and hiding one leaves the hidden copy in the accessibility tree, and a
 * screen reader user then meets every figure twice.
 *
 * **Sorting is fully controlled.** The table never sorts `rows` and never holds sort state: it draws
 * the affordance, reports the intent through `onSortChange`, and re-renders whatever the caller
 * hands back. Pressing the column that is already active toggles its direction; pressing any other
 * sortable column selects it **ascending** — a fresh sort starts at the top of the scale, which is
 * what every table the reader has already used does, and guessing "descending, because they
 * probably want the biggest" is a guess. The affordance exists only in the wide presentation: below
 * `md` there are no column headers to press, so a card list is sorted by whatever control the
 * screen around it provides, never by the table.
 *
 * **`rowAction`** is a trailing cell above `md` — counted in `aria-colcount`, with its own
 * `columnheader` — and a footer inside each card below it, where a fourth column of buttons would
 * be the squeeze the stacked branch exists to avoid.
 */
export function Table<Row>({
    caption,
    columns,
    rows,
    rowKey,
    captionHidden = false,
    emptyLabel,
    sortKey = null,
    sortDirection = 'asc',
    onSortChange,
    rowAction,
    columnGap,
    className,
    testID,
}: TableProps<Row>) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const generated = useId();
    const base = testID ?? `table-${generated.replace(/:/g, '')}`;
    const rowGapClass = columnGap === undefined ? 'gap-3' : GAP_CLASS[columnGap];
    const captionId = `${base}-caption`;
    const wide = atLeast('md');
    const isEmpty = rows.length === 0;
    const columnCount = columns.length + (rowAction === undefined ? 0 : 1);

    const nextDirection = (key: string): TableSortDirection => {
        if (key !== sortKey) return 'asc';
        return sortDirection === 'asc' ? 'desc' : 'asc';
    };

    /**
     * The action column is sized to its buttons, not to a share of the row.
     *
     * It used to take `flex: 1` like any other column, which on a four-column table left it about a
     * fifth of the width — and "Adjust / Waste / Threshold" does not fit in a fifth of anything. The
     * buttons wrapped onto two and three lines, so the same three controls sat at a different height
     * in every row and the column read as a pile rather than a list. Giving the cell `flexBasis:
     * 'auto'` with no grow and no shrink sizes it to its content instead, which on the web is the
     * unwrapped width of the row of buttons.
     *
     * That alone would misalign the header, because "ACTIONS" is much narrower than the buttons
     * underneath it and the data columns would then divide a different remainder in the header row
     * than in the body rows. So the widest action cell is *measured* and applied as a `minWidth` to
     * every action cell **and** to the header's — one width for the whole column, taken from the
     * content rather than from a number picked here. Measuring is what keeps it honest in Arabic,
     * where every label is a different length; a hard-coded column width would only ever be right in
     * one language.
     *
     * `minWidth` rather than `width`: a row with an extra button is still allowed to be wider, and
     * the next measurement pass simply raises the column to it. The width only ever grows, so the
     * loop settles after one pass. It is keyed by the header text so switching language starts a
     * fresh measurement instead of holding the old language's width for ever.
     */
    const [measured, setMeasured] = useState<{ key: string; width: number } | null>(null);
    const actionKey = rowAction?.header ?? '';
    const actionWidth = measured !== null && measured.key === actionKey ? measured.width : null;

    const measureAction = (event: LayoutChangeEvent) => {
        const width = Math.ceil(event.nativeEvent.layout.width);
        setMeasured((current) =>
            current !== null && current.key === actionKey && current.width >= width
                ? current
                : { key: actionKey, width },
        );
    };

    // Typed structurally rather than as `ViewStyle`, because the same object is spread onto the
    // header cell, which is a `Text`.
    const actionCellStyle: {
        readonly flexGrow: number;
        readonly flexShrink: number;
        readonly flexBasis: 'auto';
        readonly minWidth?: number;
    } = {
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: 'auto',
        ...(actionWidth === null ? {} : { minWidth: actionWidth }),
    };

    const captionNode = captionHidden ? null : (
        <RNText
            nativeID={captionId}
            testID={`${base}-caption`}
            className="text-sm font-semibold text-content-primary text-start"
        >
            {caption}
        </RNText>
    );

    const emptyNode = isEmpty ? (
        <RNText
            testID={`${base}-empty`}
            className="rounded-lg border border-stroke-subtle p-4 text-sm text-content-secondary text-start"
        >
            {emptyLabel ?? t('designSystem:table.empty')}
        </RNText>
    ) : null;

    // The accessible name goes on the data container itself, never on the wrapper: the wrapper also
    // holds the visible caption, and a name plus its own visible copy is announced twice.
    const naming = captionHidden
        ? { 'aria-label': caption, accessibilityLabel: caption }
        : { 'aria-labelledby': captionId };

    if (!wide) {
        return (
            <View testID={testID} className={cx('flex-col gap-3', className)}>
                {captionNode}
                {emptyNode}
                {isEmpty ? null : (
                    <View
                        testID={`${base}-cards`}
                        role="list"
                        {...naming}
                        className="flex-col gap-3"
                    >
                        {rows.map((row) => (
                            <View
                                key={rowKey(row)}
                                testID={`${base}-card-${rowKey(row)}`}
                                role="listitem"
                                className="flex-col gap-2 rounded-lg border border-stroke-subtle bg-surface-raised p-3"
                            >
                                {columns.map((column) => (
                                    <View
                                        key={column.key}
                                        className={cx(
                                            column.rowHeader === true
                                                ? 'flex-col items-start'
                                                : 'flex-row items-baseline gap-3',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'text-xs text-content-secondary text-start',
                                                column.rowHeader === true ? null : 'flex-1',
                                            )}
                                        >
                                            {column.header}
                                        </RNText>
                                        <View
                                            className={
                                                column.numeric === true
                                                    ? 'items-end'
                                                    : 'items-start'
                                            }
                                        >
                                            {column.render(row)}
                                        </View>
                                    </View>
                                ))}
                                {rowAction === undefined ? null : (
                                    <View
                                        testID={`${base}-card-${rowKey(row)}-action`}
                                        className="flex-row flex-wrap items-center justify-end gap-2 border-t border-stroke-subtle pt-2"
                                    >
                                        {rowAction.render(row)}
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                )}
            </View>
        );
    }

    return (
        <View testID={testID} className={cx('flex-col gap-2', className)}>
            {captionNode}
            {emptyNode}
            {isEmpty ? null : (
                <View
                    testID={`${base}-table`}
                    role="table"
                    {...naming}
                    aria-rowcount={rows.length + 1}
                    aria-colcount={columnCount}
                    className="flex-col"
                >
                    <View
                        testID={`${base}-header`}
                        role="row"
                        className={cx(
                            'flex-row items-center border-b-2 border-stroke-subtle px-1 pb-2',
                            rowGapClass,
                        )}
                    >
                        {columns.map((column) => {
                            if (column.sortable !== true) {
                                return (
                                    <RNText
                                        key={column.key}
                                        testID={`${base}-columnheader-${column.key}`}
                                        role="columnheader"
                                        numberOfLines={2}
                                        className={cx(
                                            HEADER_CELL_CLASS,
                                            column.numeric === true ? 'text-end' : 'text-start',
                                        )}
                                        style={{ flex: column.flex ?? 1 }}
                                    >
                                        {column.header}
                                    </RNText>
                                );
                            }

                            const active = column.key === sortKey;
                            const ascending = active && sortDirection === 'asc';

                            return (
                                <View
                                    key={column.key}
                                    testID={`${base}-columnheader-${column.key}`}
                                    role="columnheader"
                                    // The state lives on the header, where ARIA looks for it; the
                                    // button inside says what pressing it does.
                                    aria-sort={
                                        !active ? 'none' : ascending ? 'ascending' : 'descending'
                                    }
                                    style={{ flex: column.flex ?? 1 }}
                                >
                                    <Pressable
                                        testID={`${base}-sort-${column.key}`}
                                        role="button"
                                        accessibilityRole="button"
                                        accessibilityLabel={t('designSystem:table.sortBy', {
                                            column: column.header,
                                        })}
                                        aria-label={t('designSystem:table.sortBy', {
                                            column: column.header,
                                        })}
                                        // Native has no `aria-sort`, so the current state is
                                        // carried in the hint there instead of being lost.
                                        {...(active
                                            ? {
                                                  accessibilityHint: t(
                                                      ascending
                                                          ? 'designSystem:table.sortedAscending'
                                                          : 'designSystem:table.sortedDescending',
                                                  ),
                                              }
                                            : {})}
                                        onPress={() => {
                                            onSortChange?.(column.key, nextDirection(column.key));
                                        }}
                                        className={cx(
                                            'flex-row items-center gap-1 min-h-touch',
                                            column.numeric === true
                                                ? 'justify-end'
                                                : 'justify-start',
                                        )}
                                    >
                                        <RNText
                                            numberOfLines={2}
                                            className={cx(
                                                'shrink',
                                                HEADER_CELL_CLASS,
                                                active ? 'text-content-primary' : null,
                                                column.numeric === true ? 'text-end' : 'text-start',
                                            )}
                                        >
                                            {column.header}
                                        </RNText>
                                        <Icon
                                            testID={`${base}-sort-indicator-${column.key}`}
                                            name={
                                                active && !ascending ? 'chevronDown' : 'chevronUp'
                                            }
                                            size="sm"
                                            className={
                                                active
                                                    ? 'text-content-primary'
                                                    : 'text-content-disabled'
                                            }
                                        />
                                    </Pressable>
                                </View>
                            );
                        })}
                        {rowAction === undefined ? null : (
                            <RNText
                                testID={`${base}-columnheader-action`}
                                role="columnheader"
                                numberOfLines={2}
                                className={cx(HEADER_CELL_CLASS, 'text-end')}
                                style={actionCellStyle}
                            >
                                {rowAction.header}
                            </RNText>
                        )}
                    </View>

                    {rows.map((row) => (
                        <View
                            key={rowKey(row)}
                            testID={`${base}-row-${rowKey(row)}`}
                            role="row"
                            className={cx(
                                'flex-row items-center border-b border-surface-sunken px-1 py-3',
                                rowGapClass,
                            )}
                        >
                            {columns.map((column) => (
                                <View
                                    key={column.key}
                                    testID={`${base}-cell-${rowKey(row)}-${column.key}`}
                                    role={column.rowHeader === true ? 'rowheader' : 'cell'}
                                    className={cx(
                                        column.numeric === true ? 'items-end' : 'items-start',
                                        // The display face is applied to the *cell*, so a caller
                                        // gets the treatment by declaring which column matters
                                        // rather than by repeating a class in every `render`.
                                        column.primary === true
                                            ? 'font-display text-base text-content-primary'
                                            : null,
                                    )}
                                    style={{ flex: column.flex ?? 1 }}
                                >
                                    {column.render(row)}
                                </View>
                            ))}
                            {rowAction === undefined ? null : (
                                <View
                                    testID={`${base}-cell-${rowKey(row)}-action`}
                                    role="cell"
                                    className="items-end"
                                    style={actionCellStyle}
                                >
                                    {/*
                                     * The measurement happens on this inner view rather than on
                                     * the cell, and that is the whole reason it terminates. The
                                     * cell is the thing `minWidth` is applied to, so measuring it
                                     * would feed the column's own width back in as the content
                                     * width and no row could ever report anything narrower than
                                     * the widest one already seen. This view is content-sized
                                     * inside an `items-end` column, so what it reports is the
                                     * natural width of that row's buttons, independently of what
                                     * the column has been widened to.
                                     */}
                                    <View onLayout={measureAction}>{rowAction.render(row)}</View>
                                </View>
                            )}
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}
