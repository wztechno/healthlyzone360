import type {
    AllergenCode,
    BranchId,
    CurrencyCode,
    DeliveryZoneId,
    IsoDateTime,
    OrderId,
    PriceListId,
} from '@healthy360/domain-types';

/**
 * The kitchen's own view of the orders placed against it — the seller side of the same rows the
 * customer reads through `CommerceRepository`.
 *
 * ## Why this is a separate contract rather than a filter on the customer's order shape
 *
 * The two audiences want different columns, and the wire already says so: `KitchenOrder` is built
 * independently of `CustomerOrder` rather than as a superset of it, because a wide shape narrowed
 * by subtraction is how a column added next year quietly reaches a receipt. Concretely, the kitchen
 * sees three things the customer must never see —
 *
 * 1. **`priceListId` / `priceListItemId` on every line.** They answer "why was this the price?" a
 *    year later. On a customer's receipt they would name the kitchen's tariff structure to the
 *    person being charged by it.
 * 2. **`delivery.zoneId`.** Which slice of the kitchen's delivery map the address fell into, and
 *    what set the fee. That is the seller's operating arrangement, not the buyer's.
 * 3. **`lockVersion`.** See below.
 *
 * And the kitchen sees them *per branch*, filtered by a requested delivery date, because the
 * question a kitchen asks an order list is "what am I cooking for Thursday?" — never "what did I
 * buy?".
 *
 * ## Why `lockVersion` is in the read model
 *
 * This is the audience that **writes**. All three lifecycle actions — confirm, fulfil, cancel —
 * are guarded by `If-Match`, so a screen that could not read the validator could not send it: the
 * server answers `request.precondition_required` when the header is missing and `resource.conflict`
 * when it is stale. Hiding the version behind the repository and re-reading before each write would
 * defeat the guard entirely — it would resolve the race in favour of whichever tablet pressed last,
 * which is precisely the outcome optimistic concurrency exists to prevent. So `lockVersion` is on
 * the record, every write takes it as an argument, and every write answers with the fresh record
 * carrying the next one.
 *
 * ## The status machine, restated once
 *
 * `placed → confirmed → fulfilled`, with `cancel` reachable from `placed` and `confirmed` only.
 * `fulfilled` and `cancelled` are terminal: the food has been delivered (or was never made), and
 * what happens after that is a refund or a complaint — different objects with different money
 * attached. An illegal transition is a `resource.conflict`, not a validation failure, because the
 * request was well formed; the world had moved.
 *
 * ## Money
 *
 * Integer minor units plus one `currencyCode` per order and per line, exactly as the wire carries
 * them and exactly as the rest of the commerce contracts do. `deliveryFeeMinor` is `null` when no
 * zone charged one, which is *not* the same as zero — a free delivery and an un-zoned address are
 * different facts and a screen may want to say so.
 *
 * ## Deliberately absent in v1
 *
 * No refunds, no partial fulfilment, no production stages (that is the kitchen display's
 * vocabulary, not the order's), no payment surface (there is one method and it happens at the
 * door), and no free-text cancellation note — the reason is a fixed enum because it is read by
 * machines as often as by people, and free text is how personal data ends up in a column nobody
 * classified.
 */

export const KITCHEN_ORDER_STATUSES = ['placed', 'confirmed', 'fulfilled', 'cancelled'] as const;
export type KitchenOrderStatus = (typeof KITCHEN_ORDER_STATUSES)[number];

/** The statuses a kitchen may still act on. `fulfilled` and `cancelled` are terminal. */
export const KITCHEN_ORDER_OPEN_STATUSES: readonly KitchenOrderStatus[] = ['placed', 'confirmed'];

export const KITCHEN_ORDER_CANCELLATION_REASONS = [
    'customer_requested',
    'kitchen_unable_to_fulfil',
    'delivery_unavailable',
    'address_unreachable',
] as const;
export type KitchenOrderCancellationReason = (typeof KITCHEN_ORDER_CANCELLATION_REASONS)[number];

/**
 * Three methods, and each one has a table behind it — see the wire's own note on `payment_method`.
 * This is the **intent** captured when the order was placed; how the money actually turned up is on
 * the order's payment receipts, which are deliberately not constrained to agree with it.
 */
export const KITCHEN_ORDER_PAYMENT_METHODS = [
    'cash_on_delivery',
    'cash_at_counter',
    'wish',
] as const;
export type KitchenOrderPaymentMethod = (typeof KITCHEN_ORDER_PAYMENT_METHODS)[number];

export interface KitchenOrderLineAllergen {
    readonly allergenCode: AllergenCode;
    readonly containment: string;
}

/**
 * The article as it stood the moment the order was placed — a snapshot, not a join. Renaming the
 * catalogue item tomorrow does not rewrite what the kitchen agreed to cook.
 */
export interface KitchenOrderLine {
    readonly id: string;
    /**
     * The catalogue row this line was bought from. Unbranded on purpose: it may be a product, a
     * meal or a subscription plan, and the order does not record which.
     */
    readonly catalogueItemId: string;
    readonly catalogueItemVariantId: string | null;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly variantLabel: string | null;
    /** The decimal string the line total was computed from, never a float — a line can be 0.35 kg. */
    readonly quantity: string;
    readonly unitPriceMinor: number;
    /** Rounded exactly once, server-side. Never `unitPriceMinor * quantity` computed here. */
    readonly lineTotalMinor: number;
    readonly currencyCode: CurrencyCode;
    readonly allergens: readonly KitchenOrderLineAllergen[];
    /** The pack as it was sold — size, unit, pieces, net weight. Never a cost, never a supplier. */
    readonly packSummary: Readonly<Record<string, unknown>> | null;
    /** Seller-only: which tariff priced this line. See the file header. */
    readonly priceListId: PriceListId | null;
    readonly priceListItemId: string | null;
}

/**
 * The address as it stood when the order was placed, copied. Editing the address book later must
 * not change where this order was sent.
 */
export interface KitchenOrderDelivery {
    readonly label: string | null;
    /** Null for pickup and counter orders — a collection has no destination to copy. */
    readonly lineOne: string | null;
    readonly lineTwo: string | null;
    /** The gazetteer's governorate or district. Usually `null` — the platform data leaves it unset. */
    readonly city: string | null;
    readonly areaNameEn: string | null;
    readonly areaNameAr: string | null;
    readonly areaId: string | null;
    readonly windowCode: string | null;
    /** `YYYY-MM-DD`. The day the customer asked for, which is what the list filters on. */
    readonly requestedDate: string | null;
    /** Seller-only: the delivery zone that set the fee. See the file header. */
    readonly zoneId: DeliveryZoneId | null;
}

/**
 * How this order leaves the kitchen, decided at placement and **never afterwards**.
 *
 * Not a delivery *status*: where an order has got to is {@link KitchenOrderStatus}, which moves,
 * and this never does. An order taken for delivery and collected by an impatient customer is a
 * delivery that was handed over early — rewriting the type would leave the fee already snapshotted
 * on the row unexplainable.
 *
 * `delivery` is the column's default, so every order placed before this vocabulary existed carries
 * it. The desk's own {@link OrderDeskFulfilmentType} is the same three values in a different order
 * (counter first, because that is the sale a counter makes most often) and is proved to be the same
 * set by a `satisfies` in `order-desk.ts` — one vocabulary, two orderings, no drift.
 */
export const KITCHEN_ORDER_FULFILMENT_TYPES = ['delivery', 'pickup', 'counter'] as const;
export type KitchenOrderFulfilmentType = (typeof KITCHEN_ORDER_FULFILMENT_TYPES)[number];

export interface KitchenOrder {
    readonly id: OrderId;
    /** The human-quotable reference — what a customer reads over the phone. Unique platform-wide. */
    readonly orderNumber: string;
    readonly branchId: BranchId | null;
    readonly status: KitchenOrderStatus;
    readonly currencyCode: CurrencyCode;
    readonly subtotalMinor: number;
    /** `null` when no zone charged one — which is not the same as zero. */
    readonly deliveryFeeMinor: number | null;
    readonly totalMinor: number;
    readonly paymentMethod: KitchenOrderPaymentMethod;
    /**
     * Which of the three shapes this order is. Never null on the wire — the column has a default and
     * a CHECK behind it — and it is what tells a screen that {@link KitchenOrderDelivery} being all
     * nulls is a *collection* rather than a delivery missing its address.
     */
    readonly fulfilmentType: KitchenOrderFulfilmentType;
    readonly delivery: KitchenOrderDelivery;
    readonly placedAt: IsoDateTime;
    readonly confirmedAt: IsoDateTime | null;
    readonly fulfilledAt: IsoDateTime | null;
    readonly cancelledAt: IsoDateTime | null;
    readonly cancellationReason: KitchenOrderCancellationReason | null;
    /** The `If-Match` validator every lifecycle action must carry. See the file header. */
    readonly lockVersion: number;
    /** The server's own count, so a collapsed list row can say "4 items" without holding the lines. */
    readonly lineCount: number;
    readonly lines: readonly KitchenOrderLine[];
}

/**
 * One page of orders, newest first.
 *
 * Its own type rather than `CursorPage<KitchenOrder>` because this endpoint answers no total: it
 * reads one row beyond the page to decide `hasMore` rather than running a count that would disagree
 * with the page under concurrent writes. A `totalCount: null` field would be a promise of a number
 * this list can never produce.
 */
export interface KitchenOrderPage {
    readonly items: readonly KitchenOrder[];
    /** Opaque. Echo it back as `cursor`; never parse, compare or construct one. `null` on the last page. */
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
}

export interface KitchenOrderFilters {
    readonly status?: KitchenOrderStatus | undefined;
    /**
     * Strictly `YYYY-MM-DD`, matched against `delivery.requestedDate`. The kitchen's primary
     * question — "what am I cooking for Thursday?" — so it is a first-class filter, not a client
     * post-filter over a page that may not contain Thursday at all.
     */
    readonly requestedDeliveryDate?: string | undefined;
    readonly branchId?: BranchId | undefined;
    /** A partial order number. Nothing else is searchable: a name or an address would not be. */
    readonly query?: string | undefined;
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
}

/**
 * The shape all three lifecycle actions share.
 *
 * `lockVersion` is the version the screen *read*, not the one it hopes is current — that is the
 * whole point of sending it. A stale value is answered with `resource.conflict` and the message
 * "This order changed while you were working on it", which the detail panel resolves by re-reading.
 */
export interface KitchenOrderTransitionRequest {
    readonly id: OrderId;
    readonly lockVersion: number;
}

export interface CancelKitchenOrderRequest extends KitchenOrderTransitionRequest {
    /** Required, and an enum. See the file header for why there is no free-text note beside it. */
    readonly reason: KitchenOrderCancellationReason;
}

export interface KitchenOrdersRepository {
    /** Newest first, keyset-paged. Every filter is optional; none of them is a client-side sieve. */
    listOrders(filters?: KitchenOrderFilters): Promise<KitchenOrderPage>;

    /** The full order including its lines and the `lockVersion` the three writes below need. */
    getOrder(orderId: OrderId): Promise<KitchenOrder>;

    /** `placed → confirmed`. Answers the fresh record, carrying the next `lockVersion`. */
    confirmOrder(request: KitchenOrderTransitionRequest): Promise<KitchenOrder>;

    /** `confirmed → fulfilled`, terminal. */
    fulfilOrder(request: KitchenOrderTransitionRequest): Promise<KitchenOrder>;

    /** From `placed` or `confirmed` only, terminal. */
    cancelOrder(request: CancelKitchenOrderRequest): Promise<KitchenOrder>;
}
