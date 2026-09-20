import type { DataListColumn, MenuItem } from '@healthy360/design-system';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CatalogueColumnHeader } from './catalogue-column-header.tsx';
import { MAX_VISIBLE_COLUMNS, useColumnVisibility } from './column-picker.tsx';
import type { ColumnPickerProps } from './column-picker.tsx';

/**
 * Sort-on-press and filter-from-menu headers for any kitchen table, declared on the column.
 *
 * Every Catalogue list used to wire `CatalogueColumnHeader` by hand — a `headerMenu`, a
 * `sortKeyFor`, a `filterItemsFor` and a `clearItem` per screen, the same ~150 lines six times —
 * and a new list either copied them or shipped plain labels. This hook is that wiring once: a column
 * says *how* it sorts or filters, and the hook draws the header and, where it owns the state, applies
 * it.
 *
 * ## Who owns the state, per column
 *
 * **Filters.** `filter.match` narrows the rows the hook was given, in memory — honest only where
 * those rows are the whole answer, such as the bounded order-desk queue. On a *paged* list that
 * would narrow one page and misreport every page after it, so a Catalogue list uses
 * `filter.external`: the screen holds the value and sends it with the request. The header, the tick
 * and the Clear are identical either way.
 *
 * **Sorting.** A column with a comparator sorts in memory. A column marked `sort: 'external'` sorts
 * through `options.sort`, which the screen owns — the Catalogue lists' sort lives in their list hooks
 * and travels to the server. A table picks one mode: `options.sort` present means every sortable
 * column is external.
 *
 * ## The header rules it keeps
 *
 * A sorting header sorts on the press itself — first press ascending, pressing the sorted column
 * flips it — because a menu asking "ascending or descending" is a second press for what the first
 * already meant. A filtering header opens its values. A column that does both splits its head: the
 * label opens the values and the arrow sorts. A column that does neither gets no `renderHeader`,
 * which is what tells `DataList` to draw a plain label rather than a focusable trigger that does
 * nothing.
 *
 * ## Which columns are drawn
 *
 * Every table built on this draws at most {@link MAX_VISIBLE_COLUMNS} columns, and the reader picks
 * which: the hook returns `picker`, which the screen renders as a `ColumnPicker` in its toolbar (or
 * above the table where it has none). The six highest-`priority` columns are the default, the title column —
 * `role: 'title'` where the spec states one, otherwise the first — is locked on, and the choice is
 * remembered under the table's `testIDPrefix`. Hiding a column that is filtering clears its filter,
 * so a list is never narrowed by a header the reader can no longer see.
 *
 * An in-memory filter column that names no comparator still sorts — by the label of the value each
 * row matches, which is the text the column shows. On a table whose sort the screen owns, a filter
 * column sorts only when it says `sort: 'external'`, because only the screen knows whether the
 * request can order by it.
 */

export type SortDirection = 'asc' | 'desc';

export interface ColumnFilterValue {
    readonly key: string;
    readonly label: string;
}

export type ColumnFilter<Row> =
    | {
          /** The choices. Receives the rows so a list can offer only values it can match. */
          readonly values: (rows: readonly Row[]) => readonly ColumnFilterValue[];
          /** In memory: whether a row belongs to the chosen value. */
          readonly match: (row: Row, value: string) => boolean;
      }
    | {
          readonly values: (rows: readonly Row[]) => readonly ColumnFilterValue[];
          /** Screen-owned: the value the request carries, and how to change it. */
          readonly external: {
              readonly value: string | null;
              readonly onChange: (value: string | null) => void;
          };
      };

export type ColumnComparator<Row> = (left: Row, right: Row, direction: SortDirection) => number;

export interface ColumnControl<Row> {
    /**
     * A comparator sorts in memory — it receives the direction rather than being negated, so it can
     * keep blanks last both ways. `'external'` sorts through `options.sort`.
     */
    readonly sort?: ColumnComparator<Row> | 'external' | undefined;
    /** Filters from the header's label. With a `sort` too, the arrow beside it sorts. */
    readonly filter?: ColumnFilter<Row> | undefined;
}

/** Any column shape — `DataListColumn`, `CatalogueColumn` — plus the two control fields. */
export type ControlledColumn<Row, Base extends DataListColumn<Row> = DataListColumn<Row>> = Base &
    ColumnControl<Row>;

export interface ExternalSort {
    readonly key: string | null;
    readonly direction: SortDirection;
    readonly onChange: (key: string, direction: SortDirection) => void;
}

export interface ColumnControlsOptions {
    /** Present when the screen owns sorting (a server-sorted list). */
    readonly sort?: ExternalSort | undefined;
    /** Which columns a first visit draws, and which cannot be dropped. See the module docs. */
    readonly picker?:
        | {
              readonly defaults?: readonly string[] | undefined;
              readonly locked?: readonly string[] | undefined;
              /** A worksheet's own cap, in place of the catalogue's six. See the module docs. */
              readonly max?: number | undefined;
          }
        | undefined;
}

export interface ColumnControls<Row, Base extends DataListColumn<Row>> {
    /** Sorted and narrowed by whatever the hook owns — render these. */
    readonly rows: readonly Row[];
    /** The columns with their headers drawn, in the caller's own column shape. */
    readonly columns: readonly Base[];
    /** True while an in-memory filter is narrowing the rows. External filters are the screen's. */
    readonly filtered: boolean;
    /** Changes whenever the in-memory filters do, so a pager can land on page one. */
    readonly key: object;
    readonly clearFilters: () => void;
    /** The column picker's props — spread onto `ColumnPicker`. */
    readonly picker: ColumnPickerProps;
}

export function useColumnControls<Row, Base extends DataListColumn<Row> = DataListColumn<Row>>(
    rows: readonly Row[],
    allColumns: readonly ControlledColumn<Row, Base>[],
    testIDPrefix: string,
    options: ColumnControlsOptions = {},
): ColumnControls<Row, Base> {
    const { t } = useTranslation();

    const statedLocked = options.picker?.locked;
    const statedDefaults = options.picker?.defaults;
    const max = options.picker?.max ?? MAX_VISIBLE_COLUMNS;
    const locked = useMemo(() => {
        if (statedLocked !== undefined) return statedLocked;
        const title =
            allColumns.find((column) => (column as { role?: string }).role === 'title') ??
            allColumns[0];
        return title === undefined ? [] : [title.key];
    }, [statedLocked, allColumns]);
    // The six the design ranks highest — `priority` is the same ladder the fitter drops columns by
    // at narrow widths — with the locked column always among them. Drawn in the table's own order.
    const defaults = useMemo(() => {
        if (statedDefaults !== undefined) return statedDefaults;
        const ranked = [...allColumns].sort((left, right) => right.priority - left.priority);
        return [...new Set([...locked, ...ranked.map((column) => column.key)])].slice(0, max);
    }, [statedDefaults, allColumns, locked, max]);
    const visibility = useColumnVisibility(testIDPrefix, allColumns, { defaults, locked, max });
    const columns = visibility.visible;

    const external = options.sort;
    const [localSort, setLocalSort] = useState<{
        readonly key: string;
        readonly direction: SortDirection;
    } | null>(null);
    const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});

    /*
     * Each column's in-memory comparator — its own, or for a matching filter column that names
     * none, one over the label of the value the row matches. The labels are resolved once per row
     * set rather than per comparison, since a match scan per compare is O(values) inside a sort.
     */
    const sorters = useMemo(() => {
        const resolved = new Map<string, ColumnComparator<Row> | 'external'>();
        for (const column of columns) {
            if (column.sort !== undefined) {
                resolved.set(column.key, column.sort);
                continue;
            }
            const filter = column.filter;
            if (external !== undefined || filter === undefined || !('match' in filter)) continue;
            const values = filter.values(rows);
            const labels = new Map<Row, string>();
            for (const row of rows) {
                const value = values.find((candidate) => filter.match(row, candidate.key));
                if (value !== undefined) labels.set(row, value.label);
            }
            resolved.set(column.key, (left, right, direction) =>
                compareText(labels.get(left), labels.get(right), direction),
            );
        }
        return resolved;
    }, [rows, columns, external]);

    const visible = useMemo(() => {
        const narrowed = rows.filter((row) =>
            columns.every((column) => {
                const chosen = filters[column.key];
                if (chosen === undefined || column.filter === undefined) return true;
                return 'match' in column.filter ? column.filter.match(row, chosen) : true;
            }),
        );
        if (localSort === null) return narrowed;
        const sorter = sorters.get(localSort.key);
        if (typeof sorter !== 'function') return narrowed;
        return [...narrowed].sort((left, right) => sorter(left, right, localSort.direction));
    }, [rows, columns, filters, localSort, sorters]);

    const key = useMemo(() => ({ filters }), [filters]);

    const activeSort =
        external === undefined
            ? localSort
            : external.key === null
              ? null
              : { key: external.key, direction: external.direction };

    const controlled = columns.map((column): Base => {
        const { sort: _sort, filter, ...rest } = column;
        const base = rest as unknown as Base;
        const testID = `${testIDPrefix}-column-${column.key}`;

        const sorter = sorters.get(column.key);
        const sortActive = sorter !== undefined && activeSort?.key === column.key;
        const direction =
            sorter === undefined ? undefined : sortActive ? activeSort.direction : null;
        const toggleSort =
            sorter === undefined
                ? undefined
                : () => {
                      const next: SortDirection =
                          sortActive && direction === 'asc' ? 'desc' : 'asc';
                      if (external === undefined) {
                          setLocalSort({ key: column.key, direction: next });
                      } else {
                          external.onChange(column.key, next);
                      }
                  };

        if (filter !== undefined) {
            const current =
                'external' in filter ? filter.external.value : (filters[column.key] ?? null);
            const choose = (next: string | null) => {
                if ('external' in filter) {
                    filter.external.onChange(next);
                    return;
                }
                setFilters((existing) => {
                    const { [column.key]: _dropped, ...others } = existing;
                    return next === null ? others : { ...others, [column.key]: next };
                });
            };
            const items: MenuItem[] = [
                ...filter.values(rows).map((value) => ({
                    key: value.key,
                    label: value.label,
                    selected: current === value.key,
                    testID: `${testID}-${value.key}`,
                    onSelect: () => {
                        choose(current === value.key ? null : value.key);
                    },
                })),
                ...(current === null
                    ? []
                    : [
                          {
                              key: 'clear',
                              label: t('kitchen:catalogue.clearFilter'),
                              testID: `${testID}-clear`,
                              onSelect: () => {
                                  choose(null);
                              },
                          },
                      ]),
            ];
            return {
                ...base,
                renderHeader: (): ReactNode => (
                    <CatalogueColumnHeader
                        label={column.label}
                        align={column.align}
                        sections={items.length === 0 ? [] : [{ items }]}
                        filtered={current !== null}
                        sortDirection={direction}
                        onToggleSort={toggleSort}
                        testID={testID}
                    />
                ),
            };
        }

        if (toggleSort !== undefined) {
            return {
                ...base,
                renderHeader: (): ReactNode => (
                    <CatalogueColumnHeader
                        label={column.label}
                        align={column.align}
                        sections={[]}
                        sortDirection={direction}
                        onToggleSort={toggleSort}
                        testID={testID}
                    />
                ),
            };
        }

        return base;
    });

    return {
        rows: visible,
        columns: controlled,
        filtered: Object.keys(filters).length > 0,
        key,
        clearFilters: () => {
            setFilters({});
        },
        picker: {
            ...visibility.picker,
            onToggle: (key) => {
                const hiding = columns.find((column) => column.key === key);
                const filter = hiding?.filter;
                if (filter !== undefined) {
                    if ('external' in filter) {
                        if (filter.external.value !== null) filter.external.onChange(null);
                    } else if (filters[key] !== undefined) {
                        setFilters((existing) => {
                            const { [key]: _dropped, ...others } = existing;
                            return others;
                        });
                    }
                }
                visibility.picker.onToggle(key);
            },
        },
    };
}

/**
 * Text in `direction`, blanks last either way, digits compared as numbers (`0002` before `0010`).
 * For names, telephones, references.
 */
export function compareText(
    left: string | null | undefined,
    right: string | null | undefined,
    direction: SortDirection,
): number {
    const blankLeft = left == null || left === '';
    const blankRight = right == null || right === '';
    if (blankLeft || blankRight) return blankLeft === blankRight ? 0 : blankLeft ? 1 : -1;
    const order = left.localeCompare(right, undefined, { numeric: true });
    return direction === 'asc' ? order : -order;
}

/** Numbers (amounts, timestamps) in `direction`. */
export function compareNumber(left: number, right: number, direction: SortDirection): number {
    return direction === 'asc' ? left - right : right - left;
}
