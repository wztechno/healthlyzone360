import type { IconName } from '@healthy360/design-system';
import type { ApiFailureCode } from '@healthy360/api-client';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import {
    ShopCardSkeletons,
    ShopFiguresSkeleton,
    ShopFormSkeleton,
    ShopKitchenSkeletons,
    ShopLinesSkeleton,
    ShopPageSkeleton,
    ShopPlanSkeletons,
    ShopRowSkeletons,
} from '../../ui/shop-skeletons.tsx';
import { ShopErrorCard, ShopStateCard } from '../../ui/shop-state.tsx';

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
     * The shape of what arrives, in the shop's one skeleton look (`ui/shop-skeletons.tsx`):
     * - `cards` (the default): dish cards in the grid's columns, Shop · Menu pin 11;
     * - `plans` / `kitchens`: plan or kitchen cards;
     * - `rows`: a card of list rows (orders, addresses, basket lines);
     * - `lines`: a price summary, label-and-amount lines over a total;
     * - `page`: a detail page's opening (meal, plan, kitchen, order, subscription);
     * - `form`: label-and-field pairs and a save button;
     * - `figures`: a row of figure tiles (a calculator's result).
     */
    readonly skeleton?:
        'cards' | 'plans' | 'kitchens' | 'rows' | 'lines' | 'page' | 'form' | 'figures' | undefined;
    /** The empty state's disc. Defaults to a search lens: "nothing here matched". */
    readonly emptyIcon?: IconName | undefined;
    /** The empty disc's tint: `warning` when the person can fix it by going back a step. */
    readonly emptyTone?: 'brand' | 'warning' | undefined;
    /** A state inside a panel: no card frame, a smaller disc. */
    readonly compact?: boolean | undefined;
    /** The list's own loading shape, where none of the stock skeletons draws what it loads. */
    readonly loading?: ReactNode | undefined;
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
    loading,
    testID,
    children,
}: QueryStatesProps) {
    if (query.isPending && loading !== undefined) {
        return (
            <View testID={`${testID}-loading`} aria-busy>
                {loading}
            </View>
        );
    }
    if (query.isPending) {
        const id = `${testID}-loading`;
        switch (skeleton) {
            case 'plans':
                return <ShopPlanSkeletons count={skeletonCount} testID={id} />;
            case 'kitchens':
                return <ShopKitchenSkeletons count={skeletonCount} testID={id} />;
            case 'rows':
                return <ShopRowSkeletons count={skeletonCount} testID={id} />;
            case 'lines':
                return <ShopLinesSkeleton testID={id} />;
            case 'page':
                return <ShopPageSkeleton testID={id} />;
            case 'form':
                return <ShopFormSkeleton testID={id} />;
            case 'figures':
                return <ShopFiguresSkeleton count={skeletonCount} testID={id} />;
            default:
                return <ShopCardSkeletons count={skeletonCount} testID={id} />;
        }
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
