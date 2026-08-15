import { Card, EmptyState, ErrorState, Skeleton, Stack } from '@healthy360/design-system';
import type { ApiFailureCode } from '@healthy360/api-client';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { toFailure } from '../../data/hooks.ts';

/**
 * The four states every data-driven screen has to render, in one place.
 *
 * The prompt requires loading, success, empty and error on every screen that reads data, and the
 * reliable way to satisfy a requirement like that is to make the *absence* of a state impossible
 * rather than to remember it eleven times. So this renders exactly one branch and there is no way
 * to call it without having supplied all four.
 *
 * Two decisions worth stating:
 *
 * * **Skeletons, not spinners, for a list.** A spinner says "something is happening"; a skeleton
 *   says "roughly this much content is arriving here", which stops the page reflowing under the
 *   reader's eyes when it lands.
 * * **Error before empty.** A failed request has no items, so checking emptiness first would report
 *   "no kitchens match" for what is actually a network failure — the most misleading message the
 *   screen could show. Callers may opt specific codes into the empty branch via
 *   `treatFailuresAsEmpty` when the failure *means* "this surface is not live yet" rather than
 *   "something broke".
 */
export interface QueryStatesProps {
    readonly query: Pick<
        UseQueryResult<unknown>,
        'isPending' | 'isFetching' | 'error' | 'refetch' | 'data'
    >;
    /** Evaluated only once data has arrived (or a soft-failed code was treated as empty). */
    readonly isEmpty: boolean;
    readonly emptyTitle: string;
    readonly emptyBody?: string | undefined;
    /** Rendered under the empty state — "clear the filters", "browse everything". */
    readonly emptyActions?: ReactNode | undefined;
    /**
     * Failure codes that should render as empty rather than as an error. Used for deferred product
     * surfaces that still answer `prototype.not_implemented` on the API client.
     */
    readonly treatFailuresAsEmpty?: readonly ApiFailureCode[] | undefined;
    readonly skeletonCount?: number | undefined;
    readonly testID: string;
    readonly children: ReactNode;
}

export function QueryStates({
    query,
    isEmpty,
    emptyTitle,
    emptyBody,
    emptyActions,
    treatFailuresAsEmpty,
    skeletonCount = 3,
    testID,
    children,
}: QueryStatesProps) {
    if (query.isPending) {
        return (
            <Stack space="sm" testID={`${testID}-loading`}>
                {Array.from({ length: skeletonCount }, (_, index) => (
                    <Card key={index} padding="md">
                        <Stack space="sm">
                            <Skeleton
                                testID={`${testID}-skeleton-${String(index + 1)}`}
                                heightClassName="h-24"
                                variant="shimmer"
                            />
                            <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                        </Stack>
                    </Card>
                ))}
            </Stack>
        );
    }

    const failure = toFailure(query.error);
    const softEmpty =
        failure !== null &&
        treatFailuresAsEmpty !== undefined &&
        (treatFailuresAsEmpty as readonly string[]).includes(failure.code);

    if (failure !== null && !softEmpty) {
        return (
            <ErrorState
                testID={`${testID}-error`}
                failure={failure}
                onRetry={() => {
                    void query.refetch();
                }}
                retrying={query.isFetching}
            />
        );
    }

    if (isEmpty || softEmpty) {
        return (
            <EmptyState
                testID={`${testID}-empty`}
                title={emptyTitle}
                {...(emptyBody === undefined ? {} : { body: emptyBody })}
                {...(emptyActions === undefined ? {} : { actions: emptyActions })}
            />
        );
    }

    return <>{children}</>;
}
