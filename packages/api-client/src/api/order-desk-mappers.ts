import type { CurrencyCode } from '@healthy360/domain-types';

import type {
    AssignedDeliveryJob,
    OrderDeskCalendarCounts,
    OrderDeskCalendarDay,
    OrderDeskCalendarMeta,
    OrderDeskCalendarWindow,
    OrderDeskCashReportMeta,
    OrderDeskCashReportRow,
    OrderDeskCashReportTotal,
    OrderDeskCustomer,
    OrderDeskCustomerAddress,
    OrderDeskCustomerContact,
    OrderDeskCustomerCreated,
    OrderDeskDeliveryJob,
    OrderDeskDriver,
    OrderDeskNotComputable,
    OrderDeskPaymentSummary,
    OrderDeskQueueMeta,
    OrderDeskQueueRow,
    OrderDeskQuote,
    OrderDeskQuoteLine,
    OrderDeskRefusal,
    OrderDeskRequirement,
    OrderDeskRequirementsMeta,
    OrderDeskShortfallCount,
} from '../contracts/order-desk.ts';
import type {
    AssignedDeliveryJob as WireAssignedDeliveryJob,
    CustomerAddress as WireCustomerAddress,
    OrderDeskCalendarCounts as WireCalendarCounts,
    OrderDeskCalendarDay as WireCalendarDay,
    OrderDeskCalendarEnvelope,
    OrderDeskCalendarWindow as WireCalendarWindow,
    OrderDeskCashReportEnvelope,
    OrderDeskCashReportRow as WireCashReportRow,
    OrderDeskCashReportTotal as WireCashReportTotal,
    OrderDeskCustomer as WireOrderDeskCustomer,
    OrderDeskCustomerContact as WireOrderDeskCustomerContact,
    OrderDeskCustomerEnvelope,
    OrderDeskDeliveryJob as WireOrderDeskDeliveryJob,
    OrderDeskDriver as WireOrderDeskDriver,
    OrderDeskNotComputable as WireOrderDeskNotComputable,
    OrderDeskQuote as WireOrderDeskQuote,
    OrderDeskQuoteLine as WireOrderDeskQuoteLine,
    OrderDeskQuoteRefusal as WireOrderDeskRefusal,
    OrderDeskQueueEnvelope,
    OrderDeskRequirementRow as WireOrderDeskRequirement,
    OrderDeskRequirementsEnvelope,
    OrderDeskRow as WireOrderDeskRow,
    OrderDeskShortfallCountEnvelope,
    OrderPaymentSummary as WireOrderPaymentSummary,
} from '../generated/types.ts';
import { mapKitchenOrder } from './kitchen-orders-repository.ts';

/**
 * The queue's two wire shapes, in domain terms.
 *
 * Its own file rather than functions at the top of `order-desk-repository.ts` — the naming follows
 * `driver-jobs-mappers.ts` / `kitchen-admin-mappers.ts` / `plan-mappers.ts`, and the split keeps the
 * repository about transport: the path, the query string and the one read.
 *
 * ## The row is composed, not copied
 *
 * `OrderDeskRow` is `KitchenOrder & {…}` on the wire and {@link OrderDeskQueueRow} extends
 * `KitchenOrder` in the contract, so the mapping is {@link mapKitchenOrder} plus the four fields the
 * desk adds. Restating the twenty kitchen-order fields here would be a second copy of a mapping that
 * already exists and already has a test — and the day the order shape gains a column, one of the two
 * copies would get it.
 */

function mapCustomer(wire: WireOrderDeskCustomerContact): OrderDeskCustomerContact {
    return {
        displayName: wire.display_name,
        phone: wire.phone,
    };
}

/**
 * One queue row.
 *
 * `customer` is spread conditionally rather than assigned as `wire.customer ?? undefined`, because
 * the *presence* of the key is the disclosure signal — see `contracts/order-desk.ts`. An absent
 * block means "you may not read contact details"; a present block with `display_name: null` means
 * "this account has no name". Writing `customer: undefined` unconditionally would erase that
 * difference under `exactOptionalPropertyTypes`, and a screen would have no way to tell a refusal
 * from an anonymised customer.
 *
 * `delivery_job` keeps its `null` rather than being defaulted to an empty object: a run that exists
 * with nothing in it is the one reading of that field which is never true, and the absence is a real
 * answer about three different orders — see `contracts/order-desk.ts`.
 */
export function mapOrderDeskQueueRow(wire: WireOrderDeskRow): OrderDeskQueueRow {
    return {
        ...mapKitchenOrder(wire),
        dueAt: wire.due_at,
        payment: mapPaymentSummary(wire.payment),
        deliveryJob: wire.delivery_job === null ? null : mapOrderDeskDeliveryJob(wire.delivery_job),
        ...(wire.customer === undefined ? {} : { customer: mapCustomer(wire.customer) }),
    };
}

/**
 * The run an order became.
 *
 * Both status axes are assigned straight across rather than narrowed or defaulted, on the same terms
 * as `driver-jobs-mappers.ts`: the generated unions *are* this contract's unions, so the compiler
 * proves the two vocabularies agree and the day the wire gains a seventh dispatch state this line
 * stops building — which is the right place to find out. A `?? 'pending'` fallback would put a row
 * on the board claiming a job had not started.
 *
 * `lock_version` is read without a fallback for a sharper reason: it is the validator an assignment
 * sends, and a defaulted zero would be a *plausible* value that loses the race it was meant to win.
 */
export function mapOrderDeskDeliveryJob(wire: WireOrderDeskDeliveryJob): OrderDeskDeliveryJob {
    return {
        id: wire.id,
        status: wire.status,
        trackingStatus: wire.tracking_status,
        driverUserId: wire.driver_user_id,
        assignedAt: wire.assigned_at,
        lockVersion: wire.lock_version,
    };
}

/**
 * The job as it stands after an assignment.
 *
 * Composed from {@link mapOrderDeskDeliveryJob} plus the one field the response adds, because the
 * wire shape is that superset and restating six fields here would be a second copy of a mapping that
 * already has a test. Nothing is re-derived — in particular `status` is not assumed to be `assigned`
 * — because what an assignment does to either axis is the server's decision to report.
 */
export function mapAssignedDeliveryJob(wire: WireAssignedDeliveryJob): AssignedDeliveryJob {
    return {
        ...mapOrderDeskDeliveryJob(wire),
        orderId: wire.order_id,
    };
}

/**
 * Where the order stands on being paid.
 *
 * Every field is required on the wire and none is defaulted here. `received_minor` in particular is
 * never coerced from a missing value: zero received is a *position*, and inventing it for an absent
 * field would turn a wire fault into a confident "nothing has arrived yet".
 */
export function mapPaymentSummary(wire: WireOrderPaymentSummary): OrderDeskPaymentSummary {
    return {
        method: wire.method,
        receivedMinor: wire.received_minor,
        receipted: wire.receipted,
    };
}

/**
 * What the server measured the queue against.
 *
 * Read from the generated envelope's own meta type rather than re-declared, on the terms
 * `marketplace-mappers.ts` reads its cursor meta: every field here is required on the wire, so there
 * is nothing to default and no place for a fallback to invent a fact. In particular `truncated` is
 * never defaulted — a missing-and-therefore-false reading would tell a screen that a capped queue is
 * the whole one, which is exactly the silence this field exists to break.
 */
export function mapOrderDeskQueueMeta(wire: OrderDeskQueueEnvelope['meta']): OrderDeskQueueMeta {
    return {
        count: wire.count,
        limit: wire.limit,
        truncated: wire.truncated,
        window: wire.window,
        today: wire.today,
        timezone: wire.timezone,
    };
}

/* ------------------------------------------------------------------------------------------------
 * The calendar, and the people a run can be given to
 * ---------------------------------------------------------------------------------------------- */

/**
 * A day's three books.
 *
 * Field by field, with **nothing derived**. There is no total here and there will never be one: the
 * three overlap by construction, and the single most damaging thing this mapper could do is offer a
 * convenient `total` that a screen then renders. Adding a fourth field would also make the mapper
 * the place the rule gets broken, which is precisely where nobody looks for it.
 *
 * Nothing is defaulted either. Every count is required on the wire, and a `?? 0` would turn a
 * malformed response into a confident "nothing is due that day".
 */
export function mapCalendarCounts(wire: WireCalendarCounts): OrderDeskCalendarCounts {
    return {
        order: wire.order,
        scheduled: wire.scheduled,
        projected: wire.projected,
    };
}

/**
 * One slot's share of a day.
 *
 * `code` keeps its `null` rather than being widened to a string: the unslotted bucket is a real
 * bucket, and any placeholder invented here would be a word a kitchen could also have typed as a
 * genuine code — at which point two different things would render identically.
 */
export function mapCalendarWindow(wire: WireCalendarWindow): OrderDeskCalendarWindow {
    return { code: wire.code, counts: mapCalendarCounts(wire.counts) };
}

/**
 * One day.
 *
 * `windows` is mapped in the order it arrived — named slots then the unslotted bucket — because the
 * server ordered it and a client that re-sorted would be a second opinion about a sequence that
 * already has one. The **union across a week** is a different question, and it belongs to whichever
 * screen is drawing the week rather than to this mapper, which sees one day at a time.
 */
export function mapCalendarDay(wire: WireCalendarDay): OrderDeskCalendarDay {
    return {
        date: wire.date,
        counts: mapCalendarCounts(wire.counts),
        windows: wire.windows.map(mapCalendarWindow),
    };
}

/**
 * What the calendar was measured against.
 *
 * `max_window_days` is carried rather than dropped even though no request the client makes today
 * comes near it: it is the server's own ceiling, and a client that knows it can bound its range
 * instead of learning the limit from a `422` in front of somebody.
 */
export function mapCalendarMeta(wire: OrderDeskCalendarEnvelope['meta']): OrderDeskCalendarMeta {
    return {
        from: wire.from,
        to: wire.to,
        dayCount: wire.day_count,
        maxWindowDays: wire.max_window_days,
    };
}

/**
 * One shelf the window needs something of.
 *
 * Every field is carried across as it arrived and **nothing is defaulted**. The four quantities are
 * decimal strings and stay strings — a `Number()` here would be the client quietly disagreeing with
 * the server about how much flour to buy — and `unit_id`/`unit_code` keep their `null`, which is a
 * shelf with no resolved unit and takes the em dash rather than a guessed one.
 *
 * The two scales are different on purpose (`required` at six places, the rest at four) and are not
 * reconciled here: the operation explains why, and a mapper that rounded one to match the other
 * would be publishing a number neither side computed.
 */
export function mapOrderDeskRequirement(wire: WireOrderDeskRequirement): OrderDeskRequirement {
    return {
        ingredientId: wire.ingredient_id,
        stockItemId: wire.stock_item_id,
        code: wire.code,
        nameEn: wire.name_en,
        unitId: wire.unit_id,
        unitCode: wire.unit_code,
        required: wire.required,
        available: wire.available,
        short: wire.short,
        suggestedBuy: wire.suggested_buy,
    };
}

/**
 * The window's holes.
 *
 * `reasons` is passed through in the server's own casing because the keys are a **vocabulary rather
 * than a shape**: they are looked up for a label and counted, never destructured, and camel-casing
 * them here would invent client-side names for codes the server owns and may extend.
 */
export function mapOrderDeskNotComputable(
    wire: WireOrderDeskNotComputable,
): OrderDeskNotComputable {
    return { days: wire.days, reasons: wire.reasons };
}

/** What the buy list was measured against — the window, and the shelf `available` is about. */
export function mapOrderDeskRequirementsMeta(
    wire: OrderDeskRequirementsEnvelope['meta'],
): OrderDeskRequirementsMeta {
    return {
        from: wire.from,
        to: wire.to,
        branchId: wire.branch_id,
        maxWindowDays: wire.max_window_days,
    };
}

/**
 * The badge.
 *
 * `count` keeps its `null` and is **never coalesced to zero**. That single `??` would turn "nobody
 * chose a branch, so this is unknowable" into "everything is in stock" on a hub tile, which is the
 * one lie this endpoint was shaped to make impossible.
 */
export function mapOrderDeskShortfallCount(
    wire: OrderDeskShortfallCountEnvelope['data'],
): OrderDeskShortfallCount {
    return { count: wire.shortfall_count, branchId: wire.branch_id };
}

/**
 * One member of this organisation, as somebody a run can be given to.
 *
 * `display_name` keeps its `null` — a member whose profile was never completed is still assignable,
 * and substituting the identifier for the name here would put a UUID in a picker while claiming it
 * was a person. The em dash is the screen's to render, on the same terms as every other unknown.
 */
export function mapOrderDeskDriver(wire: WireOrderDeskDriver): OrderDeskDriver {
    return { userId: wire.user_id, displayName: wire.display_name };
}

/* ------------------------------------------------------------------------------------------------
 * The day's takings
 * ---------------------------------------------------------------------------------------------- */

/**
 * One agent's takings, one method, one currency.
 *
 * `display_name` keeps its `null` — an agent who never completed a profile still took the money, and
 * substituting the identifier here would put a UUID in a reconciliation while claiming it was a
 * person. `amount_minor_sum` is read without a fallback for a sharper reason: a defaulted zero on a
 * malformed field would be a confident "this agent took nothing", which is the one sentence a cash
 * report must never say by accident.
 */
export function mapOrderDeskCashReportRow(wire: WireCashReportRow): OrderDeskCashReportRow {
    return {
        confirmedBy: wire.confirmed_by,
        displayName: wire.display_name,
        method: wire.method,
        currencyCode: wire.currency_code as CurrencyCode,
        receiptCount: wire.receipt_count,
        amountMinorSum: wire.amount_minor_sum,
    };
}

/**
 * One method's total across the agents.
 *
 * Mapped from the wire rather than folded up from the rows here, even though the arithmetic is four
 * lines. The server derives both from the same query, so the two are guaranteed to agree; a client
 * that recomputed would be a second opinion that could only ever disagree — and the one way it would
 * disagree is by grouping on `method` alone and adding two currencies together.
 */
export function mapOrderDeskCashReportTotal(wire: WireCashReportTotal): OrderDeskCashReportTotal {
    return {
        method: wire.method,
        currencyCode: wire.currency_code as CurrencyCode,
        receiptCount: wire.receipt_count,
        amountMinorSum: wire.amount_minor_sum,
    };
}

/**
 * What the report was measured against.
 *
 * `timezone` is carried rather than dropped even though it is always `UTC` today: a screen that
 * printed a hard-coded word would go on printing it the day a shift table gives the boundary a real
 * clock, and the whole point of echoing it is that the reader is not left assuming their own
 * midnight.
 */
export function mapOrderDeskCashReportMeta(
    wire: OrderDeskCashReportEnvelope['meta'],
): OrderDeskCashReportMeta {
    return {
        date: wire.date,
        branchId: wire.branch_id,
        timezone: wire.timezone,
        count: wire.count,
    };
}

/* ------------------------------------------------------------------------------------------------
 * Selling
 * ---------------------------------------------------------------------------------------------- */

/**
 * One refusal, split into its stable key and everything else.
 *
 * The wire shape is `{ reason, ...context }` — an open bag whose extra keys differ per reason and
 * which both desk endpoints extend together. Splitting it here rather than passing the bag through
 * whole gives a screen one field it may branch on (`reason`) and one it may only render
 * (`context`), which is the distinction that keeps a client from growing a private copy of the
 * server's refusal vocabulary.
 *
 * The context is carried in **wire casing**, deliberately: these keys are not a contract, they are
 * evidence, and camel-casing them would invent domain names for facts no domain type declares.
 */
export function mapOrderDeskRefusal(wire: WireOrderDeskRefusal): OrderDeskRefusal {
    const { reason, ...context } = wire;
    return { reason, context };
}

/**
 * One quote line.
 *
 * The four price fields are passed through as they arrive, `null` and all. A refused line has no
 * price, and defaulting one to zero here would render "free" for an article the kitchen has
 * withdrawn — which is the single most expensive mistake this mapper could make.
 */
export function mapOrderDeskQuoteLine(wire: WireOrderDeskQuoteLine): OrderDeskQuoteLine {
    return {
        catalogueItemId: wire.catalogue_item_id,
        catalogueItemVariantId: wire.catalogue_item_variant_id,
        quantity: wire.quantity,
        nameEn: wire.name_en,
        nameAr: wire.name_ar,
        unitPriceMinor: wire.unit_price_minor,
        lineTotalMinor: wire.line_total_minor,
        currencyCode: wire.currency_code as CurrencyCode,
        refusals: wire.refusals.map(mapOrderDeskRefusal),
    };
}

/**
 * The whole quote.
 *
 * `quotable` is never derived here from "are there refusals?" even though the server computes it
 * that way: the server is the authority on what it would refuse, and a client that re-derived the
 * flag would eventually disagree with it about a reason it had not heard of yet.
 */
export function mapOrderDeskQuote(wire: WireOrderDeskQuote): OrderDeskQuote {
    return {
        lines: wire.lines.map(mapOrderDeskQuoteLine),
        subtotalMinor: wire.subtotal_minor,
        deliveryFeeMinor: wire.delivery_fee_minor,
        totalMinor: wire.total_minor,
        currencyCode: wire.currency_code as CurrencyCode,
        refusals: wire.refusals.map(mapOrderDeskRefusal),
        quotable: wire.quotable,
    };
}

export function mapOrderDeskCustomer(wire: WireOrderDeskCustomer): OrderDeskCustomer {
    return {
        id: wire.id,
        displayName: wire.display_name,
        phone: wire.phone,
        origin: wire.origin,
        hasOrdersWithOrg: wire.has_orders_with_org,
    };
}

/**
 * A newly written customer and its duplicate warning.
 *
 * `possible_duplicates` is always present on the wire and is mapped without a fallback: an empty
 * array is "nobody else has this number", and defaulting an absent field to `[]` would say the same
 * thing about a response that never answered the question.
 */
export function mapOrderDeskCustomerCreated(
    wire: OrderDeskCustomerEnvelope['data'],
): OrderDeskCustomerCreated {
    return {
        customer: mapOrderDeskCustomer(wire.customer),
        possibleDuplicates: wire.possible_duplicates.map(mapOrderDeskCustomer),
    };
}

/**
 * The address as saved.
 *
 * Narrowed to what the desk can act on rather than mapped whole: the wire answers the customer's
 * full address record — `address_type`, `is_default`, `lock_version`, `contact_point_id` — and none
 * of those is the desk's to read or to change. `is_deliverable` is the one computed field that
 * matters here, because it is what the agent tells the customer.
 */
export function mapOrderDeskCustomerAddress(wire: WireCustomerAddress): OrderDeskCustomerAddress {
    return {
        id: wire.id,
        label: wire.label ?? null,
        lineOne: wire.line_one,
        lineTwo: wire.line_two ?? null,
        deliveryAreaId: wire.delivery_area_id,
        isDeliverable: wire.is_deliverable,
    };
}
