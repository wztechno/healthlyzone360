import { Button, Checkbox, Dialog, Icon, Text } from '@healthy360/design-system';
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
 * [ ▦ Show columns · 6 of 6 ]   opens, centred over the dimmed page:
 *
 *        ┌──────────────────────────────────────┐
 *        │ Choose the columns to show           │
 *        │ Show up to 6 columns                 │
 *        │ Show columns · 6 of 6                │
 *        │ ☑ Id              ☑ Item  ← locked   │
 *        │ ☑ Category        ☐ Sub-category     │
 *        │ ☐ Unit            ☑ Allergens        │
 *        │ ...                ← unticked rows disabled while six are on
 *        │   Clear all   Reset to default   Done   │
 *        └──────────────────────────────────────┘
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
    /**
     * Where the choice is remembered, when that is not the table's own id.
     *
     * A stored choice replaces the defaults, so a table that gains columns every reader should see
     * states a new key here — `kitchen-recipes.v2` — and every reader starts from the new defaults
     * once. The table's id, and every test id derived from it, stays what it was.
     */
    readonly storageKey?: string | undefined;
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
    { defaults, locked = [], max = MAX_VISIBLE_COLUMNS, storageKey }: ColumnVisibilityOptions,
): ColumnVisibility<Column> {
    const storedAs = storageKey ?? tableId;
    const known = useMemo(() => new Set(columns.map((column) => column.key)), [columns]);
    const [chosen, setChosen] = useState<readonly string[]>(() =>
        normalise(readStored(storedAs, known) ?? defaults, locked, known, max),
    );

    const commit = useCallback(
        (next: readonly string[]) => {
            setChosen(next);
            store.set(`${STORAGE_PREFIX}${storedAs}`, JSON.stringify(next));
        },
        [storedAs],
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
            // Everything off but the locked columns, which cannot be — the title always stays.
            canClear: [...shown].some((key) => !locked.includes(key)),
            onClear: () => {
                commit(normalise([], locked, known, max));
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
    /** Unticks every column the reader may untick; the locked ones stay. */
    readonly onClear: () => void;
    /** False once only locked columns are left, when Clear all would do nothing. */
    readonly canClear: boolean;
    readonly testID: string;
}

/**
 * The toolbar button, and the window it opens in the middle of the screen.
 *
 * A `Dialog` rather than a menu hanging off the button: choosing columns is setting several
 * switches and then looking at the table, so the choice gets a window of its own — dimmed page
 * behind it, the design system's own entrance, focus held inside until it closes. It stays open
 * through every toggle and closes on Done, a click on the backdrop or Escape.
 *
 * The columns are checkboxes laid out two to a row, so a record with fourteen fields is a short
 * square window rather than a long strip. The running count sits above them, so the cap is visible
 * before it is reached. Each row is the design system's `Checkbox`, which takes the desk density on
 * its own; its checked and disabled state are on its `-control` element, as every checkbox in the
 * app has them.
 */
export function ColumnPicker({
    options,
    shown,
    max,
    onToggle,
    onReset,
    onClear,
    canClear,
    testID,
}: ColumnPickerProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => {
        setOpen(false);
    }, []);

    return (
        <View testID={testID}>
            <Button
                testID={`${testID}-trigger`}
                variant="secondary"
                label={t('kitchen:catalogue.columnsButton', { shown, max })}
                iconStart={<Icon name="layoutGrid" size="sm" className="text-content-primary" />}
                hint={t('kitchen:catalogue.columnsHint', { max })}
                aria-haspopup="dialog"
                onPress={() => {
                    setOpen(true);
                }}
            />
            <Dialog
                testID={`${testID}-dialog`}
                open={open}
                onClose={close}
                title={t('kitchen:catalogue.columnsLabel')}
                description={t('kitchen:catalogue.columnsHeading', { max })}
                actions={
                    <>
                        <Button
                            testID={`${testID}-clear`}
                            variant="ghost"
                            label={t('kitchen:catalogue.columnsClear')}
                            disabled={!canClear}
                            onPress={onClear}
                        />
                        <Button
                            testID={`${testID}-reset`}
                            variant="ghost"
                            label={t('kitchen:catalogue.columnsReset')}
                            onPress={onReset}
                        />
                        <Button
                            testID={`${testID}-done`}
                            label={t('common:action.done')}
                            onPress={close}
                        />
                    </>
                }
            >
                <Text variant="mono" tone="secondary" testID={`${testID}-count`}>
                    {t('kitchen:catalogue.columnsButton', { shown, max })}
                </Text>
                <View className="flex-row flex-wrap gap-y-hair">
                    {options.map((option) => (
                        <View key={option.key} className="w-1/2 pe-tight">
                            <Checkbox
                                testID={`${testID}-${option.key}`}
                                label={option.label}
                                checked={option.shown}
                                disabled={option.disabled}
                                onChange={() => {
                                    onToggle(option.key);
                                }}
                            />
                        </View>
                    ))}
                </View>
            </Dialog>
        </View>
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
