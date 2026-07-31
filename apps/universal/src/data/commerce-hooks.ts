import type {
    Cart,
    CartItem,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CreateSubscriptionRequest,
    CursorPage,
    PauseSubscriptionRequest,
    PreviewCheckoutRequest,
    SkipDayRequest,
    Subscription,
    SubscriptionConfiguration,
    SubscriptionFilter,
    SubscriptionPreview,
} from '@healthy360/api-client/contracts';
import type { CartId, SubscriptionId } from '@healthy360/domain-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from './query-keys.ts';
import { useRepositories, useRepositoryContext } from './repository-provider.tsx';

/**
 * Cart, checkout preview and subscriptions.
 *
 * Same rules as every other hook module here: one hook per repository operation, the `enabled`
 * guards and the invalidation written once, and no screen ever holding a repository. Four things
 * are specific to commerce and worth stating.
 *
 * ## Previews are queries
 *
 * `previewCheckout` and `previewSubscription` are POSTs on the wire and **queries** here. They
 * reserve nothing and charge nothing (`contracts/commerce.ts` says so in its own header), so the
 * same proposal always has the same answer and caching it by its inputs is correct rather than
 * merely convenient. It also means a person stepping back from the summary to change one weekday
 * and returning does not re-price the other seven decisions.
 *
 * ## Nothing here is persisted
 *
 * `PERSISTABLE_QUERY_ROOTS` in `./query-keys.ts` admits `catalogue` only. A basket and a
 * subscription are personal and mutable; restoring last week's snapshot of either from disk would
 * show somebody a total that no longer exists.
 *
 * ## Quantity is a contract gap, worked around honestly
 *
 * `CommerceRepository` has `addCartItem` (which *adds* to a line) and `removeCartItem` (which drops
 * the whole line), and nothing that sets a quantity. {@link useSetCartItemQuantityMutation} composes
 * the two into the operation the interface actually needs. It is a real mutation with a real result,
 * not a prototype notice — but it is two round trips where one `PATCH /api/v1/carts/{cart}/items/{item}`
 * would do, and that is recorded rather than hidden.
 *
 * ## The plan's delivery weekdays are a contract gap, probed rather than assumed
 *
 * A plan restricts which weekdays it delivers on — the office plan does not deliver at weekends —
 * and `SubscriptionPlan` publishes no field saying so. What it does publish is a preview that warns
 * `subscription.delivery_day_unavailable`. {@link useAllowedDeliveryWeekdaysQuery} therefore asks
 * the question seven times, once per weekday, and reads the answers. That is honest and uses only
 * the contract; it is also seven round trips for a fact that belongs on the plan, and a real backend
 * should publish `SubscriptionPlan.deliveryWeekdays` so this hook can be deleted.
 */

export { toFailure } from './hooks.ts';

/* ── cart ────────────────────────────────────────────────────────────────────────────────────── */

/** The current basket. `getCart()` creates one lazily, so there is no "create basket" step. */
export function useCartQuery(enabled = true): UseQueryResult<Cart> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.cart(),
        enabled: enabled && repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.commerce.getCart();
        },
    });
}

export interface CartItemVariables {
    readonly cartId: CartId;
    readonly itemId: string;
}

export function useRemoveCartItemMutation(): UseMutationResult<Cart, unknown, CartItemVariables> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ cartId, itemId }: CartItemVariables) =>
            repositories.commerce.removeCartItem(cartId, itemId),
        onSuccess: async (cart) => {
            queryClient.setQueryData(queryKeys.commerce.cart(), cart);
            // The checkout preview is priced from the basket, so it is now wrong as well.
            await queryClient.invalidateQueries({ queryKey: queryKeys.commerce.all() });
        },
    });
}

export interface SetQuantityVariables {
    readonly cartId: CartId;
    readonly item: CartItem;
    readonly quantity: number;
}

/**
 * Sets a line to an exact quantity.
 *
 * Increasing adds the difference — one request, and the repository's own accumulation does the
 * arithmetic. Decreasing removes the line and re-adds it at the target, because `addCartItem` can
 * only ever raise a quantity. Both paths genuinely change the basket; neither pretends to.
 */
export function useSetCartItemQuantityMutation(): UseMutationResult<
    Cart,
    unknown,
    SetQuantityVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ cartId, item, quantity }: SetQuantityVariables): Promise<Cart> => {
            if (quantity === item.quantity) return repositories.commerce.getCart();
            if (quantity <= 0) return repositories.commerce.removeCartItem(cartId, item.id);

            const deliveryDate =
                item.deliveryDate === null ? {} : { deliveryDate: item.deliveryDate };

            if (quantity > item.quantity) {
                return repositories.commerce.addCartItem(cartId, {
                    mealId: item.mealId,
                    quantity: quantity - item.quantity,
                    ...deliveryDate,
                });
            }

            await repositories.commerce.removeCartItem(cartId, item.id);
            return repositories.commerce.addCartItem(cartId, {
                mealId: item.mealId,
                quantity,
                ...deliveryDate,
            });
        },
        onSuccess: async (cart) => {
            queryClient.setQueryData(queryKeys.commerce.cart(), cart);
            await queryClient.invalidateQueries({ queryKey: queryKeys.commerce.all() });
        },
    });
}

/* ── checkout preview ────────────────────────────────────────────────────────────────────────── */

/** A priced quotation for the current basket. `null` disables it — there is nothing to price yet. */
export function useCheckoutPreviewQuery(
    request: PreviewCheckoutRequest | null,
): UseQueryResult<CheckoutPreview> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.checkoutPreview(request ?? {}),
        enabled: repositories !== null && request !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (request === null) throw new Error('No checkout to preview.');
            return repositories.commerce.previewCheckout(request);
        },
    });
}

/* ── subscription preview and creation ───────────────────────────────────────────────────────── */

export function useSubscriptionPreviewQuery(
    configuration: SubscriptionConfiguration | null,
): UseQueryResult<SubscriptionPreview> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscriptionPreview(configuration ?? {}),
        enabled: repositories !== null && configuration !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (configuration === null) throw new Error('No configuration to preview.');
            return repositories.commerce.previewSubscription(configuration);
        },
    });
}

/** ISO weekdays, Monday first — the set the probe below asks about. */
const PROBE_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

const UNAVAILABLE_WARNING = 'subscription.delivery_day_unavailable';

/**
 * The weekdays a plan will actually deliver on, discovered by asking.
 *
 * One preview per weekday, in parallel, keyed by the plan and variant rather than by the whole
 * configuration — the answer depends on the plan alone, so changing a start date or an address must
 * not re-run seven requests.
 */
export function useAllowedDeliveryWeekdaysQuery(
    configuration: SubscriptionConfiguration | null,
): UseQueryResult<readonly number[]> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscriptionPreview({
            probe: 'delivery-weekdays',
            planId: configuration?.planId ?? null,
            variantId: configuration?.variantId ?? null,
        }),
        enabled: repositories !== null && configuration !== null,
        queryFn: async (): Promise<readonly number[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (configuration === null) throw new Error('No configuration to probe.');

            const answers = await Promise.all(
                PROBE_WEEKDAYS.map(async (weekday) => {
                    const preview = await repositories.commerce.previewSubscription({
                        ...configuration,
                        deliveryWeekdays: [weekday],
                    });
                    return preview.warnings.includes(UNAVAILABLE_WARNING) ? null : weekday;
                }),
            );
            return answers.filter((weekday): weekday is number => weekday !== null);
        },
    });
}

export function useCreateSubscriptionMutation(): UseMutationResult<
    Subscription,
    unknown,
    CreateSubscriptionRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (request: CreateSubscriptionRequest) =>
            repositories.commerce.createSubscription(request),
        onSuccess: async (subscription) => {
            queryClient.setQueryData(
                queryKeys.commerce.subscription(subscription.id),
                subscription,
            );
            await queryClient.invalidateQueries({ queryKey: queryKeys.commerce.all() });
        },
    });
}

/* ── subscriptions ───────────────────────────────────────────────────────────────────────────── */

export function useSubscriptionsQuery(
    filter?: SubscriptionFilter,
): UseQueryResult<CursorPage<Subscription>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscriptions(filter),
        enabled: repositories !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            return repositories.commerce.listSubscriptions(filter);
        },
    });
}

/** One subscription. Nullable identifier for the same routing race every detail screen has. */
export function useSubscriptionQuery(
    subscriptionId: SubscriptionId | null,
): UseQueryResult<Subscription> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscription(subscriptionId ?? ('' as SubscriptionId)),
        enabled: repositories !== null && subscriptionId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (subscriptionId === null) throw new Error('No subscription identifier.');
            return repositories.commerce.getSubscription(subscriptionId);
        },
    });
}

/* ── transitions ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The five management transitions.
 *
 * Every one of them genuinely mutates the world and every one of them is **guarded**: resuming a
 * subscription that was never paused, or pausing a cancelled one, is rejected by the repository
 * with a sentence a person can read. The screens render those rejections rather than swallowing
 * them — a prototype where every control works from every state teaches the wrong thing about the
 * product (`mock/prototype/store.ts` makes the same argument from the other side).
 *
 * Each mutation invalidates the whole `commerce` root rather than one key. A transition changes the
 * subscription, its position in the list, and the next delivery date the list renders, and three
 * separate invalidations is three chances to forget one.
 */
function useSubscriptionMutation<TVariables>(
    run: (
        repositories: ReturnType<typeof useRepositories>,
        variables: TVariables,
    ) => Promise<Subscription>,
): UseMutationResult<Subscription, unknown, TVariables> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (variables: TVariables) => run(repositories, variables),
        onSuccess: async (subscription) => {
            queryClient.setQueryData(
                queryKeys.commerce.subscription(subscription.id),
                subscription,
            );
            await queryClient.invalidateQueries({ queryKey: queryKeys.commerce.all() });
        },
    });
}

export interface PauseVariables {
    readonly subscriptionId: SubscriptionId;
    readonly request?: PauseSubscriptionRequest | undefined;
}

export function usePauseSubscriptionMutation(): UseMutationResult<
    Subscription,
    unknown,
    PauseVariables
> {
    return useSubscriptionMutation<PauseVariables>((repositories, { subscriptionId, request }) =>
        request === undefined
            ? repositories.commerce.pause(subscriptionId)
            : repositories.commerce.pause(subscriptionId, request),
    );
}

export function useResumeSubscriptionMutation(): UseMutationResult<
    Subscription,
    unknown,
    SubscriptionId
> {
    return useSubscriptionMutation<SubscriptionId>((repositories, subscriptionId) =>
        repositories.commerce.resume(subscriptionId),
    );
}

export interface SkipDayVariables {
    readonly subscriptionId: SubscriptionId;
    readonly request: SkipDayRequest;
}

export function useSkipDayMutation(): UseMutationResult<Subscription, unknown, SkipDayVariables> {
    return useSubscriptionMutation<SkipDayVariables>((repositories, { subscriptionId, request }) =>
        repositories.commerce.skipDay(subscriptionId, request),
    );
}

export interface ChangeAddressVariables {
    readonly subscriptionId: SubscriptionId;
    readonly request: ChangeAddressRequest;
}

export function useChangeAddressMutation(): UseMutationResult<
    Subscription,
    unknown,
    ChangeAddressVariables
> {
    return useSubscriptionMutation<ChangeAddressVariables>(
        (repositories, { subscriptionId, request }) =>
            repositories.commerce.changeAddress(subscriptionId, request),
    );
}

export interface ChangeSlotVariables {
    readonly subscriptionId: SubscriptionId;
    readonly request: ChangeSlotRequest;
}

export function useChangeSlotMutation(): UseMutationResult<
    Subscription,
    unknown,
    ChangeSlotVariables
> {
    return useSubscriptionMutation<ChangeSlotVariables>(
        (repositories, { subscriptionId, request }) =>
            repositories.commerce.changeSlot(subscriptionId, request),
    );
}
