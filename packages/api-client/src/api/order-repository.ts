import { OrderId, isCurrencyCode } from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import type {
    DeliveryAddress,
    PlaceOrderRequest,
    PlacedOrder,
    PlacedOrderLine,
    PriceLine,
} from '../contracts/commerce.ts';
import { ApiError, apiFailure, validationFailure } from '../contracts/failure.ts';
import type { OrderState } from '../contracts/commerce.ts';
import type {
    CustomerOrder as WireOrder,
    CustomerOrderDelivery as WireDelivery,
    CustomerOrderLine as WireOrderLine,
} from '../generated/types.ts';
import { generateRequestId } from './config.ts';
import type { Transport } from './transport.ts';

/**
 * Placing a one-off order, over HTTP.
 *
 * The only *command* on the commerce surface, and the reason the contract could grow one at all is
 * that it takes no payment: a Healthy360 one-off order is cash on delivery, so placing it creates
 * an obligation to cook and to drive and charges nothing. There is no instrument field on this
 * request, and adding one would be a visible change here rather than a value passed through.
 *
 * ## The idempotency key is per attempt, and generated here
 *
 * `POST /orders` runs behind the `idempotency` middleware: the same key with the same body is
 * *replayed* — the server answers the order it already created — and the same key with a different
 * body is refused with `request.idempotency_key_reused`. That is precisely the behaviour a mobile
 * client needs on the one request it must never duplicate: a dropped connection on a placement is
 * indistinguishable, from the device, between "nothing happened" and "the order exists and the
 * answer was lost", and a retry with the same key resolves it.
 *
 * The key is generated in this file rather than taken from the caller for the same reason the
 * `X-Client-Request-Id` is: a screen that had to remember it is a screen that will eventually
 * forget, and forgetting means two dinners. It is a fresh UUID per *attempt* — one press of the
 * button — so a person who genuinely wants a second identical order gets one.
 *
 * ## The wire is bilingual and the contract is not
 *
 * `CustomerOrderLine` carries `name_en` and `name_ar`, and `CustomerOrderDelivery` carries both
 * area names. This projection is the one the *person who placed the order* reads, and they have
 * already chosen a language — which the transport sends as `Accept-Language`. The mapper takes the
 * English name and records that as a limitation rather than pretending otherwise: a confirmation
 * screen in an Arabic build shows English line names until the endpoint honours the header, or
 * until `PlacedOrderLine` grows a `LocalisedText`, whichever a later phase decides.
 */

function money(amountMinor: number, currency: string): Money {
    if (!isCurrencyCode(currency)) {
        // An order this client cannot price is one whose confirmation must not claim a total. The
        // order exists — it was placed — so this is not a placement failure; it is a display one,
        // and it says so.
        throw new ApiError(
            apiFailure('server', {
                message:
                    'This order is priced in a currency this version of the app cannot display. ' +
                    'The order was placed; updating the app will show it correctly.',
                retryable: false,
            }),
        );
    }
    return { amount: amountMinor, currency };
}

/** The wire's four states against the contract's five; `preparing` has no fulfilment reporter yet. */
function mapState(status: WireOrder['status']): OrderState {
    return status === 'fulfilled' ? 'delivered' : status;
}

export function mapOrderLine(wire: WireOrderLine): PlacedOrderLine {
    return {
        id: wire.id,
        name:
            wire.variant_label === null ? wire.name_en : `${wire.name_en} — ${wire.variant_label}`,
        // A decimal string on the wire, because a weighed line may be fractional. An unparseable
        // value becomes one rather than `NaN`, which would render as "NaN × Chicken Shawarma".
        quantity: Number.parseFloat(wire.quantity) || 1,
        unitPrice: money(wire.unit_price_minor, wire.currency_code),
        lineTotal: money(wire.line_total_minor, wire.currency_code),
    };
}

export function mapOrderAddress(wire: WireDelivery): DeliveryAddress {
    return {
        label: wire.label ?? '',
        line1: wire.line_one ?? '',
        line2: wire.line_two,
        area: wire.area_name_en ?? '',
        city: wire.city ?? '',
        // The delivery projection names the area and the city but not the market. Guessing one from
        // the area would be inventing a fact about where somebody lives.
        countryCode: '',
        instructions: null,
    };
}

/**
 * The price breakdown, rebuilt from the three totals the endpoint sends.
 *
 * There is no `price_lines` array on the wire — a subtotal, an optional delivery fee and a total.
 * The breakdown is assembled from exactly those, with nothing invented: a discount the wire does
 * not send does not appear, and the codes match the ones `previewCheckout` already uses so a
 * confirmation reads like the review it followed.
 */
export function mapOrderPriceLines(wire: WireOrder): readonly PriceLine[] {
    const lines: PriceLine[] = [
        {
            code: 'subtotal',
            label: 'Subtotal',
            amount: money(wire.subtotal_minor, wire.currency_code),
        },
    ];
    if (wire.delivery_fee_minor !== null) {
        lines.push({
            code: 'delivery',
            label: 'Delivery',
            amount: money(wire.delivery_fee_minor, wire.currency_code),
        });
    }
    return lines;
}

export function mapPlacedOrder(wire: WireOrder): PlacedOrder {
    return {
        id: OrderId.unsafe(wire.id),
        reference: wire.order_number,
        state: mapState(wire.status),
        lines: wire.lines.map(mapOrderLine),
        priceLines: mapOrderPriceLines(wire),
        total: money(wire.total_minor, wire.currency_code),
        address: mapOrderAddress(wire.delivery),
        slotCode: wire.delivery.window_code ?? '',
        deliveryDate: wire.delivery.requested_date ?? '',
        placedAt: wire.placed_at,
    };
}

/** The one command, built per bundle because it holds the transport. */
export function createApiOrderPlacement(
    transport: Transport,
): (request: PlaceOrderRequest) => Promise<PlacedOrder> {
    return async function placeOrder(request: PlaceOrderRequest): Promise<PlacedOrder> {
        if (request.addressId.trim() === '') {
            throw new ApiError(
                validationFailure(
                    { addressId: ['Choose a delivery address before ordering.'] },
                    {
                        message:
                            'This order has no delivery address to resolve a zone, a window and ' +
                            'a fee from.',
                    },
                ),
            );
        }

        // `{ data: { order } }` on the wire, and the transport peels only the `data`. The second
        // level is the endpoint's own — `CustomerOrderEnvelope` — so it is peeled here, exactly the
        // way the cart surface peels `{ cart }`.
        const payload = await transport.request<{ order: WireOrder }>({
            method: 'POST',
            path: '/orders',
            // A fresh key per attempt. `generateRequestId` is the package's UUID source and already
            // degrades gracefully where `crypto.randomUUID` is missing, which some React Native
            // runtimes still are.
            headers: { 'Idempotency-Key': generateRequestId() },
            body: {
                cart_id: String(request.cartId),
                customer_address_id: request.addressId,
                delivery_window_code:
                    request.slotCode === undefined || request.slotCode === ''
                        ? null
                        : request.slotCode,
                requested_delivery_date:
                    request.deliveryDate === undefined || request.deliveryDate === ''
                        ? null
                        : request.deliveryDate,
            },
        });

        return mapPlacedOrder(payload.order);
    };
}
