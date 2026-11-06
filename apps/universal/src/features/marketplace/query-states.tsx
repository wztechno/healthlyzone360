import { Card, Skeleton, Stack } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ApiFailureCode } from '@healthy360/api-client';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import { ShopCardSkeletons, ShopErrorCard, ShopStateCard } from '../../ui/shop-state.tsx';

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
    /**
     * What arrives: `cards` (the default) is grey cards in the grid's columns, Shop · Menu pin 11;
     * `rows` is a stack of full-width rows, for a list drawn as rows (orders, deliveries).
     */
    /**
     * `lines` is a price summary's: a few label-and-amount lines and a total under a hairline, so a
     * basket's or checkout's summary waits in its own shape rather than a card's.
     */
    readonly skeleton?: 'cards' | 'rows' | 'lines' | undefined;
    /** The empty state's disc. Defaults to a search lens: "nothing here matched". */
    readonly emptyIcon?: IconName | undefined;
    /** The empty disc's tint: `warning` when the person can fix it by going back a step. */
    readonly emptyTone?: 'brand' | 'warning' | undefined;
    /** A state inside a panel: no card frame, a smaller disc. */
    readonly compact?: boolean | undefined;
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
    skeleton = 'cards',
    emptyIcon = 'searchLens',
    emptyTone = 'brand',
    compact = false,
    testID,
    children,
}: QueryStatesProps) {
    if (query.isPending && skeleton === 'cards') {
        return <ShopCardSkeletons count={skeletonCount} testID={`${testID}-loading`} />;
    }
    if (query.isPending && skeleton === 'lines') {
        return (
            <View testID={`${testID}-loading`} aria-busy className="flex-col gap-3.5 py-1">
                {[0, 1, 2].map((index) => (
                    <View
                        key={index}
                        testID={`${testID}-skeleton-${String(index + 1)}`}
                        className="flex-row items-center justify-between gap-4"
                    >
                        <Skeleton
                            heightClassName="h-3.5"
                            widthClassName={index === 1 ? 'w-2/5' : 'w-1/3'}
                            variant="shimmer"
                        />
                        <Skeleton heightClassName="h-3.5" widthClassName="w-14" variant="shimmer" />
                    </View>
                ))}
                <View className="flex-row items-center justify-between gap-4 border-t border-stroke-subtle pt-3.5">
                    <Skeleton heightClassName="h-4" widthClassName="w-1/4" variant="shimmer" />
                    <Skeleton heightClassName="h-6" widthClassName="w-20" variant="shimmer" />
                </View>
            </View>
        );
    }
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
            <ShopErrorCard
                testID={`${testID}-error`}
                failure={failure}
                small={compact}
                onRetry={() => {
                    void query.refetch();
                }}
                retrying={query.isFetching}
            />
        );
    }

    if (isEmpty || softEmpty) {
        return (
            <ShopStateCard
                testID={`${testID}-empty`}
                icon={emptyIcon}
                tone={emptyTone}
                small={compact}
                title={emptyTitle}
                body={emptyBody}
                actions={emptyActions}
            />
        );
    }

    return <>{children}</>;
}
