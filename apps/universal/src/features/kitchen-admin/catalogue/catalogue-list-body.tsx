import type { ApiFailure } from '@healthy360/api-client/contracts';
import {
    Button,
    EmptyState,
    ErrorState,
    Inline,
    Stack,
    TableSkeleton,
} from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CataloguePager } from './catalogue-pager.tsx';

/** The part of a list hook's state the body reads. Every catalogue list hook already carries it. */
export interface CatalogueListBodyState {
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly failure: ApiFailure | null;
    readonly refetch: () => void;
    readonly rows: readonly unknown[];
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;
    readonly shown: number;
    /** The server's count for the filtered set, or `null` before the first answer. */
    readonly total: number | null;
    readonly page: number;
    readonly totalPages: number;
    readonly setPage: (page: number) => void;
}

interface EmptyCopy {
    readonly title: string;
    readonly body: string;
}

export interface CatalogueListBodyProps {
    /**
     * The list's id. `-loading`, `-skeleton-{1..5}`, `-error`, `-empty`, `-clear`, `-empty-create`
     * and `-pagination` hang off it; the table keeps the id its screen gives it.
     */
    readonly testID: string;
    readonly list: CatalogueListBodyState;
    /** A list with nothing in it at all. */
    readonly empty: EmptyCopy;
    /** A filter that matched nothing. */
    readonly filteredEmpty: EmptyCopy;
    /** The empty state's create action. Absent where the reader cannot create, or the list has none. */
    readonly create?: { readonly label: string; readonly onPress: () => void } | undefined;
    /** The table, and anything drawn between it and the pager. */
    readonly children: ReactNode;
}

/**
 * Everything a catalogue list draws under its toolbar: loading, failure, empty, then the table and
 * the pager. Five screens wrote this branch identically; each still owns its gate, stat cards,
 * toolbar, table, drawer and dialog, and so every id those emit.
 *
 * Clear filters is offered only when a filter is on. On an unfiltered list it cleared nothing.
 */
export function CatalogueListBody({
    testID,
    list,
    empty,
    filteredEmpty,
    create,
    children,
}: CatalogueListBodyProps) {
    const { t } = useTranslation();

    if (list.isPending) {
        // The table's own panel, header rule and rows, so the list lands without moving.
        return <TableSkeleton testID={`${testID}-loading`} partTestID={testID} />;
    }

    if (list.failure !== null) {
        return (
            <ErrorState
                testID={`${testID}-error`}
                failure={list.failure}
                onRetry={list.refetch}
                retrying={list.isFetching}
            />
        );
    }

    if (list.rows.length === 0) {
        const copy = list.isUnfiltered ? empty : filteredEmpty;

        return (
            <EmptyState
                testID={`${testID}-empty`}
                title={copy.title}
                body={copy.body}
                actions={
                    list.isUnfiltered && create === undefined ? undefined : (
                        <Inline space="sm" wrap>
                            {list.isUnfiltered ? null : (
                                <Button
                                    testID={`${testID}-clear`}
                                    variant="secondary"
                                    label={t('kitchen:toolbar.clearFilters')}
                                    onPress={list.clearFilters}
                                />
                            )}
                            {create === undefined ? null : (
                                <Button
                                    testID={`${testID}-empty-create`}
                                    label={create.label}
                                    onPress={create.onPress}
                                />
                            )}
                        </Inline>
                    )
                }
            />
        );
    }

    return (
        <Stack space="sm">
            {children}
            <CataloguePager
                testID={`${testID}-pagination`}
                range={t('kitchen:toolbar.showing', {
                    shown: shownThrough(list),
                    total: list.total ?? list.shown,
                })}
                page={list.page}
                totalPages={list.totalPages}
                onPageChange={list.setPage}
                label={t('kitchen:catalogue.pagerLabel')}
            />
        </Stack>
    );
}

/**
 * How many records the reader has walked past, counting this page — 18 on page one, 36 on page
 * two, and the collection's own total on the last page.
 *
 * The line used to read `Showing 18 of 306` on every page of the catalogue, which is true of the
 * page and says nothing about the walk: page two said 18 as well, so the one control that could
 * have answered "how far in am I" answered "eighteen" seventeen times in a row.
 *
 * Derived from the page numbers rather than from a page-size constant, because the body serves
 * lists that page on the server and lists that page in memory, and they do not share one. Every
 * page before the last is full by definition, so `page × shown` is exact up to the last one —
 * where the arithmetic would over-count the short page and the collection's own total is the
 * answer instead.
 *
 * Clamped, because "full by definition" has one exception: a list whose repository drops rows from
 * the page after the server counted them — the ingredient read does this for a multi-status
 * filter the endpoint cannot express — has a short page in the middle of the walk. The count is
 * then a little low rather than past the end, which is the better of the two ways to be wrong.
 */
function shownThrough(list: CatalogueListBodyState): number {
    if (list.total === null) return list.shown;
    if (list.page >= list.totalPages) return list.total;
    return Math.min(list.page * list.shown, list.total);
}
