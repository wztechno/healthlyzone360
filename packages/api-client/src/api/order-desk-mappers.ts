import type { CurrencyCode } from '@healthy360/domain-types';

import type {
    OrderDeskCustomer,
    OrderDeskCustomerAddress,
    OrderDeskCustomerContact,
    OrderDeskCustomerCreated,
    OrderDeskPaymentSummary,
    OrderDeskQueueMeta,
    OrderDeskQueueRow,
    OrderDeskQuote,
    OrderDeskQuoteLine,
    OrderDeskRefusal,
} from '../contracts/order-desk.ts';
import type {
    CustomerAddress as WireCustomerAddress,
    OrderDeskCustomer as WireOrderDeskCustomer,
    OrderDeskCustomerContact as WireOrderDeskCustomerContact,
    OrderDeskCustomerEnvelope,
    OrderDeskQuote as WireOrderDeskQuote,
    OrderDeskQuoteLine as WireOrderDeskQuoteLine,
    OrderDeskQuoteRefusal as WireOrderDeskRefusal,
    OrderDeskQueueEnvelope,
    OrderDeskRow as WireOrderDeskRow,
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
 * `delivery_job` is carried through as it arrives — always `null` in this phase, and deliberately
 * not defaulted to `{}`: an empty object would claim a run exists with nothing in it, which is the
 * one reading of that field that is never true.
 */
export function mapOrderDeskQueueRow(wire: WireOrderDeskRow): OrderDeskQueueRow {
    return {
        ...mapKitchenOrder(wire),
        dueAt: wire.due_at,
        payment: mapPaymentSummary(wire.payment),
        deliveryJob: wire.delivery_job,
        ...(wire.customer === undefined ? {} : { customer: mapCustomer(wire.customer) }),
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
