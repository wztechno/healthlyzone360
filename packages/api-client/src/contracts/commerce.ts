import type {
    AllergenCode,
    CartId,
    DietClassification,
    IsoDateTime,
    KitchenId,
    MealId,
    Money,
    OrderId,
    PlanDuration,
    PlanVariantId,
    SubscriptionId,
    SubscriptionPlanId,
    SubscriptionState,
} from '@healthy360/domain-types';

import type { CursorPage, CursorPageRequest } from './pagination.ts';

/**
 * Cart, checkout preview and subscriptions (Prompt 2, "Marketplace meal-plan subscription").
 *
 * **Proposed, not implemented, and deliberately payment-free.** There is no method here that takes
 * a card, a token or a payment-provider reference, and there is no `confirmCheckout`. The prototype
 * previews a checkout and stops; a contract that *could* take a payment is a contract somebody will
 * eventually wire to a live gateway by accident.
 *
 * `previewCheckout` and `previewSubscription` are queries, not commands: they take a proposed
 * configuration and return what it would cost. Nothing is reserved and nothing is charged.
 */

export interface CartItem {
    readonly id: string;
    readonly mealId: MealId;
    readonly kitchenId: KitchenId;
    readonly name: string;
    readonly quantity: number;
    readonly unitPrice: Money;
    readonly lineTotal: Money;
    readonly allergens: readonly AllergenCode[];
    /** `YYYY-MM-DD`, when the person chose a delivery date for this line. */
    readonly deliveryDate: string | null;
}

export interface Cart {
    readonly id: CartId;
    readonly items: readonly CartItem[];
    readonly subtotal: Money;
    readonly itemCount: number;
    readonly updatedAt: IsoDateTime;
}

export interface AddCartItemRequest {
    readonly mealId: MealId;
    readonly quantity: number;
    readonly deliveryDate?: string | undefined;
}

export interface DeliveryAddress {
    readonly label: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly area: string;
    readonly city: string;
    readonly countryCode: string;
    readonly instructions: string | null;
}

export interface DeliverySlot {
    /** Stable slot code, e.g. `morning`. */
    readonly code: string;
    readonly label: string;
    /** `HH:mm`. */
    readonly startsAt: string;
    readonly endsAt: string;
}

export interface PriceLine {
    readonly code: string;
    readonly label: string;
    readonly amount: Money;
}

export interface CheckoutPreview {
    readonly cartId: CartId;
    readonly lines: readonly PriceLine[];
    readonly subtotal: Money;
    readonly deliveryFee: Money | null;
    readonly discount: Money | null;
    readonly total: Money;
    readonly earliestDeliveryDate: string | null;
    readonly warnings: readonly string[];
    /** Always `true` in the prototype: no payment method is ever attached. */
    readonly paymentDeferred: true;
}

export interface PreviewCheckoutRequest {
    readonly cartId: CartId;
    readonly address?: DeliveryAddress | undefined;
    readonly slotCode?: string | undefined;
    readonly deliveryDate?: string | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Subscriptions
 * ---------------------------------------------------------------------------------------------- */

export interface SubscriptionConfiguration {
    readonly planId: SubscriptionPlanId;
    readonly variantId: PlanVariantId;
    readonly duration: PlanDuration;
    /** `YYYY-MM-DD`. */
    readonly startDate: string;
    /** ISO weekdays, `1` Monday to `7` Sunday. */
    readonly deliveryWeekdays: readonly number[];
    readonly slotCode: string;
    readonly address: DeliveryAddress;
    readonly dietClassifications: readonly DietClassification[];
    readonly excludeAllergens: readonly AllergenCode[];
    /** Explicit meal choices, where the plan allows selection. */
    readonly selectedMealIds: readonly MealId[];
}

export interface SubscriptionPreview {
    readonly configuration: SubscriptionConfiguration;
    readonly lines: readonly PriceLine[];
    readonly weeklyPrice: Money;
    readonly discountPercent: number;
    readonly total: Money;
    readonly firstDeliveryDate: string;
    readonly lastDeliveryDate: string;
    readonly deliveryCount: number;
    readonly warnings: readonly string[];
    readonly paymentDeferred: true;
}

export interface Subscription {
    readonly id: SubscriptionId;
    readonly state: SubscriptionState;
    readonly configuration: SubscriptionConfiguration;
    readonly planName: string;
    readonly kitchenId: KitchenId;
    readonly weeklyPrice: Money;
    readonly nextDeliveryDate: string | null;
    /** `YYYY-MM-DD` dates the person has skipped. */
    readonly skippedDates: readonly string[];
    readonly pausedUntil: string | null;
    readonly createdAt: IsoDateTime;
    readonly updatedAt: IsoDateTime;
}

export interface CreateSubscriptionRequest {
    readonly configuration: SubscriptionConfiguration;
    /** Recorded so the UI can prove the person saw the terms summary. */
    readonly acknowledgedTerms: boolean;
}

export interface PauseSubscriptionRequest {
    /** `YYYY-MM-DD`. Omitted, the subscription is paused until it is resumed. */
    readonly until?: string | undefined;
    readonly reason?: string | undefined;
}

export interface SkipDayRequest {
    readonly date: string;
    readonly reason?: string | undefined;
}

export interface ChangeAddressRequest {
    readonly address: DeliveryAddress;
    /** `YYYY-MM-DD` from which the new address applies. Omitted means the next delivery. */
    readonly effectiveFrom?: string | undefined;
}

export interface ChangeSlotRequest {
    readonly slotCode: string;
    readonly deliveryWeekdays?: readonly number[] | undefined;
    readonly effectiveFrom?: string | undefined;
}

export interface SubscriptionFilter extends CursorPageRequest {
    readonly states?: readonly SubscriptionState[] | undefined;
}

export interface CommerceRepository {
    /** `POST /api/v1/carts` creates one lazily; this returns the current cart, creating if needed. */
    getCart(): Promise<Cart>;
    addCartItem(cartId: CartId, request: AddCartItemRequest): Promise<Cart>;
    removeCartItem(cartId: CartId, itemId: string): Promise<Cart>;

    /** `POST /api/v1/checkouts/preview` — a priced quotation. Reserves nothing, charges nothing. */
    previewCheckout(request: PreviewCheckoutRequest): Promise<CheckoutPreview>;

    /**
     * `POST /api/v1/orders` — turn the priced basket into an order.
     *
     * **Still payment-free, and that is why it may exist.** The one-off order is cash on delivery:
     * placing it creates an obligation to cook and to drive, and takes nothing. That is the whole
     * reason this method can be added to a contract whose header refuses to grow a payment surface
     * — there is no instrument field here, no token, no provider reference, and adding one would be
     * a visible change to this signature rather than a value quietly passed through.
     *
     * `addressId` rather than an address value object: delivery is resolved from the address's
     * service area — a zone, a window, a fee — and a typed street line resolves to none of them.
     * The idempotency key is the repository's business, not the caller's: it is generated per
     * attempt so a retry after a dropped connection returns the order that was already placed
     * instead of placing a second one, and no screen can forget to send it.
     */
    placeOrder(request: PlaceOrderRequest): Promise<PlacedOrder>;

    /** `POST /api/v1/subscriptions/preview`. */
    previewSubscription(configuration: SubscriptionConfiguration): Promise<SubscriptionPreview>;

    /** `POST /api/v1/subscriptions`. Creates the subscription record; no payment is taken. */
    createSubscription(request: CreateSubscriptionRequest): Promise<Subscription>;

    getSubscription(subscriptionId: SubscriptionId): Promise<Subscription>;
    listSubscriptions(filter?: SubscriptionFilter): Promise<CursorPage<Subscription>>;

    pause(
        subscriptionId: SubscriptionId,
        request?: PauseSubscriptionRequest,
    ): Promise<Subscription>;
    resume(subscriptionId: SubscriptionId): Promise<Subscription>;
    skipDay(subscriptionId: SubscriptionId, request: SkipDayRequest): Promise<Subscription>;

    changeAddress(
        subscriptionId: SubscriptionId,
        request: ChangeAddressRequest,
    ): Promise<Subscription>;
    changeSlot(subscriptionId: SubscriptionId, request: ChangeSlotRequest): Promise<Subscription>;
}

/** Placed orders. Declared for completeness of the identifier vocabulary; not read in Phase 2. */
export interface OrderReference {
    readonly id: OrderId;
    readonly placedAt: IsoDateTime;
}

export interface PlaceOrderRequest {
    readonly cartId: CartId;
    /** A saved delivery address. The zone, the window and the fee are all resolved from it. */
    readonly addressId: string;
    /** The delivery window the person chose, e.g. `morning`. Empty when they expressed no choice. */
    readonly slotCode?: string | undefined;
    /** `YYYY-MM-DD`. Absent means the earliest the kitchen can manage. */
    readonly deliveryDate?: string | undefined;
}

export const ORDER_STATES = ['placed', 'confirmed', 'preparing', 'delivered', 'cancelled'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export interface PlacedOrderLine {
    readonly id: string;
    readonly name: string;
    readonly quantity: number;
    readonly unitPrice: Money;
    readonly lineTotal: Money;
}

/**
 * An order that exists.
 *
 * `reference` is the human-quotable string — what somebody writes down, reads over a phone or finds
 * in a confirmation message — and `id` is what the system uses. Both, because conflating them
 * produces either an unreadable reference or a guessable identifier. The shape deliberately mirrors
 * `GuestOrder` (`./guest.ts`): the same person may place one order as a guest and the next as an
 * account holder, and a confirmation screen that had to branch on which would be two screens.
 */
export interface PlacedOrder {
    readonly id: OrderId;
    readonly reference: string;
    readonly state: OrderState;
    readonly lines: readonly PlacedOrderLine[];
    readonly priceLines: readonly PriceLine[];
    readonly total: Money;
    readonly address: DeliveryAddress;
    readonly slotCode: string;
    readonly deliveryDate: string;
    readonly placedAt: IsoDateTime;
}
