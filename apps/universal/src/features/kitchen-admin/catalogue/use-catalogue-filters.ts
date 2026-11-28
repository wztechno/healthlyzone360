import type { PublishableStatus } from '@healthy360/api-client/contracts';
import { useState } from 'react';

/**
 * The two filters every catalogue list has — the search box and the status set — held once.
 *
 * Each list adds axes of its own (a category, a kitchen, an allergen, a meal type), and those stay
 * in that list's hook. This is the part five hooks wrote identically. `isUnfiltered` and `clear`
 * cover these two alone; a hook ANDs its own axes onto the first and calls the second before
 * clearing its own.
 *
 * `trimmed` is what a request is built from: a search of three spaces is no search, and a query key
 * that differed by whitespace would be a second page of the same rows.
 */
export function useCatalogueFilters() {
    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const trimmed = query.trim();

    return {
        query,
        setQuery,
        trimmed,
        statuses,
        setStatuses,
        isUnfiltered: trimmed === '' && statuses.length === 0,
        clear: () => {
            setQuery('');
            setStatuses([]);
        },
    };
}

/**
 * A list's filter without its status — what the Lens bar's figures count over, so pressing Draft
 * narrows the list without turning Published into a zero. The rows the status keeps are then
 * picked out of that set by {@link inStatuses}, which is the same test the server applies.
 */
export function withoutStatuses<F extends { readonly statuses?: readonly PublishableStatus[] }>(
    filter: F,
): Omit<F, 'statuses'> {
    const { statuses: _statuses, ...scope } = filter;
    return scope;
}

export function inStatuses<Row extends { readonly meta: { readonly status: PublishableStatus } }>(
    rows: readonly Row[],
    statuses: readonly PublishableStatus[],
): readonly Row[] {
    return statuses.length === 0 ? rows : rows.filter((row) => statuses.includes(row.meta.status));
}

/** How many of `rows` are in each status. */
export function statusTally(
    rows: readonly { readonly meta: { readonly status: PublishableStatus } }[],
): Readonly<Record<PublishableStatus, number>> {
    const tally: Record<PublishableStatus, number> = {
        draft: 0,
        review_required: 0,
        published: 0,
        retired: 0,
    };
    for (const row of rows) tally[row.meta.status] += 1;
    return tally;
}
