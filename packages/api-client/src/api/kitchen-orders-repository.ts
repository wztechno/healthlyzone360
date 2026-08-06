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
    KitchenOrdersRepository,
    KitchenOrderTransitionRequest,
} from '../contracts/kitchen-orders.ts';
import type {
    KitchenOrder as WireKitchenOrder,
    KitchenOrderDelivery as WireKitchenOrderDelivery,
    KitchenOrderLine as WireKitchenOrderLine,
    PaginationMeta,
} from '../generated/types.ts';
import type { Transport } from './transport.ts';

/**
 * Kitchen-side orders, backed by the real Laravel routes under `/catalogue/orders`.
 *
 * ## `If-Match`, on every write and nowhere else
 *
 * Same convention as `kitchen-admin-writes.ts`: the header value is the lock version wrapped in
 * double quotes, which is the form the server hands back in `ETag` and the form its parser expects.
 * The three lifecycle actions are the only writes here and all three carry it. Two failures follow
 * from that and both are surfaced verbatim rather than translated:
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
 * `requestEnvelope`; the single read and all three writes answer `data.order`. That asymmetry is
 * the wire's, and it is read literally here rather than smoothed over.
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
    };
}
