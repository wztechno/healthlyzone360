import type { PublishableStatus } from '@healthy360/api-client/contracts';
import type { TFunction } from 'i18next';
import { useState } from 'react';

import { statusShortKey } from '../format.ts';
import type { CatalogueStatusSegment } from './catalogue-toolbar.tsx';

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

/** A toolbar segment is a status, or the absence of one. */
export type StatusSegmentValue = PublishableStatus | 'all';

/**
 * All · Live · Draft · Review.
 *
 * Four, not five. Archived — `retired`, which for a meal means withdrawn — is reachable from the
 * Status column's own filter, and putting it on the toolbar would spend a fifth of a primary control
 * on the one state a catalogue is almost never browsed in. It is still a first-class filter, just
 * not a first-class segment.
 */
const SEGMENT_STATUSES: readonly PublishableStatus[] = ['published', 'draft', 'review_required'];

/**
 * The toolbar's status segments over a list's status set.
 *
 * Single-select, so "all" is the absence of a status rather than a status of its own. A status the
 * segments do not name — Archived, set from the column — leaves them on "all" rather than lighting
 * a segment that is not on the row.
 *
 * `labelKey` is the one thing a list varies: packaging reads its states as Active and Inactive.
 * Not a hook — nothing here holds state — which is why it is not called one.
 */
export function statusSegments(
    statuses: readonly PublishableStatus[],
    setStatuses: (next: readonly PublishableStatus[]) => void,
    t: TFunction,
    labelKey: (status: PublishableStatus) => string = statusShortKey,
): {
    readonly segments: readonly CatalogueStatusSegment<StatusSegmentValue>[];
    readonly value: StatusSegmentValue;
    readonly onChange: (value: StatusSegmentValue) => void;
} {
    const active = statuses[0];

    return {
        segments: [
            { value: 'all', label: t('kitchen:toolbar.statusAll') },
            ...SEGMENT_STATUSES.map((status) => ({ value: status, label: t(labelKey(status)) })),
        ],
        value: active !== undefined && SEGMENT_STATUSES.includes(active) ? active : 'all',
        onChange: (value) => {
            setStatuses(value === 'all' ? [] : [value]);
        },
    };
}
