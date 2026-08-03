import type {
    CancelSubscriptionRequest,
    Cart,
    CartItem,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CreateSubscriptionRequest,
    CursorPage,
    PauseSubscriptionRequest,
    PlaceOrderRequest,
    PlacedOrder,
    PreviewCheckoutRequest,
    SetSubscriptionMealChoicesRequest,
    SetSubscriptionWeekdaysRequest,
    SkipDayRequest,
    Subscription,
    SubscriptionBalance,
    SubscriptionCancellation,
    SubscriptionConfiguration,
    SubscriptionDelivery,
    SubscriptionDeliveryFilter,
    SubscriptionFilter,
    SubscriptionMealChoice,
    SubscriptionPreview,
    SubscriptionQuote,
    SubscriptionQuoteRequest,
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

/**
 * Place the one-off order.
 *
 * The only **command** in this module, and the only one that had to be written carefully.
 *
 * `retry: 0`, explicitly and non-negotiably. TanStack Query's default retries a failed mutation
 * zero times already, but this is the one call in the application where a future default change
 * would be a second dinner rather than a second request — so it is stated rather than inherited.
 * The idempotency key that would make a retry safe is generated *inside* the repository, per
 * attempt, which means a retry here would carry a new key and place a new order.
 *
 * On success the basket is gone — the server turned it into the order — so the cart entry is
 * invalidated rather than optimistically emptied: what a basket contains after a placement is the
 * server's answer, and a client that emptied its own copy would be right until it was not.
 *
 * ## No screen calls this yet, and that is the honest state
 *
 * `POST /orders` requires a **saved address identifier**, because delivery is resolved from that
 * address's service area — a zone, a window, a fee. The checkout screen predates saved addresses:
 * it collects a typed address that nothing resolves to an area, and the D2C fixture person
 * deliberately has no saved address at all, because "add an address" is one of the setup steps that
 * screen area exists to walk somebody through. Wiring the button to this hook today would replace a
 * working prototype checkout with a blocked one, which is the one thing this phase forbids.
 *
 * So the plumbing lands whole — contract, both repositories, this hook, all tested — and the screen
 * change waits for the slice that gives the checkout a saved-address picker. That slice is a design
 * change, not an integration one.
 */
export function usePlaceOrderMutation(): UseMutationResult<
    PlacedOrder,
    unknown,
    PlaceOrderRequest
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: 0,
        mutationFn: (request: PlaceOrderRequest) => repositories.commerce.placeOrder(request),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.commerce.cart() });
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

/**
 * Availability and price for a proposed plan.
 *
 * **This replaced the seven-probe hack**, and the hack is worth recording because its removal is the
 * point. `useAllowedDeliveryWeekdaysQuery` used to price the same subscription seven times — once
 * per weekday — and read which answers carried a `subscription.delivery_day_unavailable` warning.
 * That was honest: it used only what the contract published, and the contract published no
 * `deliveryWeekdays` on a plan. It was also seven round trips for a fact that had been sitting on
 * the plan record all along. `CommerceRepository.getSubscriptionQuote` publishes it, so this is one
 * request, and it carries the price and the cut-off with it.
 *
 * Keyed by the plan, the variant and the duration — not by the whole configuration — because the
 * answer depends on nothing else. Changing a start date or an address must not re-price anything.
 */
export function useSubscriptionQuoteQuery(
    request: SubscriptionQuoteRequest | null,
): UseQueryResult<SubscriptionQuote> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscriptionQuote(request ?? {}),
        enabled: repositories !== null && request !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (request === null) throw new Error('No plan to quote.');
            return repositories.commerce.getSubscriptionQuote(request);
        },
    });
}

/**
 * The weekdays a plan delivers on.
 *
 * A projection of {@link useSubscriptionQuoteQuery} rather than a request of its own, so the
 * configurator's weekday picker and its price summary share one cache entry and one round trip. The
 * name is kept from the hack it replaced: every call site meant "which days may I choose", and that
 * question did not change when the answer stopped costing seven requests.
 */
export function useAllowedDeliveryWeekdaysQuery(
    configuration: SubscriptionConfiguration | null,
): UseQueryResult<readonly number[]> {
    const { repositories } = useRepositoryContext();
    const request: SubscriptionQuoteRequest | null =
        configuration === null
            ? null
            : {
                  planId: configuration.planId,
                  variantId: configuration.variantId,
                  duration: configuration.duration,
              };

    return useQuery({
        queryKey: queryKeys.commerce.subscriptionQuote(request ?? {}),
        enabled: repositories !== null && request !== null,
        queryFn: async (): Promise<readonly number[]> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (request === null) throw new Error('No plan to quote.');
            const quote = await repositories.commerce.getSubscriptionQuote(request);
            return quote.availableWeekdays;
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

/* ── S1: the balance, the ledger, cancellation and the two editors ───────────────────────────── */

export function useSubscriptionBalanceQuery(
    subscriptionId: SubscriptionId | null,
): UseQueryResult<SubscriptionBalance> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscriptionBalance(subscriptionId ?? ('' as SubscriptionId)),
        enabled: repositories !== null && subscriptionId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (subscriptionId === null) throw new Error('No subscription identifier.');
            return repositories.commerce.getSubscriptionBalance(subscriptionId);
        },
    });
}

/** The ledger. Its own entry, because a balance card and a delivery list refetch on different writes. */
export function useSubscriptionDeliveriesQuery(
    subscriptionId: SubscriptionId | null,
    filter?: SubscriptionDeliveryFilter,
): UseQueryResult<CursorPage<SubscriptionDelivery>> {
    const { repositories } = useRepositoryContext();

    return useQuery({
        queryKey: queryKeys.commerce.subscriptionDeliveries(
            subscriptionId ?? ('' as SubscriptionId),
            filter,
        ),
        enabled: repositories !== null && subscriptionId !== null,
        queryFn: () => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            if (subscriptionId === null) throw new Error('No subscription identifier.');
            return repositories.commerce.listSubscriptionDeliveries(subscriptionId, filter);
        },
    });
}

export interface CancelSubscriptionVariables {
    readonly subscriptionId: SubscriptionId;
    readonly request?: CancelSubscriptionRequest | undefined;
}

/**
 * Cancel, and keep the memo.
 *
 * Not built on {@link useSubscriptionMutation}: cancellation answers with two things, and the memo
 * is the half a person actually cares about. `retry: 0` for the same reason `usePlaceOrderMutation`
 * has it — a retried cancellation would mint a second credit memo against a subscription that is
 * already terminal.
 */
export function useCancelSubscriptionMutation(): UseMutationResult<
    SubscriptionCancellation,
    unknown,
    CancelSubscriptionVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        retry: 0,
        mutationFn: ({ subscriptionId, request }: CancelSubscriptionVariables) =>
            request === undefined
                ? repositories.commerce.cancelSubscription(subscriptionId)
                : repositories.commerce.cancelSubscription(subscriptionId, request),
        onSuccess: async (result) => {
            queryClient.setQueryData(
                queryKeys.commerce.subscription(result.subscription.id),
                result.subscription,
            );
            await queryClient.invalidateQueries({ queryKey: queryKeys.commerce.all() });
            // A cancellation can mint a credit memo, and an unsettled memo is an *advisory* closure
            // blocker. The closure wizard must not be able to show a stale "nothing to mention".
            await queryClient.invalidateQueries({ queryKey: queryKeys.account.all() });
        },
    });
}

export interface SetWeekdaysVariables {
    readonly subscriptionId: SubscriptionId;
    readonly request: SetSubscriptionWeekdaysRequest;
}

export function useSetSubscriptionWeekdaysMutation(): UseMutationResult<
    Subscription,
    unknown,
    SetWeekdaysVariables
> {
    return useSubscriptionMutation<SetWeekdaysVariables>(
        (repositories, { subscriptionId, request }) =>
            repositories.commerce.setSubscriptionWeekdays(subscriptionId, request),
    );
}

export interface SetMealChoicesVariables {
    readonly subscriptionId: SubscriptionId;
    readonly request: SetSubscriptionMealChoicesRequest;
}

export function useSetSubscriptionMealChoicesMutation(): UseMutationResult<
    readonly SubscriptionMealChoice[],
    unknown,
    SetMealChoicesVariables
> {
    const repositories = useRepositories();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ subscriptionId, request }: SetMealChoicesVariables) =>
            repositories.commerce.setSubscriptionMealChoices(subscriptionId, request),
        onSuccess: async (choices, { subscriptionId, request }) => {
            queryClient.setQueryData(
                queryKeys.commerce.subscriptionMealChoices(subscriptionId, request.date),
                choices,
            );
        },
    });
}
