import type { KitchenOrder } from '../contracts/kitchen-orders.ts';
import type {
    AddOrderDeskCustomerAddressRequest,
    CreateOrderDeskCustomerRequest,
    OrderDeskBasketLine,
    OrderDeskCustomerAddress,
    OrderDeskCustomerCreated,
    OrderDeskCustomerSearch,
    OrderDeskQueue,
    OrderDeskQueueFilters,
    OrderDeskQuote,
    OrderDeskRepository,
    OrderDeskSaleRequest,
    PlaceOrderDeskSaleRequest,
} from '../contracts/order-desk.ts';
import type {
    CustomerAddressEnvelope,
    KitchenOrder as WireKitchenOrder,
    OrderDeskBasketLine as WireOrderDeskBasketLine,
    OrderDeskCustomer as WireOrderDeskCustomer,
    OrderDeskCustomerEnvelope,
    OrderDeskCustomersEnvelope,
    OrderDeskQuote as WireOrderDeskQuote,
    OrderDeskQueueEnvelope,
    OrderDeskRow as WireOrderDeskRow,
    OrderDeskSaleBase,
    PlaceOrderDeskRequest,
} from '../generated/types.ts';
import { generateRequestId } from './config.ts';
import { mapKitchenOrder } from './kitchen-orders-repository.ts';
import {
    mapOrderDeskCustomer,
    mapOrderDeskCustomerAddress,
    mapOrderDeskCustomerCreated,
    mapOrderDeskQueueMeta,
    mapOrderDeskQueueRow,
    mapOrderDeskQuote,
} from './order-desk-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * The Order Desk queue, backed by the real Laravel route under `/catalogue/order-desk`.
 *
 * ## One read, no cursor, and `meta` is not optional here
 *
 * `kitchen-orders-repository.ts` uses `requestEnvelope` to lift a cursor out of `meta`; this module
 * uses it because `meta` carries the *answer's own terms* — how many rows the server will ever give,
 * whether it hit that ceiling, and which day on whose clock the window was measured from. A screen
 * that dropped them would render a capped queue as if it were the whole book, and would have no way
 * to say which "today" it is showing. So the envelope is answered whole (`{ rows, meta }`) rather
 * than as a bare array.
 *
 * ## The query string
 *
 * Every filter is optional and every omitted one means "do not narrow" — the server defaults the
 * window to `today` and lists both open statuses. Two details are worth stating.
 *
 * **`status` is sent in PHP's bracket form** (`status[]=placed`). Repeated bare parameters
 * (`status=placed&status=confirmed`) do not survive PHP — they collapse to the last value — and the
 * controller validates `status` as an `array`. The OpenAPI document declares the parameter as
 * `status[]` for exactly this reason, and the bracket form is what the endpoint's own Pest suite
 * sends (`http_build_query(['status' => ['placed']])`).
 *
 * **`branch_id` is a query parameter, not the `X-Branch-Id` header** the stock surfaces send. That
 * is the endpoint's convention for the whole `order-desk` family and it is deliberate: an
 * organisation-wide desk agent selects no branch, so a header that had to be present could not
 * express the organisation-wide read. See `contracts/order-desk.ts`.
 *
 * ## The writes, and the one thing they all have in common
 *
 * Selling adds five operations, and none of them is lock-versioned: there is no `If-Match` anywhere
 * on this surface because nothing here *edits* an existing row — a sale creates one. The lifecycle
 * writes an order needs afterwards are still `kitchenOrders`' (the same rows, the same
 * `lockVersion`, one contract), and duplicating them behind a desk-shaped name would give two
 * modules the ability to move the same order with two different ideas of what version they hold.
 *
 * **`Idempotency-Key` is minted here, per attempt, and no screen can forget it.** Two of these
 * operations create records that cannot be un-created — an order and a customer account — and the
 * server refuses both with a `400` when the header is absent. Minting it in the repository is the
 * same rule `order-repository.ts` and `guest-repository.ts` follow, and *per attempt* is the
 * important half: a key held by a screen would make a deliberate second attempt (the agent fixed
 * the basket and pressed again) replay the first answer instead of placing the corrected sale.
 * Double-submit protection is the button's pending state, which is a different problem.
 *
 * ## Refusals are not failures
 *
 * `quoteSale` answers a `200` whose body may say the sale is impossible, and it is returned as data
 * rather than thrown: the agent needs the total of the lines that *are* sellable while they take
 * the refused one off the order. A refused **placement** is a real `409` and does throw — see the
 * screen, which renders its reasons and never retries.
 */

/** Same shape as `kitchen-orders-repository.ts`'s `ordersQuery`, narrowed to this endpoint's filters. */
function queueQuery(filters?: OrderDeskQueueFilters): string {
    if (filters === undefined) return '';

    const search = new URLSearchParams();
    if (filters.window !== undefined) search.set('window', filters.window);
    if (filters.branchId !== undefined) search.set('branch_id', String(filters.branchId));
    for (const status of filters.statuses ?? []) {
        // Bracket form, not `style: form` — see the header. An empty array appends nothing, which
        // is the same request as no filter at all and the same answer the server gives it.
        search.append('status[]', status);
    }
    if (filters.deliveryWindowCode !== undefined) {
        search.set('delivery_window_code', filters.deliveryWindowCode);
    }
    if (filters.query !== undefined && filters.query.trim() !== '') {
        search.set('query', filters.query.trim());
    }

    const rendered = search.toString();
    return rendered === '' ? '' : `?${rendered}`;
}

/** One basket line, in the wire's own casing. */
function wireLine(line: OrderDeskBasketLine): WireOrderDeskBasketLine {
    return {
        catalogue_item_id: line.catalogueItemId,
        // Sent as `null` rather than omitted: the wire's merge treats `(item, null)` and
        // `(item, variant)` as two different articles, and an omitted key would leave the reading of
        // a plain article to a default this client does not own.
        catalogue_item_variant_id: line.catalogueItemVariantId,
        quantity: line.quantity,
    };
}

/**
 * The fields a quote and a placement share.
 *
 * Optional fields are **omitted when absent rather than sent as `null`**, because the two are not
 * the same request here: `customer_address_id: null` on a counter sale is a caller naming a field
 * that shape forbids, and the server would be within its rights to refuse it
 * (`address_not_applicable`). Omitted is "I am not telling you about this", which is what a counter
 * sale means.
 */
function saleBody(request: OrderDeskSaleRequest): OrderDeskSaleBase {
    return {
        fulfilment_type: request.fulfilmentType,
        lines: request.lines.map(wireLine),
        ...(request.branchId === undefined ? {} : { branch_id: String(request.branchId) }),
        ...(request.customerAccountId === undefined
            ? {}
            : { customer_account_id: request.customerAccountId }),
        ...(request.customerAddressId === undefined
            ? {}
            : { customer_address_id: request.customerAddressId }),
        ...(request.requestedDeliveryDate === undefined
            ? {}
            : { requested_delivery_date: request.requestedDeliveryDate }),
        ...(request.deliveryWindowCode === undefined
            ? {}
            : { delivery_window_code: request.deliveryWindowCode }),
    };
}

export function createApiOrderDeskRepository(transport: Transport): OrderDeskRepository {
    return {
        async listQueue(filters?: OrderDeskQueueFilters): Promise<OrderDeskQueue> {
            const envelope = await transport.requestEnvelope<readonly WireOrderDeskRow[]>({
                method: 'GET',
                path: `/catalogue/order-desk/queue${queueQuery(filters)}`,
            });

            return {
                rows: envelope.data.map(mapOrderDeskQueueRow),
                meta: mapOrderDeskQueueMeta(envelope.meta as OrderDeskQueueEnvelope['meta']),
            };
        },

        async quoteSale(request: OrderDeskSaleRequest): Promise<OrderDeskQuote> {
            const payload = await transport.request<{ readonly quote: WireOrderDeskQuote }>({
                method: 'POST',
                path: '/catalogue/order-desk/quote',
                body: saleBody(request),
            });
            return mapOrderDeskQuote(payload.quote);
        },

        async placeSale(request: PlaceOrderDeskSaleRequest): Promise<KitchenOrder> {
            const body: PlaceOrderDeskRequest = {
                ...saleBody(request),
                payment_method: request.paymentMethod,
                // Present on a counter sale, absent on the other two — a `422` either way, so the
                // key is spread rather than set to `undefined`, which `exactOptionalPropertyTypes`
                // would allow through as a present-but-empty field.
                ...(request.payment === undefined
                    ? {}
                    : {
                          payment: {
                              method: request.payment.method,
                              ...(request.payment.reference === undefined
                                  ? {}
                                  : { reference: request.payment.reference }),
                              ...(request.payment.notes === undefined
                                  ? {}
                                  : { notes: request.payment.notes }),
                          },
                      }),
            };

            const payload = await transport.request<{ readonly order: WireKitchenOrder }>({
                method: 'POST',
                path: '/catalogue/order-desk/orders',
                // A fresh key per attempt — see the header.
                headers: { 'Idempotency-Key': generateRequestId() },
                body,
            });
            return mapKitchenOrder(payload.order);
        },

        async searchCustomers(query: string): Promise<OrderDeskCustomerSearch> {
            const search = new URLSearchParams({ query: query.trim() });
            const envelope = await transport.requestEnvelope<readonly WireOrderDeskCustomer[]>({
                method: 'GET',
                path: `/catalogue/order-desk/customers?${search.toString()}`,
            });

            const meta = envelope.meta as OrderDeskCustomersEnvelope['meta'];
            return {
                rows: envelope.data.map(mapOrderDeskCustomer),
                limit: meta.limit,
            };
        },

        async createCustomer(
            request: CreateOrderDeskCustomerRequest,
        ): Promise<OrderDeskCustomerCreated> {
            const payload = await transport.request<OrderDeskCustomerEnvelope['data']>({
                method: 'POST',
                path: '/catalogue/order-desk/customers',
                headers: { 'Idempotency-Key': generateRequestId() },
                body: {
                    display_name: request.displayName,
                    phone: request.phone,
                    ...(request.preferredLanguageCode === undefined
                        ? {}
                        : { preferred_language_code: request.preferredLanguageCode }),
                    ...(request.countryCode === undefined
                        ? {}
                        : { country_code: request.countryCode }),
                },
            });
            return mapOrderDeskCustomerCreated(payload);
        },

        async addCustomerAddress(
            request: AddOrderDeskCustomerAddressRequest,
        ): Promise<OrderDeskCustomerAddress> {
            // No `Idempotency-Key` here, and that is the operation's own decision rather than an
            // omission: a duplicated address is a visible, correctable row on a customer's book,
            // not an unrecoverable write, so the header is not required and sending one would claim
            // a guarantee this endpoint does not offer.
            const payload = await transport.request<CustomerAddressEnvelope['data']>({
                method: 'POST',
                path: `/catalogue/order-desk/customers/${encodeURIComponent(
                    request.customerAccountId,
                )}/addresses`,
                body: {
                    delivery_area_id: request.deliveryAreaId,
                    line_one: request.lineOne,
                    ...(request.label === undefined ? {} : { label: request.label }),
                    ...(request.lineTwo === undefined ? {} : { line_two: request.lineTwo }),
                    ...(request.building === undefined ? {} : { building: request.building }),
                    ...(request.floor === undefined ? {} : { floor: request.floor }),
                    ...(request.apartment === undefined ? {} : { apartment: request.apartment }),
                    ...(request.directions === undefined ? {} : { directions: request.directions }),
                    ...(request.postalCode === undefined
                        ? {}
                        : { postal_code: request.postalCode }),
                },
            });
            return mapOrderDeskCustomerAddress(payload.address);
        },
    };
}
