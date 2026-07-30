import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { cx } from '../internal/class-names.ts';

export interface TableColumn<Row> {
    readonly key: string;
    readonly header: string;
    /** Aligns to the trailing edge so figures line up on their last digit. */
    readonly numeric?: boolean | undefined;
    /**
     * Marks the column that names the row. It becomes a `rowheader` in the table presentation and
     * the card's leading line in the stacked presentation. At most one column should set this.
     */
    readonly rowHeader?: boolean | undefined;
    /** Relative width inside the row. Defaults to 1. */
    readonly flex?: number | undefined;
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
 */
export function Table<Row>({
    caption,
    columns,
    rows,
    rowKey,
    captionHidden = false,
    emptyLabel,
    className,
    testID,
}: TableProps<Row>) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const generated = useId();
    const base = testID ?? `table-${generated.replace(/:/g, '')}`;
    const captionId = `${base}-caption`;
    const wide = atLeast('md');
    const isEmpty = rows.length === 0;

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
                    aria-colcount={columns.length}
                    className="flex-col overflow-hidden rounded-lg border border-stroke-subtle"
                >
                    <View
                        testID={`${base}-header`}
                        role="row"
                        className="flex-row items-center gap-3 border-b border-stroke-subtle bg-surface-sunken px-3 py-2"
                    >
                        {columns.map((column) => (
                            <RNText
                                key={column.key}
                                testID={`${base}-columnheader-${column.key}`}
                                role="columnheader"
                                numberOfLines={2}
                                className={cx(
                                    'text-xs font-semibold text-content-secondary',
                                    column.numeric === true ? 'text-end' : 'text-start',
                                )}
                                style={{ flex: column.flex ?? 1 }}
                            >
                                {column.header}
                            </RNText>
                        ))}
                    </View>

                    {rows.map((row) => (
                        <View
                            key={rowKey(row)}
                            testID={`${base}-row-${rowKey(row)}`}
                            role="row"
                            className="flex-row items-center gap-3 border-t border-stroke-subtle px-3 py-2"
                        >
                            {columns.map((column) => (
                                <View
                                    key={column.key}
                                    testID={`${base}-cell-${rowKey(row)}-${column.key}`}
                                    role={column.rowHeader === true ? 'rowheader' : 'cell'}
                                    className={
                                        column.numeric === true ? 'items-end' : 'items-start'
                                    }
                                    style={{ flex: column.flex ?? 1 }}
                                >
                                    {column.render(row)}
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}
