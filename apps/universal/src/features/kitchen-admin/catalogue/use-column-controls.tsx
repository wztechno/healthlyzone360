import type { DataListColumn, MenuItem } from '@healthy360/design-system';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CatalogueColumnHeader } from './catalogue-column-header.tsx';

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
 * A column sorts **or** filters. A sorting header sorts on the press itself — first press ascending,
 * pressing the sorted column flips it — because a menu asking "ascending or descending" is a second
 * press for what the first already meant. A filtering header opens its values. A column that does
 * neither gets no `renderHeader`, which is what tells `DataList` to draw a plain label rather than a
 * focusable trigger that does nothing.
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
    /** A column sorts or filters, not both. */
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
}

export function useColumnControls<Row, Base extends DataListColumn<Row> = DataListColumn<Row>>(
    rows: readonly Row[],
    columns: readonly ControlledColumn<Row, Base>[],
    testIDPrefix: string,
    options: ColumnControlsOptions = {},
): ColumnControls<Row, Base> {
    const { t } = useTranslation();
    const external = options.sort;
    const [localSort, setLocalSort] = useState<{
        readonly key: string;
        readonly direction: SortDirection;
    } | null>(null);
    const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});

    const visible = useMemo(() => {
        const narrowed = rows.filter((row) =>
            columns.every((column) => {
                const chosen = filters[column.key];
                if (chosen === undefined || column.filter === undefined) return true;
                return 'match' in column.filter ? column.filter.match(row, chosen) : true;
            }),
        );
        if (localSort === null) return narrowed;
        const sorter = columns.find((column) => column.key === localSort.key)?.sort;
        if (typeof sorter !== 'function') return narrowed;
        return [...narrowed].sort((left, right) => sorter(left, right, localSort.direction));
    }, [rows, columns, filters, localSort]);

    const key = useMemo(() => ({ filters }), [filters]);

    const activeSort =
        external === undefined
            ? localSort
            : external.key === null
              ? null
              : { key: external.key, direction: external.direction };

    const controlled = columns.map((column): Base => {
        const { sort: sorter, filter, ...rest } = column;
        const base = rest as unknown as Base;
        const testID = `${testIDPrefix}-column-${column.key}`;

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
                        sections={
                            items.length === 0
                                ? []
                                : [{ label: t('kitchen:catalogue.filter'), items }]
                        }
                        filtered={current !== null}
                        testID={testID}
                    />
                ),
            };
        }

        if (sorter !== undefined) {
            const active = activeSort?.key === column.key;
            const direction = active ? activeSort.direction : null;
            const next: SortDirection = active && direction === 'asc' ? 'desc' : 'asc';
            return {
                ...base,
                renderHeader: (): ReactNode => (
                    <CatalogueColumnHeader
                        label={column.label}
                        align={column.align}
                        sections={[]}
                        sortDirection={direction}
                        onToggleSort={() => {
                            if (external === undefined) {
                                setLocalSort({ key: column.key, direction: next });
                            } else {
                                external.onChange(column.key, next);
                            }
                        }}
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
