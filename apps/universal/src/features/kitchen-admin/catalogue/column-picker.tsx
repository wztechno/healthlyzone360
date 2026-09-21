import { Button, Icon, Menu } from '@healthy360/design-system';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { createKeyValueStore } from '../../../session/storage.ts';

/**
 * Which of a table's columns are drawn — chosen by the reader, at most {@link MAX_VISIBLE_COLUMNS}.
 *
 * A kitchen record carries far more than a desk-width row can hold: the ingredient alone has a
 * purchase pack, a density, three prices and a composition beside the seven fields the list has
 * always drawn. Rather than pick six for everyone, the table offers every field as a column and lets
 * the reader keep the six they work from.
 *
 * ```
 * [ Columns 6/6 ▾ ]
 *   Show up to 6 columns
 *   ✓ Id
 *   ✓ Item            ← locked: the row's title is how a row is named
 *   ✓ Category
 *     Sub-category    ← disabled while six are already on
 *   ...
 *   Reset to default
 * ```
 *
 * ## Six, and the cap is a disabled row rather than a refusal
 *
 * Once six are on, every unchecked row greys out; unchecking one frees a slot. A reader sees the
 * limit before hitting it instead of pressing a seventh and watching nothing happen. The row-actions
 * track is `CatalogueList`'s own and is not a column here, so it never counts against the six.
 *
 * ## Locked columns
 *
 * A table names the columns that cannot be dropped — the title column, which the narrow two-line row
 * and every row's accessible name are built from. They show ticked and disabled, and count toward
 * the six.
 *
 * ## The cap is the catalogue's, and a worksheet may state its own
 *
 * Six is a browsing rule: a catalogue row carries more fields than anyone reads at once, so the
 * table offers all of them and the reader keeps six. A worksheet is the other case — the order
 * desk's requirements table is eight columns of one arithmetic, and hiding two of them leaves the
 * buyer deriving a figure the row already holds. Such a table passes its own `max` and draws every
 * column; the picker still lets the reader put one away.
 *
 * ## Remembered per table, per device
 *
 * The choice is kept under `h360.table-columns.<table>` in the same non-sensitive key/value store the
 * query cache uses, so it survives a reload. A stored key that no longer names a column is dropped
 * on read, and an empty or unreadable record falls back to the table's defaults.
 */

export const MAX_VISIBLE_COLUMNS = 6;

const STORAGE_PREFIX = 'h360.table-columns.';

const store = createKeyValueStore();

/** Forgets a table's stored choice. For tests, which share the module's in-memory store. */
export function forgetColumnChoice(tableId: string): void {
    store.remove(`${STORAGE_PREFIX}${tableId}`);
}

/** Stores a table's choice as if the reader had made it. For tests that need a given column on. */
export function rememberColumnChoice(tableId: string, keys: readonly string[]): void {
    store.set(`${STORAGE_PREFIX}${tableId}`, JSON.stringify(keys));
}

interface PickableColumn {
    readonly key: string;
    readonly label: string;
}

export interface ColumnVisibilityOptions {
    /** The columns drawn until the reader chooses, in any order. Capped at the maximum. */
    readonly defaults: readonly string[];
    /** Columns that are always drawn and cannot be unticked. They count toward the maximum. */
    readonly locked?: readonly string[] | undefined;
    /**
     * How many columns may be drawn at once. {@link MAX_VISIBLE_COLUMNS} unless a table states
     * otherwise, which the ops worksheets do — see the opt-out note above.
     */
    readonly max?: number | undefined;
}

export interface ColumnVisibility<Column extends PickableColumn> {
    /** The chosen columns, in the table's own order. */
    readonly visible: readonly Column[];
    /** Everything the picker needs; spread it onto {@link ColumnPicker}. */
    readonly picker: ColumnPickerProps;
}

function readStored(tableId: string, known: ReadonlySet<string>): readonly string[] | null {
    const raw = store.get(`${STORAGE_PREFIX}${tableId}`);
    if (raw === null) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        const keys = parsed.filter(
            (entry): entry is string => typeof entry === 'string' && known.has(entry),
        );
        return keys.length === 0 ? null : keys;
    } catch {
        return null;
    }
}

/** Locked first, then the rest, deduplicated and capped. */
function normalise(
    keys: readonly string[],
    locked: readonly string[],
    known: ReadonlySet<string>,
    max: number,
): readonly string[] {
    const ordered = [...locked, ...keys].filter((key) => known.has(key));
    return [...new Set(ordered)].slice(0, max);
}

export function useColumnVisibility<Column extends PickableColumn>(
    tableId: string,
    columns: readonly Column[],
    { defaults, locked = [], max = MAX_VISIBLE_COLUMNS }: ColumnVisibilityOptions,
): ColumnVisibility<Column> {
    const known = useMemo(() => new Set(columns.map((column) => column.key)), [columns]);
    const [chosen, setChosen] = useState<readonly string[]>(() =>
        normalise(readStored(tableId, known) ?? defaults, locked, known, max),
    );

    const commit = useCallback(
        (next: readonly string[]) => {
            setChosen(next);
            store.set(`${STORAGE_PREFIX}${tableId}`, JSON.stringify(next));
        },
        [tableId],
    );

    const shown = useMemo(
        () => new Set(normalise(chosen, locked, known, max)),
        [chosen, locked, known, max],
    );

    const visible = useMemo(
        () => columns.filter((column) => shown.has(column.key)),
        [columns, shown],
    );

    const full = shown.size >= max;

    return {
        visible,
        picker: {
            testID: `${tableId}-columns`,
            shown: shown.size,
            max,
            options: columns.map((column) => {
                const isLocked = locked.includes(column.key);
                const isShown = shown.has(column.key);
                return {
                    key: column.key,
                    label: column.label,
                    shown: isShown,
                    disabled: isLocked || (!isShown && full),
                };
            }),
            onToggle: (key) => {
                if (locked.includes(key)) return;
                if (shown.has(key)) {
                    commit([...shown].filter((entry) => entry !== key));
                } else if (!full) {
                    commit([...shown, key]);
                }
            },
            onReset: () => {
                commit(normalise(defaults, locked, known, max));
            },
        },
    };
}

export interface ColumnPickerOption {
    readonly key: string;
    readonly label: string;
    readonly shown: boolean;
    readonly disabled: boolean;
}

export interface ColumnPickerProps {
    readonly options: readonly ColumnPickerOption[];
    readonly shown: number;
    /** The table's own cap, which the heading and the button both state. */
    readonly max: number;
    readonly onToggle: (key: string) => void;
    readonly onReset: () => void;
    readonly testID: string;
}

/** The toolbar button and its menu of columns. Toggling keeps the menu open. */
export function ColumnPicker({
    options,
    shown,
    max,
    onToggle,
    onReset,
    testID,
}: ColumnPickerProps) {
    const { t } = useTranslation();

    return (
        <Menu
            testID={testID}
            label={t('kitchen:catalogue.columnsLabel')}
            align="end"
            className="z-sticky"
            sections={[
                {
                    label: t('kitchen:catalogue.columnsHeading', { max }),
                    items: options.map((option) => ({
                        key: option.key,
                        label: option.label,
                        selected: option.shown,
                        disabled: option.disabled,
                        testID: `${testID}-${option.key}`,
                        onSelect: () => {
                            onToggle(option.key);
                        },
                    })),
                },
            ]}
            footer={
                <Button
                    testID={`${testID}-reset`}
                    size="sm"
                    variant="ghost"
                    label={t('kitchen:catalogue.columnsReset')}
                    onPress={onReset}
                />
            }
            trigger={({ triggerProps, toggle }) => (
                <Button
                    {...triggerProps}
                    testID={`${testID}-trigger`}
                    variant="secondary"
                    label={t('kitchen:catalogue.columnsButton', { shown, max })}
                    iconEnd={<Icon name="chevronDown" size="sm" />}
                    onPress={toggle}
                />
            )}
        />
    );
}

/**
 * A table with its column picker right-aligned above it — for tables with no `CatalogueToolbar` to
 * hold the button, such as the order desk and the report tables.
 */
export function WithColumnPicker({
    picker,
    children,
}: {
    readonly picker: ColumnPickerProps;
    readonly children: ReactNode;
}) {
    return (
        <View className="flex-col gap-tight">
            <View className="flex-row justify-end">
                <ColumnPicker {...picker} />
            </View>
            {children}
        </View>
    );
}
