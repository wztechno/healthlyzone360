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

/**
 * The consumable balance, as it appears on the subscription itself.
 *
 * A plan is **a balance of delivery days**, not a calendar range (S1 semantics §1). Twenty days is
 * twenty deliveries; skipping and pausing consume nothing and simply stretch the balance into the
 * future. These three numbers are on `Subscription` rather than only behind
 * {@link CommerceRepository.getSubscriptionBalance} because the backend's own presenter carries
 * them there — a list of subscriptions that had to fire one balance request per row to say "6 of 20
 * left" would be an N+1 invented by the client.
 *
 * `consumed` is a **stored** count, not `total - remaining` recomputed from the ledger: the backend
 * stores it per delivery row, and a skipped delivery is a row that exists and consumed nothing.
 */
export interface SubscriptionDays {
    readonly total: number;
    readonly consumed: number;
    readonly remaining: number;
}

export interface Subscription {
    readonly id: SubscriptionId;
    readonly state: SubscriptionState;
    readonly configuration: SubscriptionConfiguration;
    readonly planName: string;
    readonly kitchenId: KitchenId;
    readonly weeklyPrice: Money;
    /** The balance of delivery days. See {@link SubscriptionDays}. */
    readonly days: SubscriptionDays;
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

/* ------------------------------------------------------------------------------------------------
 * S1 — the balance, the ledger, cancellation, the weekday and meal editors, and a real quote
 *
 * Every shape below is an *extension* of the surface above rather than a parallel one. The approved
 * semantics (`docs/s1-subscription-semantics-proposal.md`) turn a subscription from "a thing with a
 * weekly price" into "a consumable balance of delivery days with a ledger behind it", and the
 * interface has to be able to say so without a screen inferring anything.
 * ---------------------------------------------------------------------------------------------- */

/**
 * What happened to one day of the balance.
 *
 * Seven states, matching the backend's `SubscriptionDeliveryStatus` exactly. The three `skipped_*`
 * values are separate rather than one `skipped` with a reason field because they mean genuinely
 * different things to the person reading the ledger: `skipped_customer` is a choice they made,
 * `skipped_no_safe_meal` is the allergen rule refusing to substitute (semantics §6) and
 * `skipped_unavailable` is the kitchen. **None of the three consumes a day.**
 */
export const SUBSCRIPTION_DELIVERY_STATUSES = [
    'scheduled',
    'generated',
    'skipped_customer',
    'skipped_no_safe_meal',
    'skipped_unavailable',
    'delivered',
    'cancelled',
] as const;
export type SubscriptionDeliveryStatus = (typeof SUBSCRIPTION_DELIVERY_STATUSES)[number];

/** Why a day was skipped. `null` on every status that is not a skip. */
export const SUBSCRIPTION_SKIP_REASONS = [
    'customer_request',
    'no_safe_meal',
    'unavailable',
] as const;
export type SubscriptionSkipReason = (typeof SUBSCRIPTION_SKIP_REASONS)[number];

/**
 * One row of the delivery ledger.
 *
 * `consumed` is carried rather than derived from `status`. The backend stores it as its own column
 * with a CHECK constraint tying the two together, and a client that recomputed it would be a second
 * implementation of the rule that decides whether somebody's twenty days became nineteen.
 */
export interface SubscriptionDelivery {
    readonly id: string;
    /** `YYYY-MM-DD`. One row per subscription per day — the backend's unique index says so. */
    readonly date: string;
    readonly status: SubscriptionDeliveryStatus;
    readonly consumed: boolean;
    readonly skipReason: SubscriptionSkipReason | null;
    readonly slotCode: string;
}

export interface SubscriptionDeliveryFilter extends CursorPageRequest {
    readonly statuses?: readonly SubscriptionDeliveryStatus[] | undefined;
}

/**
 * The balance read.
 *
 * `perDayPrice` is the **effective** price actually paid — after the duration discount — because
 * that is the number a refund is computed from (semantics §3) and the number a person needs to
 * check the arithmetic on a credit memo. A screen that divided a weekly price by seven would print
 * a different number from the one the refund uses.
 */
export interface SubscriptionBalance {
    readonly subscriptionId: SubscriptionId;
    readonly state: SubscriptionState;
    readonly days: SubscriptionDays;
    readonly perDayPrice: Money;
    /** Days that were scheduled and skipped. They cost nothing and are not in `days.consumed`. */
    readonly skippedDays: number;
    readonly nextDeliveryDate: string | null;
    /** ISO weekdays currently in effect, `1` Monday to `7` Sunday. */
    readonly deliveryWeekdays: readonly number[];
    /** From the plan's `change_cutoff_hours`. The 24-hour rule is configuration, not a constant. */
    readonly changeCutoffHours: number;
}

/**
 * The refund of an unused balance, recorded rather than paid.
 *
 * `settlement: 'manual'` is a literal and not a nullable field on purpose. There is no payments
 * module (PAY1 is discovery-gated), so nothing in this system moves money; the memo is a record
 * somebody settles by hand. A `settledAt: string | null` would read to a screen as "we will pay
 * this automatically, eventually", which is not true and would be the most expensive kind of
 * plausible interface copy.
 */
export interface CreditMemo {
    readonly id: string;
    readonly subscriptionId: SubscriptionId;
    /** The one reason the backend's CHECK constraint admits. */
    readonly reason: 'subscription_cancelled';
    readonly unusedDays: number;
    /** The effective per-day price paid. `amount = unusedDays × perDayPrice`. */
    readonly perDayPrice: Money;
    readonly amount: Money;
    readonly status: 'recorded' | 'settled';
    readonly settlement: 'manual';
    readonly recordedAt: IsoDateTime;
}

export interface CancelSubscriptionRequest {
    readonly reason?: string | undefined;
}

/**
 * Cancellation's answer.
 *
 * Both halves, in one shape, because they are one fact. `creditMemo` is `null` when there was no
 * unused balance to refund — a subscription cancelled on its last day owes nothing — and a screen
 * that had to make a second request to find out would render a cancellation dialog that could not
 * state its own consequence.
 */
export interface SubscriptionCancellation {
    readonly subscription: Subscription;
    readonly creditMemo: CreditMemo | null;
}

export interface SetSubscriptionWeekdaysRequest {
    /** ISO weekdays, `1` Monday to `7` Sunday. Never empty — the backend refuses `weekdays_empty`. */
    readonly deliveryWeekdays: readonly number[];
}

/** Who chose this meal. `kitchen_default` is the fallback when nobody chose ahead of the cut-off. */
export const MEAL_CHOICE_SOURCES = ['customer', 'kitchen_default', 'substituted'] as const;
export type MealChoiceSource = (typeof MEAL_CHOICE_SOURCES)[number];

export interface SubscriptionMealChoice {
    /** `YYYY-MM-DD` — the delivery day this choice is for. */
    readonly date: string;
    readonly slot: string;
    readonly mealId: MealId;
    readonly mealName: string;
    readonly source: MealChoiceSource;
}

/**
 * Free Selection, choosing ahead of the cut-off.
 *
 * A **replace**, not a merge: the request carries the whole day. The backend deletes the rows whose
 * source is `customer` and writes these, which means "I no longer want a second meal" is expressible
 * — a merge would make removal impossible without a second delete operation.
 */
export interface SetSubscriptionMealChoicesRequest {
    readonly date: string;
    readonly choices: readonly { readonly slot: string; readonly mealId: MealId }[];
}

/** Why a plan cannot be quoted. The backend's own refusal vocabulary, verbatim. */
export const SUBSCRIPTION_QUOTE_REFUSALS = [
    'plan_not_subscription',
    'duration_unknown',
    'duration_not_fixed',
    'duration_not_offered',
    /**
     * Two runs offered for the same configuration with the same number of days.
     *
     * The quote names a run by its day count — the only identity a shopper holds, since the public
     * plan read publishes durations without identifiers — so two runs sharing one cannot be told
     * apart. It is a *kitchen's* configuration mistake rather than a limit on the customer, and the
     * refusal carries the competing codes so the kitchen reading its own error can see which two.
     */
    'duration_ambiguous',
    'pricing_basis_unsupported',
    'unpriced',
] as const;
export type SubscriptionQuoteRefusal = (typeof SUBSCRIPTION_QUOTE_REFUSALS)[number];

export interface SubscriptionQuoteRequest {
    readonly planId: SubscriptionPlanId;
    readonly variantId: PlanVariantId;
    readonly duration: PlanDuration;
}

/**
 * Availability and price, in one read.
 *
 * **This method exists to delete a hack.** Until now the application discovered which weekdays a
 * plan delivers on by pricing the same subscription seven times, once per weekday, and reading
 * which answers carried a `subscription.delivery_day_unavailable` warning
 * (`apps/universal/src/data/commerce-hooks.ts`). That was honest — it used only what the contract
 * published — and it was seven round trips for a fact that belongs on the plan. `availableWeekdays`
 * is that fact.
 *
 * `refusals` is a list rather than a thrown failure because "this plan cannot be subscribed to for
 * that duration" is something a configurator **draws**, not something it crashes on. When it is
 * non-empty the price fields are zero and `available` is false.
 */
export interface SubscriptionQuote {
    readonly planId: SubscriptionPlanId;
    readonly variantId: PlanVariantId;
    readonly duration: PlanDuration;
    readonly available: boolean;
    /** ISO weekdays this plan delivers on. The seven-probe hack's replacement. */
    readonly availableWeekdays: readonly number[];
    /** How many delivery days the duration buys — the balance a purchase would create. */
    readonly days: number;
    readonly listPrice: Money;
    readonly discountPercent: number;
    /** After the discount. This is the number a future refund is computed against. */
    readonly perDayPrice: Money;
    readonly total: Money;
    /** Whether this plan lets the customer choose each meal (semantics §7, choose-ahead). */
    readonly allowsFreeSelection: boolean;
    readonly changeCutoffHours: number;
    readonly refusals: readonly SubscriptionQuoteRefusal[];
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

    /* ── S1 ──────────────────────────────────────────────────────────────────────────────────── */

    /**
     * `GET /api/v1/subscription-plans/{plan}/quote` — availability and price for a proposed plan.
     *
     * A **query**: it reserves nothing. It replaces `useAllowedDeliveryWeekdaysQuery`'s seven
     * previews with one read (see {@link SubscriptionQuote}).
     */
    getSubscriptionQuote(request: SubscriptionQuoteRequest): Promise<SubscriptionQuote>;

    /** `GET /api/v1/subscriptions/{subscription}/balance`. */
    getSubscriptionBalance(subscriptionId: SubscriptionId): Promise<SubscriptionBalance>;

    /**
     * `GET /api/v1/subscriptions/{subscription}/deliveries` — the ledger.
     *
     * Every day the subscription has had or will have, with what became of it. This is the only
     * place the difference between "you used a day" and "nothing happened that day" is visible, and
     * it is the evidence behind the balance rather than a restatement of it.
     */
    listSubscriptionDeliveries(
        subscriptionId: SubscriptionId,
        filter?: SubscriptionDeliveryFilter,
    ): Promise<CursorPage<SubscriptionDelivery>>;

    /**
     * `POST /api/v1/subscriptions/{subscription}/cancel` — terminal, and it answers with the money.
     *
     * Returns the credit memo it minted, not a boolean. The refund is *unused days × the effective
     * per-day price actually paid* (semantics §3): the discount already enjoyed on delivered days is
     * not clawed back. Nothing is transferred — the memo is settled by hand until PAY1 exists.
     */
    cancelSubscription(
        subscriptionId: SubscriptionId,
        request?: CancelSubscriptionRequest,
    ): Promise<SubscriptionCancellation>;

    /**
     * `PUT /api/v1/subscriptions/{subscription}/weekdays`.
     *
     * Separate from {@link changeSlot}, which could already carry `deliveryWeekdays`, because the
     * two are different decisions with different consequences: a slot change moves the hour, a
     * weekday change re-plans the whole remaining ledger. Refused with `inside_cut_off` when it
     * would touch a delivery less than the plan's cut-off away (semantics §2).
     */
    setSubscriptionWeekdays(
        subscriptionId: SubscriptionId,
        request: SetSubscriptionWeekdaysRequest,
    ): Promise<Subscription>;

    /**
     * `PUT /api/v1/subscriptions/{subscription}/meal-choices` — Free Selection, choosing ahead.
     *
     * Answers the day's choices as they now stand, including the `kitchen_default` rows the person
     * did not override, so the editor can redraw the whole day from one answer.
     */
    setSubscriptionMealChoices(
        subscriptionId: SubscriptionId,
        request: SetSubscriptionMealChoicesRequest,
    ): Promise<readonly SubscriptionMealChoice[]>;
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
