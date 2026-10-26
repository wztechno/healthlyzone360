import type { TransferResource } from '@healthy360/api-client/contracts';
import type { DataListColumn } from '@healthy360/design-system';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import type { SortDirection } from './use-column-controls.tsx';
import { compareDisplayed } from './use-column-controls.tsx';

/**
 * A list, frozen as text, on its way to `/kitchen/{resource}/print` (Export → PDF — table).
 *
 * ## Text, not rows
 *
 * The print route renders what the list *showed*: the visible columns' `value()` strings, in the
 * order the reader sorted them. Snapshotting the strings rather than the records means the print
 * screen needs no column definitions, no queries and no formatter of its own — and cannot drift
 * from the list it was opened from.
 *
 * ## Held per QueryClient, like the list memory
 *
 * One job per resource, scoped to the data cache exactly as `list-memory.ts` is: one store per tab
 * in the app, a fresh one per test. Nothing is written to disk, so a refreshed or pasted print URL
 * finds no job and says so (`transfer.print.expired*`) rather than printing a stale list.
 */
export interface ListPrintJob {
    readonly resource: TransferResource;
    readonly title: string;
    /** ISO timestamp of the moment the job was made. */
    readonly printedAt: string;
    readonly columns: readonly {
        readonly key: string;
        readonly label: string;
        readonly width: number;
    }[];
    readonly rows: readonly (readonly string[])[];
}

/** The most technical sheets one print batch carries — the server's cap, mirrored. */
export const TECHNICAL_SHEETS_MAX = 20;

export interface ListPrintSort<Row> {
    readonly key: string | null;
    readonly direction: SortDirection;
    /** Every column, hidden ones included, so a sort on a column not drawn still orders the rows. */
    readonly from: readonly DataListColumn<Row>[];
}

export function listPrintJob<Row>(input: {
    readonly resource: TransferResource;
    readonly title: string;
    readonly columns: readonly DataListColumn<Row>[];
    readonly rows: readonly Row[];
    readonly sort?: ListPrintSort<Row> | undefined;
}): ListPrintJob {
    const { sort } = input;

    // A column with no `value` draws only a control (the row's ⋯ or its buttons): nothing to print.
    const printable = input.columns.flatMap((column) =>
        column.value === undefined || column.key === 'actions'
            ? []
            : [{ key: column.key, label: column.label, width: column.width, value: column.value }],
    );

    const sortValue =
        sort === undefined || sort.key === null
            ? undefined
            : sort.from.find((column) => column.key === sort.key)?.value;

    const ordered =
        sort === undefined || sortValue === undefined
            ? input.rows
            : [...input.rows].sort((left, right) =>
                  compareDisplayed(sortValue(left), sortValue(right), sort.direction),
              );

    return {
        resource: input.resource,
        title: input.title,
        printedAt: new Date().toISOString(),
        columns: printable.map((column) => ({
            key: column.key,
            label: column.label,
            width: column.width > 0 ? column.width : 1,
        })),
        rows: ordered.map((row) => printable.map((column) => column.value(row))),
    };
}

const scopes = new WeakMap<object, Map<TransferResource, ListPrintJob>>();

function scopeOf(owner: object): Map<TransferResource, ListPrintJob> {
    const existing = scopes.get(owner);
    if (existing !== undefined) return existing;
    const created = new Map<TransferResource, ListPrintJob>();
    scopes.set(owner, created);
    return created;
}

export interface ListPrintControl {
    /** Holds the job and opens `/kitchen/{resource}/print`. */
    readonly start: (job: ListPrintJob) => void;
    /** The job last started for `resource` in this cache, or `null` (refreshed, pasted, signed out). */
    readonly read: (resource: TransferResource) => ListPrintJob | null;
}

export function useListPrint(): ListPrintControl {
    const queryClient = useQueryClient();
    const router = useRouter();

    const start = useCallback(
        (job: ListPrintJob) => {
            scopeOf(queryClient).set(job.resource, job);
            router.push(`/kitchen/${job.resource}/print` as never);
        },
        [queryClient, router],
    );

    const read = useCallback(
        (resource: TransferResource) => scopes.get(queryClient)?.get(resource) ?? null,
        [queryClient],
    );

    return useMemo(() => ({ start, read }), [start, read]);
}
