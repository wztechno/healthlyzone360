import {
    AllergenCode,
    BranchId,
    DeliveryZoneId,
    OrderId,
    PriceListId,
    isCurrencyCode,
} from '@healthy360/domain-types';
import type { CurrencyCode } from '@healthy360/domain-types';

import type {
    CancelKitchenOrderRequest,
    KitchenOrder,
    KitchenOrderDelivery,
    KitchenOrderFilters,
    KitchenOrderLine,
    KitchenOrderPage,
    KitchenOrderPaymentReceipt,
    KitchenOrderPaymentSummary,
    KitchenOrdersRepository,
    KitchenOrderTransitionRequest,
    RecordedKitchenOrderPayment,
    RecordKitchenOrderPaymentRequest,
} from '../contracts/kitchen-orders.ts';
import type {
    KitchenOrder as WireKitchenOrder,
    KitchenOrderDelivery as WireKitchenOrderDelivery,
    KitchenOrderLine as WireKitchenOrderLine,
    OrderPaymentReceipt as WireOrderPaymentReceipt,
    OrderPaymentSummary as WireOrderPaymentSummary,
    PaginationMeta,
    StorePaymentReceiptRequest,
} from '../generated/types.ts';
import { generateRequestId } from './config.ts';
import type { Transport } from './transport.ts';

/**
 * Kitchen-side orders, backed by the real Laravel routes under `/catalogue/orders`.
 *
 * ## `If-Match`, on every write and nowhere else
 *
 * Same convention as `kitchen-admin-writes.ts`: the header value is the lock version wrapped in
 * double quotes, which is the form the server hands back in `ETag` and the form its parser expects.
 * All four writes carry it. Two failures follow from that and both are surfaced verbatim rather
 * than translated:
 *
 * - **omitted** → `request.precondition_required` (which this module makes unreachable — the
 *   contract requires `lockVersion`, so there is no call shape that could forget it);
 * - **stale** → `resource.conflict`, "This order changed while you were working on it". The detail
 *   panel re-reads and offers the action again; nothing here retries, because a silent retry with a
 *   refreshed version is exactly the lost update the guard exists to prevent.
 *
 * An illegal transition is *also* `resource.conflict` (with `details.transition`), not a validation
 * failure — the request was well formed, the world had moved.
 *
 * ## Two response shapes, one endpoint family
 *
 * The list answers a **bare array** in `data` with the cursor in `meta`, so it needs
 * `requestEnvelope`; the single read and the three lifecycle writes answer `data.order`. That
 * asymmetry is the wire's, and it is read literally here rather than smoothed over.
 *
 * ## The fourth write is a payment, and it is here rather than on the order desk
 *
 * `recordPayment` is worked by a desk agent and every other operation that agent performs lives on
 * `order-desk-repository.ts`. It is here anyway, because that module's own header states the rule:
 * *the lifecycle writes an order needs are `kitchenOrders`', because duplicating them behind a
 * desk-shaped name would give two modules the ability to move the same order with two different
 * ideas of what version they hold.* This write sends the **order's** `lockVersion`, which is exactly
 * the discriminator that header drew — `assignDeliveryJob` sits on the desk because it carries the
 * *job's* validator instead. Audience follows surface, not the other way round.
 *
 * It is the one write here that does **not** answer `data.order`, and the one that does not bump the
 * version it sent: nothing on the order row is modified, so a screen may record two part payments in
 * a row without re-reading between them. It answers the receipt and the order's new payment position
 * together, because a screen needs both and a second read for the second would be a round trip for a
 * number the server has just computed.
 */

function currencyOf(code: string): CurrencyCode {
    return isCurrencyCode(code) ? code : 'USD';
}

function mapLine(wire: WireKitchenOrderLine): KitchenOrderLine {
    return {
        id: wire.id,
        catalogueItemId: wire.catalogue_item_id,
        catalogueItemVariantId: wire.catalogue_item_variant_id,
        nameEn: wire.name_en,
        nameAr: wire.name_ar,
        variantLabel: wire.variant_label,
        quantity: wire.quantity,
        unitPriceMinor: wire.unit_price_minor,
        lineTotalMinor: wire.line_total_minor,
        currencyCode: currencyOf(wire.currency_code),
        allergens: wire.allergens.map((allergen) => ({
            allergenCode: AllergenCode.unsafe(allergen.allergen_code),
            containment: allergen.containment,
        })),
        packSummary: wire.pack_summary,
        priceListId: wire.price_list_id === null ? null : PriceListId.unsafe(wire.price_list_id),
        priceListItemId: wire.price_list_item_id,
    };
}

function mapDelivery(wire: WireKitchenOrderDelivery): KitchenOrderDelivery {
    return {
        label: wire.label,
        lineOne: wire.line_one,
        lineTwo: wire.line_two,
        city: wire.city,
        areaNameEn: wire.area_name_en,
        areaNameAr: wire.area_name_ar,
        areaId: wire.area_id,
        windowCode: wire.window_code,
        requestedDate: wire.requested_date,
        zoneId: wire.zone_id === null ? null : DeliveryZoneId.unsafe(wire.zone_id),
    };
}

export function mapKitchenOrder(wire: WireKitchenOrder): KitchenOrder {
    return {
        id: OrderId.unsafe(wire.id),
        orderNumber: wire.order_number,
        branchId: wire.branch_id === null ? null : BranchId.unsafe(wire.branch_id),
        status: wire.status,
        currencyCode: currencyOf(wire.currency_code),
        subtotalMinor: wire.subtotal_minor,
        deliveryFeeMinor: wire.delivery_fee_minor,
        totalMinor: wire.total_minor,
        paymentMethod: wire.payment_method,
        // Read literally rather than defaulted to `'delivery'`: the column's *database* default is
        // delivery, and repeating that here would turn a wire fault into a confident claim that an
        // order nobody is driving anywhere is going out on a van.
        fulfilmentType: wire.fulfilment_type,
        delivery: mapDelivery(wire.delivery),
        placedAt: wire.placed_at,
        confirmedAt: wire.confirmed_at,
        fulfilledAt: wire.fulfilled_at,
        cancelledAt: wire.cancelled_at,
        cancellationReason: wire.cancellation_reason,
        lockVersion: wire.lock_version,
        lineCount: wire.line_count,
        lines: wire.lines.map(mapLine),
    };
}

/**
 * One receipt, as written.
 *
 * Nothing is defaulted. `amount_minor` in particular is read straight through: a `?? 0` on a
 * malformed field would put a receipt for nothing into a cash ledger, which is worse than an error.
 */
function mapPaymentReceipt(wire: WireOrderPaymentReceipt): KitchenOrderPaymentReceipt {
    return {
        id: wire.id,
        orderId: wire.order_id,
        method: wire.method,
        amountMinor: wire.amount_minor,
        currencyCode: currencyOf(wire.currency_code),
        reference: wire.reference,
        confirmedBy: wire.confirmed_by,
        confirmedAt: wire.confirmed_at,
        notes: wire.notes,
    };
}

/**
 * Where the order stands afterwards.
 *
 * The same three fields `order-desk-mappers.ts` maps for the queue row, mapped again here rather
 * than imported across: this module is the order's, that one is the desk's, and an import in either
 * direction would make one repository's shape depend on the other's file layout. The wire type is
 * the single source both read (`OrderPaymentSummary`), which is what actually keeps them in step.
 */
function mapPaymentSummary(wire: WireOrderPaymentSummary): KitchenOrderPaymentSummary {
    return {
        method: wire.method,
        receivedMinor: wire.received_minor,
        receipted: wire.receipted,
    };
}

/** Same shape as `kitchen-admin-repository.ts`'s `cursorQuery`, narrowed to this endpoint's filters. */
function ordersQuery(filters?: KitchenOrderFilters): string {
    if (filters === undefined) return '';

    const search = new URLSearchParams();
    if (filters.status !== undefined) search.set('status', filters.status);
    if (filters.requestedDeliveryDate !== undefined) {
        search.set('requested_delivery_date', filters.requestedDeliveryDate);
    }
    if (filters.branchId !== undefined) search.set('branch_id', String(filters.branchId));
    if (filters.query !== undefined && filters.query.trim() !== '') {
        search.set('query', filters.query.trim());
    }
    if (filters.cursor !== undefined) search.set('cursor', filters.cursor);
    if (filters.limit !== undefined) search.set('limit', String(filters.limit));

    const rendered = search.toString();
    return rendered === '' ? '' : `?${rendered}`;
}

/** The lock version as an entity tag, matching `kitchen-admin-writes.ts`'s `ifMatch`. */
function ifMatch(lockVersion: number): Readonly<Record<string, string>> {
    return { 'If-Match': `"${lockVersion}"` };
}

export function createApiKitchenOrdersRepository(transport: Transport): KitchenOrdersRepository {
    async function transition(
        orderId: OrderId,
        lockVersion: number,
        action: 'confirm' | 'fulfil' | 'cancel',
        body?: Record<string, unknown>,
    ): Promise<KitchenOrder> {
        const payload = await transport.request<{ readonly order: WireKitchenOrder }>({
            method: 'POST',
            path: `/catalogue/orders/${encodeURIComponent(String(orderId))}/${action}`,
            headers: ifMatch(lockVersion),
            ...(body === undefined ? {} : { body }),
        });
        return mapKitchenOrder(payload.order);
    }

    return {
        async listOrders(filters?: KitchenOrderFilters): Promise<KitchenOrderPage> {
            const envelope = await transport.requestEnvelope<readonly WireKitchenOrder[]>({
                method: 'GET',
                path: `/catalogue/orders${ordersQuery(filters)}`,
            });

            const meta = envelope.meta as PaginationMeta | null;
            return {
                items: envelope.data.map(mapKitchenOrder),
                nextCursor: meta?.next_cursor ?? null,
                hasMore: meta?.has_more ?? false,
            };
        },

        async getOrder(orderId: OrderId): Promise<KitchenOrder> {
            const payload = await transport.request<{ readonly order: WireKitchenOrder }>({
                method: 'GET',
                path: `/catalogue/orders/${encodeURIComponent(String(orderId))}`,
            });
            return mapKitchenOrder(payload.order);
        },

        async confirmOrder(request: KitchenOrderTransitionRequest): Promise<KitchenOrder> {
            return transition(request.id, request.lockVersion, 'confirm');
        },

        async fulfilOrder(request: KitchenOrderTransitionRequest): Promise<KitchenOrder> {
            return transition(request.id, request.lockVersion, 'fulfil');
        },

        async cancelOrder(request: CancelKitchenOrderRequest): Promise<KitchenOrder> {
            return transition(request.id, request.lockVersion, 'cancel', {
                reason: request.reason,
            });
        },

        async recordPayment(
            request: RecordKitchenOrderPaymentRequest,
        ): Promise<RecordedKitchenOrderPayment> {
            const body: StorePaymentReceiptRequest = {
                method: request.method,
                amount_minor: request.amountMinor,
                // Spread rather than set to `undefined`: `exactOptionalPropertyTypes` would let a
                // present-but-empty key through, and the server distinguishes "no reference" from
                // a reference somebody cleared. There is deliberately no `currency_code` — the
                // order's is the only one this receipt can be in.
                ...(request.reference === undefined ? {} : { reference: request.reference }),
                ...(request.notes === undefined ? {} : { notes: request.notes }),
            };

            const payload = await transport.request<{
                readonly receipt: WireOrderPaymentReceipt;
                readonly payment: WireOrderPaymentSummary;
            }>({
                method: 'POST',
                path: `/catalogue/orders/${encodeURIComponent(String(request.id))}/payments`,
                headers: {
                    // The **order's** version, and this write does not bump it: what the
                    // precondition guards is that nobody records money against an order somebody
                    // cancelled in the meantime.
                    ...ifMatch(request.lockVersion),
                    // A fresh key per attempt, minted here so no screen can forget it — the rule
                    // `order-repository.ts` and `order-desk-repository.ts` follow. Per *attempt* is
                    // the important half: a held key would make a deliberate second payment replay
                    // the first receipt instead of recording the balance.
                    'Idempotency-Key': generateRequestId(),
                },
                body,
            });

            return {
                receipt: mapPaymentReceipt(payload.receipt),
                payment: mapPaymentSummary(payload.payment),
            };
        },
    };
}
