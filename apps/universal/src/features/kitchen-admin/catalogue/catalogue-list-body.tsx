import type { ApiFailure } from '@healthy360/api-client/contracts';
import { Button, EmptyState, ErrorState, Inline, Skeleton, Stack } from '@healthy360/design-system';
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
        return (
            <Stack space="xs" testID={`${testID}-loading`}>
                {Array.from({ length: 5 }, (_, index) => (
                    <Skeleton
                        key={index}
                        testID={`${testID}-skeleton-${String(index + 1)}`}
                        heightClassName="h-row-sm"
                    />
                ))}
            </Stack>
        );
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
                    shown: list.shown,
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
