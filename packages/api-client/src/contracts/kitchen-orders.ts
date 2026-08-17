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

/* ------------------------------------------------------------------------------------------------
 * Money arriving against an order
 * ---------------------------------------------------------------------------------------------- */

/**
 * Where an order stands on being paid — derived on read and **stored nowhere**.
 *
 * `method` is the order's *intended* method, never any receipt's: it is what somebody asks the
 * customer for, read before the money arrives.
 *
 * **`receipted`, not `paid`.** This platform holds no proof that money exists, only that somebody
 * wrote down that it arrived. It is `receivedMinor >= totalMinor`, an inequality in both directions:
 * a part payment leaves it false until the balance lands, and an over-payment does not make it truer.
 *
 * The identical shape rides on the desk queue's row as `OrderDeskPaymentSummary`. The wire serves one
 * object from both places on purpose — two copies of "receipted" would eventually disagree.
 */
export interface KitchenOrderPaymentSummary {
    readonly method: KitchenOrderPaymentMethod;
    /** The sum of every receipt against this order, in the order's currency. Zero, never null. */
    readonly receivedMinor: number;
    readonly receipted: boolean;
}

/**
 * One receipt, as written.
 *
 * A record of an **assertion**, not of a settlement: `confirmedBy` is the person who says the money
 * arrived and `confirmedAt` is when they say it did — which is not always when they wrote it down.
 * That is the whole evidentiary weight of this row, and it is why the ledger is append-only by
 * convention: there is no operation anywhere on this client that edits or deletes one.
 */
export interface KitchenOrderPaymentReceipt {
    readonly id: string;
    readonly orderId: string;
    readonly method: KitchenOrderPaymentMethod;
    readonly amountMinor: number;
    readonly currencyCode: CurrencyCode;
    /** The WISH transaction identifier, or null for cash. Confidential at rest. */
    readonly reference: string | null;
    readonly confirmedBy: string;
    readonly confirmedAt: IsoDateTime;
    readonly notes: string | null;
}

/** The receipt just written, and where the order now stands because of it. */
export interface RecordedKitchenOrderPayment {
    readonly receipt: KitchenOrderPaymentReceipt;
    readonly payment: KitchenOrderPaymentSummary;
}

/**
 * Money arriving against an order, written down by whoever took it.
 *
 * ## `lockVersion` is the **order's**, and this write does not bump it
 *
 * The precondition is required — the server answers `428 request.precondition_required` without it
 * — and it guards a read rather than a write: what it prevents is somebody recording a payment
 * against an order that has been cancelled since they looked at it. The order row is not modified,
 * so the version that came back from the detail read is still current afterwards, and a screen may
 * record two part payments in a row without re-reading between them.
 *
 * ## `method` is deliberately not constrained to the order's intended one
 *
 * A sale taken as cash and settled by a WISH transfer while the customer stood there is an ordinary
 * evening. The order's `paymentMethod` is what was *expected*; this is what turned up, and forcing
 * them to agree would make the desk lie about one of them.
 *
 * ## `amountMinor`, and why over-payment is legal
 *
 * A positive integer in the **order's** currency — there is no currency field, because inventing one
 * would let a caller assert that dirhams arrived against a dollar order. Partial payments are
 * ordinary (`receipted` simply stays false) and over-payments are accepted rather than refused: the
 * money genuinely did arrive, and a ledger that refused to record what happened would send the desk
 * looking for somewhere else to write it down. Reconciling the difference is the till's problem, and
 * this platform has no shift table to reconcile it in — see
 * {@link OrderDeskRepository.getCashReport}, which is the mitigation.
 */
export interface RecordKitchenOrderPaymentRequest extends KitchenOrderTransitionRequest {
    readonly method: KitchenOrderPaymentMethod;
    /** Minor units of the **order's** currency. At least 1 — a zero receipt records nothing. */
    readonly amountMinor: number;
    /** The transfer identifier on a WISH payment; the field a manual confirmation rests on. */
    readonly reference?: string | undefined;
    readonly notes?: string | undefined;
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

    /**
     * Write down money that arrived against an order.
     *
     * ## Why this lives here and not on the order desk
     *
     * The audience is the desk — an agent takes a cash-on-delivery payment at the door or confirms a
     * WISH transfer over the telephone — and `OrderDeskRepository` is where that agent's other
     * operations are. It is here anyway, and the desk repository's own header states the rule this
     * follows: *the lifecycle writes an order needs are `kitchenOrders`', because duplicating them
     * behind a desk-shaped name would give two modules the ability to move the same order with two
     * different ideas of what version they hold.*
     *
     * This write sends the **order's** `lockVersion`. That is the discriminator the desk header
     * already drew: `assignDeliveryJob` sits on the desk precisely because it carries the *job's*
     * validator, which no order operation holds. A second module holding the order's version would
     * be the exact coupling that rule exists to prevent — and a screen would have two places to look
     * for the version it must send.
     *
     * The audience follows the surface rather than the other way round: the drawer that records a
     * payment already imports `useKitchenOrderQuery` for the version it sends, because the desk's own
     * queue row is a poll or two old and the detail read is what the transitions are guarded by.
     *
     * ## What it does and does not change
     *
     * Answers the receipt **and** the order's new payment position, because a screen needs both and a
     * second read to get the second one would be a round trip for a number the server just computed.
     * It does **not** answer the order, and it does not bump the order's `lockVersion` — nothing on
     * the row is modified — so the version the caller sent is still current afterwards.
     *
     * ## Refusals
     *
     * - **`409 resource.conflict`**, two readings under one code, told apart the way
     *   `assignDeliveryJob`'s are: a **stale precondition** carries `currentLockVersion` and is
     *   resolved by re-reading; a **cancelled order** carries none, and no amount of re-reading makes
     *   a cancelled order payable. The screen must offer a refresh for the first and refuse the
     *   second.
     * - **`428 request.precondition_required`** — unreachable from this client, because
     *   {@link RecordKitchenOrderPaymentRequest} makes `lockVersion` mandatory.
     * - **`422 validation.failed`** — a zero or negative amount, or a method outside the three.
     *
     * The `Idempotency-Key` is minted inside the repository per attempt, so no screen can forget it
     * and a deliberate second attempt records a second payment rather than replaying the first.
     */
    recordPayment(request: RecordKitchenOrderPaymentRequest): Promise<RecordedKitchenOrderPayment>;
}
