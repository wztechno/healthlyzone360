import { BranchId, DeliveryZoneId } from '@healthy360/domain-types';
import type { OrderId } from '@healthy360/domain-types';

import {
    apiFailure,
    conflictFailure,
    throwFailure,
    validationFailure,
} from '../../contracts/failure.ts';
import type {
    CancelKitchenOrderRequest,
    KitchenOrder,
    KitchenOrderFilters,
    KitchenOrderPage,
    KitchenOrderStatus,
    KitchenOrderTransitionRequest,
} from '../../contracts/kitchen-orders.ts';
import { orderIdAt, orderLineIdAt } from './ids.ts';

/**
 * The kitchen orders fixture world.
 *
 * A flat, self-contained mock over one array — nothing here reads the foundation account world or
 * the K1 prototype catalogue, on the same terms as `../kitchen-ops/store.ts`. Five Verdant Kitchen
 * orders spanning all four statuses, so an order list, its four status filters and a slide-in
 * detail all have something honest to render before a single HTTP call exists in the build.
 *
 * ## What this store enforces, and why it enforces exactly this
 *
 * The real endpoints refuse three things, and a mock that refused fewer would let a screen ship
 * with no conflict handling at all:
 *
 * 1. **A stale `lockVersion`** → `resource.conflict`, carrying the version the store holds so the
 *    detail panel can say how far behind it is. Every successful write increments it, exactly as
 *    the backend's optimistic lock does.
 * 2. **An illegal transition** → `resource.conflict` as well, *not* a validation failure. The
 *    request was well formed; the world had moved. `placed → confirmed → fulfilled`, cancel from
 *    `placed` or `confirmed`, and nothing at all from the two terminal states.
 * 3. **A cancellation with no reason** → `validation.failed`. The contract types the field as
 *    required, so this is only reachable from untyped JavaScript — which is precisely the caller a
 *    runtime guard is for.
 *
 * ## The cursor
 *
 * Opaque to callers, and deliberately not an index: it is the identifier of the last row handed
 * out, and the next page resumes after it. That means a page boundary survives a row being
 * confirmed between two reads, which an offset would not — the same keyset property the real
 * endpoint has, so a screen that pages correctly here pages correctly there.
 */

/** The single branch every seed row belongs to — Verdant Kitchen's Al Quoz kitchen. */
const SEED_BRANCH_ID = BranchId.unsafe('01935f6d-0000-7000-8000-0000000000f1');
const SEED_ZONE_ID = DeliveryZoneId.unsafe('01935f70-0000-7000-8000-000000000f01');

const DEFAULT_PAGE_SIZE = 25;

function line(
    ordinal: number,
    nameEn: string,
    nameAr: string,
    quantity: string,
    unitPriceMinor: number,
    lineTotalMinor: number,
): KitchenOrder['lines'][number] {
    return {
        id: orderLineIdAt(ordinal),
        catalogueItemId: `01935f6d-0000-7000-8000-0000000${String(ordinal).padStart(5, '0')}`,
        catalogueItemVariantId: null,
        nameEn,
        nameAr,
        variantLabel: null,
        quantity,
        unitPriceMinor,
        lineTotalMinor,
        currencyCode: 'AED',
        allergens: [],
        packSummary: null,
        priceListId: null,
        priceListItemId: null,
    };
}

function delivery(
    lineOne: string,
    areaNameEn: string,
    areaNameAr: string,
    windowCode: string,
    requestedDate: string,
): KitchenOrder['delivery'] {
    return {
        label: 'Home',
        lineOne,
        lineTwo: null,
        city: null,
        areaNameEn,
        areaNameAr,
        areaId: null,
        windowCode,
        requestedDate,
        zoneId: SEED_ZONE_ID,
    };
}

/**
 * Newest first, which is the order the endpoint answers in and therefore the order this array is
 * written in. Line totals are the arithmetic they claim to be, so a screen summing them against
 * `subtotalMinor` agrees with itself.
 */
function seedOrders(): KitchenOrder[] {
    return [
        {
            id: orderIdAt(1),
            orderNumber: 'VK-2026-0148',
            branchId: SEED_BRANCH_ID,
            status: 'placed',
            currencyCode: 'AED',
            subtotalMinor: 14_500,
            deliveryFeeMinor: 1_500,
            totalMinor: 16_000,
            paymentMethod: 'cash_on_delivery',
            delivery: delivery(
                'Villa 12, Street 8b',
                'Al Quoz 1',
                'القوز ١',
                'morning',
                '2026-08-08',
            ),
            placedAt: '2026-08-06T07:12:00Z',
            confirmedAt: null,
            fulfilledAt: null,
            cancelledAt: null,
            cancellationReason: null,
            lockVersion: 1,
            lineCount: 2,
            lines: [
                line(1, 'Grilled chicken bowl', 'وعاء الدجاج المشوي', '2.000', 4_500, 9_000),
                line(2, 'Green harvest salad', 'سلطة الحصاد الأخضر', '1.000', 5_500, 5_500),
            ],
        },
        {
            id: orderIdAt(2),
            orderNumber: 'VK-2026-0147',
            branchId: SEED_BRANCH_ID,
            status: 'placed',
            currencyCode: 'AED',
            subtotalMinor: 7_200,
            deliveryFeeMinor: null,
            totalMinor: 7_200,
            paymentMethod: 'cash_on_delivery',
            delivery: delivery(
                'Office 1104, Onyx Tower 2',
                'Al Barsha',
                'البرشاء',
                'afternoon',
                '2026-08-08',
            ),
            placedAt: '2026-08-06T06:40:00Z',
            confirmedAt: null,
            fulfilledAt: null,
            cancelledAt: null,
            cancellationReason: null,
            lockVersion: 1,
            lineCount: 1,
            lines: [line(3, 'Lentil soup, 1 litre', 'شوربة العدس، لتر', '1.500', 4_800, 7_200)],
        },
        {
            id: orderIdAt(3),
            orderNumber: 'VK-2026-0146',
            branchId: SEED_BRANCH_ID,
            status: 'confirmed',
            currencyCode: 'AED',
            subtotalMinor: 23_400,
            deliveryFeeMinor: 1_500,
            totalMinor: 24_900,
            paymentMethod: 'cash_on_delivery',
            delivery: delivery(
                'Apartment 702, Bay Square 6',
                'Business Bay',
                'الخليج التجاري',
                'morning',
                '2026-08-07',
            ),
            placedAt: '2026-08-05T15:02:00Z',
            confirmedAt: '2026-08-05T15:48:00Z',
            fulfilledAt: null,
            cancelledAt: null,
            cancellationReason: null,
            lockVersion: 2,
            lineCount: 2,
            lines: [
                line(4, 'Family mezze platter', 'طبق المزة العائلي', '1.000', 15_000, 15_000),
                line(5, 'Herb flatbread, 6 pieces', 'خبز الأعشاب، ٦ قطع', '3.000', 2_800, 8_400),
            ],
        },
        {
            id: orderIdAt(4),
            orderNumber: 'VK-2026-0145',
            branchId: SEED_BRANCH_ID,
            status: 'fulfilled',
            currencyCode: 'AED',
            subtotalMinor: 9_000,
            deliveryFeeMinor: 1_500,
            totalMinor: 10_500,
            paymentMethod: 'cash_on_delivery',
            delivery: delivery(
                'Villa 3, Street 21',
                'Jumeirah 1',
                'جميرا ١',
                'evening',
                '2026-08-05',
            ),
            placedAt: '2026-08-04T09:20:00Z',
            confirmedAt: '2026-08-04T09:55:00Z',
            fulfilledAt: '2026-08-05T17:31:00Z',
            cancelledAt: null,
            cancellationReason: null,
            lockVersion: 3,
            lineCount: 1,
            lines: [line(6, 'Grilled chicken bowl', 'وعاء الدجاج المشوي', '2.000', 4_500, 9_000)],
        },
        {
            id: orderIdAt(5),
            orderNumber: 'VK-2026-0144',
            branchId: SEED_BRANCH_ID,
            status: 'cancelled',
            currencyCode: 'AED',
            subtotalMinor: 5_500,
            deliveryFeeMinor: 1_500,
            totalMinor: 7_000,
            paymentMethod: 'cash_on_delivery',
            delivery: delivery(
                'Warehouse 14, Street 4a',
                'Al Quoz Industrial 3',
                'القوز الصناعية ٣',
                'afternoon',
                '2026-08-04',
            ),
            placedAt: '2026-08-03T11:05:00Z',
            confirmedAt: null,
            fulfilledAt: null,
            cancelledAt: '2026-08-03T12:10:00Z',
            cancellationReason: 'address_unreachable',
            lockVersion: 2,
            lineCount: 1,
            lines: [line(7, 'Green harvest salad', 'سلطة الحصاد الأخضر', '1.000', 5_500, 5_500)],
        },
    ];
}

/** Which statuses each action may be taken from — the whole state machine, in one table. */
const ALLOWED_FROM: Readonly<
    Record<'confirm' | 'fulfil' | 'cancel', readonly KitchenOrderStatus[]>
> = {
    confirm: ['placed'],
    fulfil: ['confirmed'],
    cancel: ['placed', 'confirmed'],
};

const NEXT_STATUS: Readonly<Record<'confirm' | 'fulfil' | 'cancel', KitchenOrderStatus>> = {
    confirm: 'confirmed',
    fulfil: 'fulfilled',
    cancel: 'cancelled',
};

export class KitchenOrdersMockStore {
    #orders: KitchenOrder[] = seedOrders();

    /** Every order, newest first — the raw array, for a test that wants to assert against it. */
    orders(): readonly KitchenOrder[] {
        return [...this.#orders];
    }

    list(filters?: KitchenOrderFilters): KitchenOrderPage {
        const query = filters?.query?.trim().toLowerCase() ?? '';

        const matched = this.#orders.filter((order) => {
            if (filters?.status !== undefined && order.status !== filters.status) return false;
            if (
                filters?.requestedDeliveryDate !== undefined &&
                order.delivery.requestedDate !== filters.requestedDeliveryDate
            ) {
                return false;
            }
            if (filters?.branchId !== undefined && order.branchId !== filters.branchId)
                return false;
            if (query !== '' && !order.orderNumber.toLowerCase().includes(query)) return false;
            return true;
        });

        const start =
            filters?.cursor === undefined
                ? 0
                : matched.findIndex((order) => String(order.id) === filters.cursor) + 1;
        const size = filters?.limit ?? DEFAULT_PAGE_SIZE;
        const page = matched.slice(start, start + size);
        const hasMore = start + page.length < matched.length;
        const last = page.at(-1);

        return {
            items: page,
            nextCursor: hasMore && last !== undefined ? String(last.id) : null,
            hasMore,
        };
    }

    get(orderId: OrderId): KitchenOrder {
        const order = this.#orders.find((candidate) => candidate.id === orderId);
        if (order === undefined) throwFailure(apiFailure('resource.not_found'));
        return order;
    }

    confirm(request: KitchenOrderTransitionRequest): KitchenOrder {
        return this.#transition('confirm', request);
    }

    fulfil(request: KitchenOrderTransitionRequest): KitchenOrder {
        return this.#transition('fulfil', request);
    }

    cancel(request: CancelKitchenOrderRequest): KitchenOrder {
        // Typed as required; reachable only from untyped callers, which is who this guard is for.
        if (request.reason === undefined || request.reason === null) {
            throwFailure(validationFailure({ reason: ['A cancellation reason is required.'] }));
        }
        return this.#transition('cancel', request, request.reason);
    }

    #transition(
        action: 'confirm' | 'fulfil' | 'cancel',
        request: KitchenOrderTransitionRequest,
        reason?: CancelKitchenOrderRequest['reason'],
    ): KitchenOrder {
        const current = this.get(request.id);

        if (current.lockVersion !== request.lockVersion) {
            throwFailure(
                conflictFailure({
                    currentLockVersion: current.lockVersion,
                    message: 'This order changed while you were working on it.',
                }),
            );
        }

        if (!ALLOWED_FROM[action].includes(current.status)) {
            throwFailure(
                conflictFailure({
                    currentLockVersion: current.lockVersion,
                    message: `An order that is ${current.status} cannot be ${NEXT_STATUS[action]}.`,
                }),
            );
        }

        const at = new Date().toISOString();
        const next: KitchenOrder = {
            ...current,
            status: NEXT_STATUS[action],
            lockVersion: current.lockVersion + 1,
            ...(action === 'confirm' ? { confirmedAt: at } : {}),
            ...(action === 'fulfil' ? { fulfilledAt: at } : {}),
            ...(action === 'cancel' ? { cancelledAt: at, cancellationReason: reason ?? null } : {}),
        };

        this.#orders = this.#orders.map((candidate) =>
            candidate.id === next.id ? next : candidate,
        );
        return next;
    }
}
