import type { AllergenClass, ApiFailure } from '@healthy360/api-client/contracts';
import { useLocale } from '@healthy360/i18n';
import { useMemo, useState } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import { useAllergenClassesQuery } from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';

/**
 * The allergen list's state — the Catalogue's list-state shape, over a collection that is not paged.
 *
 * ## Filtering here is honest, and on the other lists it would not be
 *
 * Every other Catalogue list refuses to narrow rows in the client. `filterItemsFor` says why: those
 * lists hold one page of a few hundred rows, so a client-side filter would narrow the 18 loaded and
 * report a count that is wrong for every page after it. That is why the Unit column still has no
 * filter — `IngredientAdminFilter` carries no `measurementUnit`, and the alternative lies.
 *
 * This collection is different in the one way that matters: `listAllergenClasses()` takes no filter
 * and returns **all fourteen**, always. There is no second page for a client-side narrowing to be
 * wrong about, so search, sort and the status filter run here — and `shown of total` is a true
 * statement rather than a page-local one.
 *
 * If the platform ever pages this resource, the filters move to the request and this note is the
 * reason they have to.
 */

export type AllergenSortKey = 'code' | 'name' | 'regulation' | 'threshold' | 'status';
export type AllergenSortDirection = 'asc' | 'desc';

/** `all` is every class; the other two are the `isActive` split. */
export type AllergenStatusFilter = 'all' | 'active' | 'withdrawn';

export interface AllergenListState {
    readonly rows: readonly AllergenClass[];
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly failure: ApiFailure | null;
    readonly refetch: () => void;

    readonly query: string;
    readonly setQuery: (query: string) => void;
    readonly status: AllergenStatusFilter;
    readonly setStatus: (status: AllergenStatusFilter) => void;
    /** True when nothing is narrowing the list — what the Shown card's caption reads from. */
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;

    readonly sortKey: AllergenSortKey;
    readonly sortDirection: AllergenSortDirection;
    readonly setSort: (key: AllergenSortKey, direction: AllergenSortDirection) => void;

    /** Every class, before any narrowing — what the stat figures count. */
    readonly total: number;
    readonly shown: number;
    readonly severeCount: number;
    readonly withdrawnCount: number;
    readonly thresholdCount: number;

    readonly viewing: AllergenClass | null;
    readonly openView: (entry: AllergenClass) => void;
    readonly closeView: () => void;
}

export function useAllergenList(): AllergenListState {
    const { locale } = useLocale();
    const classes = useAllergenClassesQuery();

    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<AllergenStatusFilter>('all');
    // Code ascending, the call every Catalogue list now makes about its identifier column: it is
    // the one order that does not change with the reader's language.
    const [sortKey, setSortKey] = useState<AllergenSortKey>('code');
    const [sortDirection, setSortDirection] = useState<AllergenSortDirection>('asc');
    const [viewing, setViewing] = useState<AllergenClass | null>(null);

    const all = useMemo(() => classes.data ?? [], [classes.data]);

    const rows = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();

        const narrowed = all.filter((entry) => {
            if (status === 'active' && !entry.isActive) return false;
            if (status === 'withdrawn' && entry.isActive) return false;
            if (needle === '') return true;
            // The code and the regulation are searched alongside the name, because those are what a
            // reader has in front of them: a label cites `EU 1169/2011`, and an ingredient's own
            // mapping names the code, not the translated class.
            return (
                String(entry.code).toLocaleLowerCase().includes(needle) ||
                entry.regulatoryReference.toLocaleLowerCase().includes(needle) ||
                displayName(entry.name, locale).value.toLocaleLowerCase().includes(needle)
            );
        });

        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...narrowed].sort((left, right) => {
            if (sortKey === 'name') {
                return (
                    factor *
                    displayName(left.name, locale).value.localeCompare(
                        displayName(right.name, locale).value,
                    )
                );
            }
            if (sortKey === 'regulation') {
                return factor * left.regulatoryReference.localeCompare(right.regulatoryReference);
            }
            if (sortKey === 'threshold') {
                // `null` is "any detectable amount", which is the *strictest* threshold there is —
                // so it sorts below every stated figure rather than above them as a 0 would, and
                // well below where a `?? Infinity` would have put it.
                const value = (entry: AllergenClass): number =>
                    entry.declarationThreshold?.value ?? -1;
                return factor * (value(left) - value(right));
            }
            if (sortKey === 'status') {
                return factor * (Number(left.isActive) - Number(right.isActive));
            }
            return factor * String(left.code).localeCompare(String(right.code));
        });
    }, [all, query, status, sortKey, sortDirection, locale]);

    return {
        rows,
        isPending: classes.isPending,
        isFetching: classes.isFetching,
        failure: toFailure(classes.error),
        refetch: () => {
            void classes.refetch();
        },

        query,
        setQuery,
        status,
        setStatus,
        isUnfiltered: query.trim() === '' && status === 'all',
        clearFilters: () => {
            setQuery('');
            setStatus('all');
        },

        sortKey,
        sortDirection,
        setSort: (key, direction) => {
            setSortKey(key);
            setSortDirection(direction);
        },

        total: all.length,
        shown: rows.length,
        severeCount: all.filter((entry) => entry.severeByDefault).length,
        withdrawnCount: all.filter((entry) => !entry.isActive).length,
        thresholdCount: all.filter((entry) => entry.declarationThreshold !== null).length,

        viewing,
        openView: setViewing,
        closeView: () => {
            setViewing(null);
        },
    };
}
