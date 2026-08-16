import type { BranchId, CurrencyCode, IsoDateTime } from '@healthy360/domain-types';

import type { DriverJobStatus, DriverJobTrackingStatus } from './driver-jobs.ts';
import type {
    KitchenOrder,
    KitchenOrderFulfilmentType,
    KitchenOrderPaymentMethod,
    KitchenOrderStatus,
} from './kitchen-orders.ts';

/**
 * The Order Desk's queue — the open order book in the order somebody at a desk has to work it.
 *
 * ## Why this is not a filter on `KitchenOrdersRepository.listOrders`
 *
 * The order book is a *book*: every order, newest first, walked with a cursor, and the question it
 * answers is "what did we take last Tuesday?" or "where is H360-…?". This is the *queue*, and the
 * question is "what is next?" — which is a different sort, and on this wire it is a computed one:
 * `due_at` is derived in SQL from the requested day, the delivery window's opening time and the
 * branch's timezone. `CursorPage` re-sorts whatever it constrains (`pagination.ts`), so a cursor and
 * this ordering cannot both be true of one query. The endpoint is therefore **bounded rather than
 * paged** — two hundred rows, with {@link OrderDeskQueueMeta.truncated} when more matched — and this
 * contract carries no cursor for the same reason `KitchenQuotationsRepository.listQuotations`
 * carries none: a `nextCursor: null` field would promise paging that cannot exist here.
 *
 * ## The row is the kitchen's order, plus what the desk needs and the kitchen did not
 *
 * {@link OrderDeskQueueRow} extends {@link KitchenOrder} rather than restating it, because it *is*
 * that order — the same identifier, the same lines, the same `lockVersion` the lifecycle writes
 * send. Three things are added, and each one is a fact the order book has no column for.
 *
 * ## `dueAt` is never null, and that is the whole point of the endpoint
 *
 * An order with no requested day is not scheduled for nothing; it is scheduled for as soon as
 * possible. The server falls through the end of the requested day when the window has no hours,
 * through UTC when no branch was named, and through `placedAt` when the customer named no day at
 * all — so every row sorts, and nothing lands in a silent "unknown" bucket at the bottom. A client
 * must never re-derive it from `delivery.requestedDate`: it would not have the branch's clock.
 *
 * ## Both seats are now filled
 *
 * `payment` and `deliveryJob` were declared as untyped seats while nothing populated them, so the
 * row would not change shape under a screen when they landed. Both have since been filled by the
 * operations that write them, and both are typed here on their own terms.
 *
 * {@link OrderDeskPaymentSummary} is **never null** — an order whose payment position is unknown is
 * not a state this platform reaches, and zero received against a total is a position rather than an
 * absence. {@link OrderDeskDeliveryJob} *is* nullable, and its null is a real answer about three
 * different orders — see its own note.
 *
 * ## `customer` is optional, and its optionality is the disclosure boundary
 *
 * The block is present **only when the caller holds `order.view_customer_contact_organisation`**,
 * and *absent* — not null — without it. That difference is load-bearing: `displayName: null` is a
 * fact about the customer ("this account has been anonymised"), and a screen could not tell that
 * apart from a fact about the reader ("you may not see names") unless the two cases differed in
 * shape. So the field is `?:` here rather than `| null`, and a screen renders an em dash for both —
 * see the queue screen, which must not look broken to a reader who simply is not permitted.
 *
 * That is the whole of the disclosure: a name and a number. No email, no address beyond the delivery
 * snapshot the order book already serves, no allergen declaration, no account identifier to pivot
 * on, and no order history.
 */

/**
 * Which slice of the open book the desk is looking at.
 *
 * Three questions somebody at a desk actually asks, rather than a date range that could express a
 * hundred nobody does. `today` **also carries every order with no requested date at all** — an order
 * whose customer named no day is scheduled for as soon as possible, and a plain range would drop
 * exactly the set nobody has committed to a day yet. `overdue` does not inherit that rule: a
 * dateless order is never late, because there is no day it has missed. `next_7` runs from today to
 * seven days after it, inclusive at both ends.
 */
export const ORDER_DESK_WINDOWS = ['today', 'overdue', 'next_7'] as const;
export type OrderDeskWindow = (typeof ORDER_DESK_WINDOWS)[number];

/**
 * The two statuses the queue lists, as its own union rather than as `KitchenOrderStatus`.
 *
 * `fulfilled` and `cancelled` are not accepted by the endpoint at all — they are finished with, and
 * they are the order book's business. The `satisfies` keeps this narrowing honest: these two are
 * order statuses, and the day the order machine renames one, this line stops compiling.
 */
export const ORDER_DESK_QUEUE_STATUSES = [
    'placed',
    'confirmed',
] as const satisfies readonly KitchenOrderStatus[];
export type OrderDeskQueueStatus = (typeof ORDER_DESK_QUEUE_STATUSES)[number];

/**
 * The customer's name, and the number somebody can ring them on.
 *
 * Either field may be null on its own — an anonymised account has no name, and a customer who never
 * gave a number has no number. The number is served **verified or not**: a courier ringing about
 * tonight's delivery needs the number the customer gave, not one the platform has proved.
 */
export interface OrderDeskCustomerContact {
    readonly displayName: string | null;
    /** E.164, as the contact point stores it. */
    readonly phone: string | null;
}

/**
 * Where an order stands on being paid — derived on read and **stored nowhere**.
 *
 * `method` is the order's *intended* method, not any receipt's: a desk reads this before the money
 * arrives, because it is how somebody knows what to ask the customer for.
 *
 * **`receipted`, not `paid`.** The word is doing real work. This platform holds no proof that money
 * exists, only that somebody wrote down that it arrived. It is `receivedMinor >= totalMinor`, an
 * inequality in both directions: a part payment leaves it false until the balance lands, and an
 * over-payment does not make it truer.
 */
export interface OrderDeskPaymentSummary {
    readonly method: KitchenOrderPaymentMethod;
    /** The sum of every receipt against this order, in the order's currency. Zero, never null. */
    readonly receivedMinor: number;
    readonly receipted: boolean;
}

/**
 * The run this order became: which driver has it, what state it is in, and when it was handed over.
 *
 * ## `null` is a real answer, and it is true of three different orders
 *
 * A pickup or a counter sale is never driven anywhere. A delivery order still `placed` has no run
 * yet, because a job is projected on *confirm* — the moment a kitchen commits to cook — and a placed
 * order may still be cancelled without a driver hearing about it. And a delivery order confirmed
 * before the delivery chain shipped was never projected and will not be retrospectively.
 *
 * All three read as `null` here, deliberately: the job is the same absence in every case. A screen
 * that needs to tell them apart has {@link KitchenOrder.fulfilmentType} and
 * {@link KitchenOrder.status} on the same row, which is where those two facts already live — and a
 * three-valued "why is there no job" field would be a second, quieter copy of them.
 *
 * ## The statuses are the driver contract's, read whole
 *
 * `status` and `trackingStatus` are {@link DriverJobStatus} and {@link DriverJobTrackingStatus}
 * rather than desk-shaped unions of the same six and five values. There is one delivery job and one
 * wire vocabulary for it; the dispatch seat and the driver's seat differ in *what they may do* with
 * a job, never in what states one can be in. Two copies would agree today and drift the day the
 * wire gains a seventh.
 *
 * ## There is no address here, and no driver name
 *
 * Where the food is going is already on the row's own `delivery` block, and a second copy inside the
 * job would be two answers to one question. `driverUserId` is an identifier and **not** a person a
 * screen can name: no operation on this surface resolves a member to a display name, so a column
 * showing it would be showing a UUID. It is here because it answers "has anybody been given this?",
 * which is the question the desk actually asks.
 */
export interface OrderDeskDeliveryJob {
    /**
     * The job. Unbranded, on the same terms as {@link DriverJob.id}: no `DeliveryJobId` codec exists
     * and this identifier is never crossed with another kind — it is read from a row and handed
     * straight back to {@link OrderDeskRepository.assignDeliveryJob}.
     */
    readonly id: string;
    readonly status: DriverJobStatus;
    readonly trackingStatus: DriverJobTrackingStatus;
    /** `null` until dispatch assigns one. */
    readonly driverUserId: string | null;
    readonly assignedAt: IsoDateTime | null;
    /**
     * The job's **own** validator, carried on the queue row so an assignment has its `If-Match`
     * without re-reading the job.
     *
     * It is not the order's `lockVersion` and the two move independently: assigning a driver
     * deliberately does not touch the order, so a screen holding both must send each to its own
     * write. Crossing them earns a `resource.conflict` on a race nobody entered.
     */
    readonly lockVersion: number;
}

/**
 * The job as it stands after an assignment, with the validator to send next.
 *
 * A superset of what the queue row carries plus `orderId`, which is what the wire answers: a board
 * refreshing one row from this response does not have to reconcile two vocabularies. Nothing here
 * is re-derived — in particular `status` and `trackingStatus` are read from the response rather than
 * assumed to be `assigned`, because what an assignment does to the tracking axis is the server's
 * decision and a client that guessed would tell a customer something nobody promised them.
 */
export interface AssignedDeliveryJob extends OrderDeskDeliveryJob {
    readonly orderId: string;
}

/**
 * Who takes this run.
 *
 * One object carrying the job, the person and the validator — the shape every other lock-versioned
 * write on this client uses ({@link QuoteKitchenQuotationRequest}, the B2B application's writes) —
 * because `lockVersion` is not an optional refinement of the call, it is half of what makes it safe.
 *
 * `driverUserId` deliberately has **no null**: unassigning is a different decision — it would need
 * its own route and its own audit action — and cannot arrive here as an omitted key. The identifier
 * must name an **active member of this organisation**; one that does not is a `422` carrying
 * `details.fields.driver_user_id`, which is a validation failure about the person rather than a
 * refusal about the job.
 */
export interface AssignDeliveryJobRequest {
    /** The job's identifier, from {@link OrderDeskDeliveryJob.id}. */
    readonly jobId: string;
    readonly driverUserId: string;
    /**
     * The **job's** version, from {@link OrderDeskDeliveryJob.lockVersion} — never the order's. The
     * two rows are versioned separately and assigning a driver does not touch the order.
     */
    readonly lockVersion: number;
}

export interface OrderDeskQueueRow extends KitchenOrder {
    /**
     * The instant this order is actually due, as a UTC timestamp, and **never null**. It is what the
     * queue is sorted by and what an ageing badge is measured against. Never re-derived on the
     * client: the fall-through chain runs on the branch's clock, which no screen holds.
     */
    readonly dueAt: IsoDateTime;
    /** Never null. See {@link OrderDeskPaymentSummary}. */
    readonly payment: OrderDeskPaymentSummary;
    /** `null` on three quite different orders — see {@link OrderDeskDeliveryJob}. */
    readonly deliveryJob: OrderDeskDeliveryJob | null;
    /** Absent — not null — without `order.view_customer_contact_organisation`. See the header. */
    readonly customer?: OrderDeskCustomerContact | undefined;
}

/**
 * What the server measured the queue against, echoed because the client did not choose it and
 * cannot derive it.
 */
export interface OrderDeskQueueMeta {
    /** Rows in this response. */
    readonly count: number;
    /** The most rows this operation will ever return. There is no second page. */
    readonly limit: number;
    /**
     * More orders matched than were returned. A screen showing a truncated queue **has to say so**:
     * a silent truncation would hide exactly the backlog the queue exists to surface.
     */
    readonly truncated: boolean;
    readonly window: OrderDeskWindow;
    /** `YYYY-MM-DD` — the day the window was measured from. */
    readonly today: string;
    /** The IANA zone that day was computed in: the named branch's, or `UTC` when none was named. */
    readonly timezone: string;
}

/** One bounded queue read. Not a page — see the file header. */
export interface OrderDeskQueue {
    readonly rows: readonly OrderDeskQueueRow[];
    readonly meta: OrderDeskQueueMeta;
}

export interface OrderDeskQueueFilters {
    /** Defaults to `today` server-side when omitted, which is why this is not required here. */
    readonly window?: OrderDeskWindow | undefined;
    /**
     * Narrow to one production site — **and** name the clock `today` is read on. A branch is a
     * place and a place has a working day; unnamed, the day boundary is UTC.
     *
     * A query parameter rather than the `X-Branch-Id` header the stock surfaces use, and
     * deliberately: an organisation-wide desk agent selects no branch at all, so a header that had
     * to be present could not express the organisation-wide read this queue exists to serve.
     */
    readonly branchId?: BranchId | undefined;
    /** Omitted, both open statuses are listed. An empty array means the same thing. */
    readonly statuses?: readonly OrderDeskQueueStatus[] | undefined;
    /** One named delivery slot, by the window's own code. */
    readonly deliveryWindowCode?: string | undefined;
    /**
     * A partial order number, matched case-insensitively — **and nothing else**. Not a name, not a
     * phone number: the queue is reachable by people who may not read either, so a search that
     * matched them would leak the fields the permission gate exists to withhold.
     */
    readonly query?: string | undefined;
}

/* ------------------------------------------------------------------------------------------------
 * Selling: the quote, the placement, and the customer a sale is for
 * ---------------------------------------------------------------------------------------------- */

/**
 * The three shapes a desk sale can take, and the whole of what distinguishes them.
 *
 * `fulfilmentType` decides which of the other fields are **required, forbidden or merely allowed**,
 * and the rule is not soft: a body carrying a field its shape forbids is refused rather than having
 * the field quietly dropped, because a field supplied and ignored means the caller believed
 * something about this order that is not true of it.
 *
 * - `counter` — a walk-in. No address ever. Pays now: {@link PlaceOrderDeskSaleRequest.payment} is
 *   **required**, and the order comes back already `fulfilled`.
 * - `pickup` — collected later. Needs a customer, takes **no** address, pays on collection.
 * - `delivery` — needs a customer **and** one of that customer's addresses; pays at the door.
 *
 * Ordered counter-first because that is the shortest sale and the one a counter makes most often.
 */
export const ORDER_DESK_FULFILMENT_TYPES = [
    'counter',
    'pickup',
    'delivery',
] as const satisfies readonly KitchenOrderFulfilmentType[];
export type OrderDeskFulfilmentType = (typeof ORDER_DESK_FULFILMENT_TYPES)[number];

/**
 * One line as the desk sends it — one tap, or several merged.
 *
 * Both endpoints merge lines naming the same `(article, pack)` into one whose quantity is the sum,
 * first-seen position preserved, because `order_lines` holds one row per article. The client
 * aggregates too, so the number the agent reads out is the number that will be charged.
 */
export interface OrderDeskBasketLine {
    readonly catalogueItemId: string;
    /** `null` for an article sold plain. An article and the same article in a pack are two lines. */
    readonly catalogueItemVariantId: string | null;
    /** A decimal string, never a number — a counter sells 0.35 kg as readily as three coffees. */
    readonly quantity: string;
}

/** Everything a quote and a sale share. A sale adds only how the customer is paying. */
export interface OrderDeskSaleRequest {
    readonly fulfilmentType: OrderDeskFulfilmentType;
    readonly lines: readonly OrderDeskBasketLine[];
    /**
     * Which branch produces this. **Not a filter**: it decides which cut-off applies and which
     * branch-scoped delivery zone wins, both of which change the answer.
     */
    readonly branchId?: BranchId | undefined;
    /** Required for pickup and delivery. Resolved by identifier, never inferred from the caller. */
    readonly customerAccountId?: string | undefined;
    /** Delivery only, and it must belong to `customerAccountId` — one that does not is a `404`. */
    readonly customerAddressId?: string | undefined;
    /** `YYYY-MM-DD`. Applies to a pickup as well as a delivery; a counter sale has no day. */
    readonly requestedDeliveryDate?: string | undefined;
    readonly deliveryWindowCode?: string | undefined;
}

/**
 * One thing standing between this basket and a sale, **as data**.
 *
 * Refusals arrive on a `200` from the quote and inside the `409` envelope from the placement — they
 * are not errors, they are the answer. `reason` is a stable machine key; `context` is whatever
 * identifies the offending thing (`catalogueItemId` on a line refusal, `cutOffAt` on a schedule
 * one), carried through untyped because the two endpoints extend that vocabulary together and
 * pinning the context keys per reason would freeze it.
 *
 * Line-level reasons: `item_unknown`, `item_not_published`, `variant_unknown`, `variant_not_active`,
 * `channel_unavailable`, `unpriced`, `currency_mismatch`, `channel_not_trading`. Order-level:
 * `customer_required`, `address_required`, `address_not_applicable`, `address_not_deliverable`,
 * `area_not_served`, `zone_suspended`, `currency_mismatch`, `cut_off_passed`, `branch_closed`,
 * `date_in_the_past`.
 */
export interface OrderDeskRefusal {
    readonly reason: string;
    /** Everything the wire sent alongside `reason`, in wire casing. Rendered, never branched on. */
    readonly context: Readonly<Record<string, unknown>>;
}

/**
 * One line of the quote, priced or explained.
 *
 * The price-bearing fields are **null together** whenever the line was refused: there is no price to
 * show for an article the kitchen has withdrawn, and a zero would read as free. `refusals` says why;
 * an empty array says the line is sellable.
 */
export interface OrderDeskQuoteLine {
    readonly catalogueItemId: string;
    readonly catalogueItemVariantId: string | null;
    /** The **merged** quantity — duplicate taps summed, because that is what will be charged. */
    readonly quantity: string;
    /** Null when the article could not be read at all — another kitchen's, or one since deleted. */
    readonly nameEn: string | null;
    readonly nameAr: string | null;
    readonly unitPriceMinor: number | null;
    /** Rounded once at the line total, so rounding cannot compound across an order. */
    readonly lineTotalMinor: number | null;
    readonly currencyCode: CurrencyCode;
    readonly refusals: readonly OrderDeskRefusal[];
}

/**
 * What this basket would come to, and everything standing in the way of it.
 *
 * **The totals are summed over the refusal-free lines only**, and they are offered even when the
 * sale cannot proceed, because "drop the soup and it comes to eleven dollars" is the agent's next
 * sentence. They are not what would be charged — that is what {@link OrderDeskQuote.quotable} is
 * for, and it is false whenever *any* refusal exists at all.
 */
export interface OrderDeskQuote {
    readonly lines: readonly OrderDeskQuoteLine[];
    readonly subtotalMinor: number;
    /**
     * **Null rather than zero when no fee applies.** Zero is a fee somebody decided on — a
     * free-delivery zone — and a pickup or a counter sale has no fee at all. Null also when the
     * destination was refused, because an unserved area has no fee to quote.
     */
    readonly deliveryFeeMinor: number | null;
    readonly totalMinor: number;
    /** The desk channel's own tariff currency. Nothing is ever converted. */
    readonly currencyCode: CurrencyCode;
    /** Order-level refusals — the shape, the destination, the schedule. Line refusals are on lines. */
    readonly refusals: readonly OrderDeskRefusal[];
    readonly quotable: boolean;
}

/**
 * Money handed over at the counter, recorded as it happens.
 *
 * Present on a `counter` sale and **refused on the other two**, because that is what the three words
 * mean: a walk-in pays now, and a counter order left unpaid would be a pickup wearing the wrong
 * label. A delivery is settled at the door and a pickup on collection, both afterwards through the
 * receipts operation, recorded by whoever actually took the money.
 *
 * **There is no amount.** The receipt is written for exactly the order's total. A discrepancy at the
 * till is a till problem, not an order problem.
 */
export interface OrderDeskCounterPayment {
    /**
     * How the money turned up — deliberately **not** constrained to equal the order's
     * `paymentMethod`. A sale taken as cash and settled by a WISH transfer while the customer stood
     * there is an ordinary evening.
     */
    readonly method: KitchenOrderPaymentMethod;
    /** The transfer identifier on a WISH payment. Confidential at rest. */
    readonly reference?: string | undefined;
    readonly notes?: string | undefined;
}

export interface PlaceOrderDeskSaleRequest extends OrderDeskSaleRequest {
    /** Required on every placement — the intent recorded on the order. */
    readonly paymentMethod: KitchenOrderPaymentMethod;
    /** Required on `counter`, **prohibited** on the other two. A `422` either way. */
    readonly payment?: OrderDeskCounterPayment | undefined;
}

/** How a customer record came to exist. `staff` is a caller some kitchen wrote down at a desk. */
export const ORDER_DESK_CUSTOMER_ORIGINS = [
    'self_service',
    'guest',
    'b2b_provisioning',
    'staff',
    'import',
] as const;
export type OrderDeskCustomerOrigin = (typeof ORDER_DESK_CUSTOMER_ORIGINS)[number];

/**
 * A customer as the order desk sees them: enough to pick the right one out of a list of five, and
 * nothing more.
 *
 * The disclosure is a name and a number — the same pair the queue row carries, behind the same
 * permission code, because a search revealing more than the queue would make the queue's gating
 * pointless. No email, no account identifier, no addresses, no order history.
 */
export interface OrderDeskCustomer {
    readonly id: string;
    /** Null on an anonymised account. */
    readonly displayName: string | null;
    /** E.164, as the contact point stores it. Served verified or not. */
    readonly phone: string | null;
    readonly origin: OrderDeskCustomerOrigin;
    /** Whether **this** kitchen holds at least one order against the account — a regular. */
    readonly hasOrdersWithOrg: boolean;
}

/**
 * One customer search.
 *
 * Carries `limit` as well as the rows because there is **no second page**: the agent has somebody on
 * the telephone, and the answer to a full list is a longer query. A screen that showed exactly
 * `limit` rows without saying so would look like it had found them all.
 */
export interface OrderDeskCustomerSearch {
    readonly rows: readonly OrderDeskCustomer[];
    readonly limit: number;
}

export interface CreateOrderDeskCustomerRequest {
    /** One field rather than a given/family pair — the platform's customer may be a company. */
    readonly displayName: string;
    /**
     * **Required, because a cold caller is a telephone number.** Already in E.164, or a `422`: the
     * platform does not infer a country code from a local number, because guessing would send
     * somebody else's handset a passcode.
     */
    readonly phone: string;
    readonly preferredLanguageCode?: string | undefined;
    readonly countryCode?: string | undefined;
}

/**
 * A newly written customer, and who else already answers to that number.
 *
 * `possibleDuplicates` is a **warning, never a refusal**: two customers genuinely share a telephone
 * — a household, a reception desk, an office floor — and refusing would make an existing customer's
 * flatmate unserveable at a counter with somebody waiting. Always present; usually empty.
 */
export interface OrderDeskCustomerCreated {
    readonly customer: OrderDeskCustomer;
    readonly possibleDuplicates: readonly OrderDeskCustomer[];
}

/**
 * An address written down for a customer at the desk.
 *
 * `deliveryAreaId` is a foreign key into the platform gazetteer and **never free text** — matching a
 * typed area name against a delivery zone is how an order gets accepted for somewhere nobody drives
 * to. Whether anybody serves it is answered at save time, as `isDeliverable`.
 */
export interface AddOrderDeskCustomerAddressRequest {
    readonly customerAccountId: string;
    readonly deliveryAreaId: string;
    readonly label?: string | undefined;
    readonly lineOne: string;
    readonly lineTwo?: string | undefined;
    readonly building?: string | undefined;
    readonly floor?: string | undefined;
    readonly apartment?: string | undefined;
    readonly directions?: string | undefined;
    readonly postalCode?: string | undefined;
}

/** The saved address, as much of it as the desk needs to name it again. */
export interface OrderDeskCustomerAddress {
    readonly id: string;
    readonly label: string | null;
    readonly lineOne: string;
    readonly lineTwo: string | null;
    readonly deliveryAreaId: string;
    /**
     * Whether anybody serves this area **today**, recomputed on every read — not the same as "was
     * accepted": a zone can be paused after an address was saved.
     */
    readonly isDeliverable: boolean;
}

export interface OrderDeskRepository {
    /**
     * The open queue in due order, capped, with the day and clock it was measured against.
     *
     * Answers {@link OrderDeskQueue} rather than a bare array because `meta.truncated` is not
     * decoration — a screen that dropped it would show a capped list as if it were the whole one.
     */
    listQueue(filters?: OrderDeskQueueFilters): Promise<OrderDeskQueue>;

    /**
     * What this basket would come to. **The only price authority on this surface.**
     *
     * No client ever computes a desk total: the tariff that prices the counter is resolved
     * server-side through the desk channel's own price lists, in priority order, and a number
     * derived any other way would disagree with the sale that follows it. Refusals come back on a
     * `200` as data.
     */
    quoteSale(request: OrderDeskSaleRequest): Promise<OrderDeskQuote>;

    /**
     * Sell it.
     *
     * Answers the order as the kitchen sees it: `placed` on a delivery or a pickup, and **already
     * `fulfilled`** on a counter sale — one call performs the whole till transaction, so there is
     * nothing left for the agent to do afterwards. A refused placement is a `409`
     * `order.placement_refused` carrying its reasons; it is **never** retried automatically.
     */
    placeSale(request: PlaceOrderDeskSaleRequest): Promise<KitchenOrder>;

    /**
     * Find the customer this sale is for. **Three characters minimum** — the server refuses less
     * with a `422`, and the screen mirrors the gate so a two-letter query is a hint rather than an
     * error.
     */
    searchCustomers(query: string): Promise<OrderDeskCustomerSearch>;

    /** Write down a cold caller. Answers the new row **and** who else already has that number. */
    createCustomer(request: CreateOrderDeskCustomerRequest): Promise<OrderDeskCustomerCreated>;

    /**
     * Add an address to a customer, for a delivery.
     *
     * There is no operation to *list* a customer's addresses from the desk, so every delivery taken
     * here writes the destination down as the caller gives it. See the sale screen's own note.
     */
    addCustomerAddress(
        request: AddOrderDeskCustomerAddressRequest,
    ): Promise<OrderDeskCustomerAddress>;

    /**
     * Give a run to a driver — **the one write on this surface that is lock-versioned**.
     *
     * `request.lockVersion` is the *job's*, read from {@link OrderDeskQueueRow.deliveryJob}, never
     * the order's: the two rows have separate validators and assigning a driver does not touch the
     * order. It is required, and required by this signature rather than by the server alone — the
     * endpoint answers `428 request.precondition_required` when the header is absent, which is a
     * round trip spent learning something the caller already held.
     *
     * Three refusals are worth telling apart at the call site, and all three arrive as failures
     * rather than as data (this is a write, not a quote):
     *
     * - **`409 resource.conflict`** — two different situations under one code. A lost race carries
     *   `currentLockVersion`, which is the value to reload against. A job that has already finished
     *   carries **none**: the endpoint names the terminal state in `details.status`, but
     *   `contracts/failure.ts` normalises this code down to the optional version and drops the rest,
     *   so on this client the two are told apart by whether a number came back. That is the right
     *   distinction anyway — re-reading will not make a delivered job assignable.
     * - **`422 validation.failed`** — `fields.driver_user_id`: the named person is not an active
     *   member here. A fact about the *person*, correctable in a picker.
     * - **`404`** — another organisation's job, decided before the body is read. Never a `403`,
     *   because confirming that the identifier names something real is itself a disclosure.
     *
     * Answers the job with its **new** validator, so a board can offer a reassignment immediately
     * without a re-read.
     *
     * **There is no operation on this client that lists the people this call names.** No endpoint
     * anywhere on the wire serves an organisation's members, so nothing here can turn a driver into
     * a name a screen could offer. The identifier has to come from somewhere that already holds one.
     */
    assignDeliveryJob(request: AssignDeliveryJobRequest): Promise<AssignedDeliveryJob>;
}
