import { OrderId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { KitchenOrdersMockStore } from '../mock/kitchen-orders/store.ts';
import { createApiKitchenOrdersRepository } from './kitchen-orders-repository.ts';
import { createTransport } from './transport.ts';

interface Call {
    readonly method: string;
    readonly path: string;
    readonly headers: Headers;
    readonly body: string | null;
}

function harness(responses: readonly { status: number; body: unknown }[]) {
    const calls: Call[] = [];
    let index = 0;

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push({
                method: init?.method ?? 'GET',
                path: url.replace('https://api.example/api/v1', ''),
                headers: new Headers(init?.headers),
                body: typeof init?.body === 'string' ? init.body : null,
            });

            const next = responses[index++];
            if (next === undefined) {
                return new Response(JSON.stringify({ error: { code: 'request.invalid' } }), {
                    status: 500,
                });
            }
            return new Response(JSON.stringify(next.body), { status: next.status });
        },
    });

    return { repository: createApiKitchenOrdersRepository(transport), calls };
}

const ORDER_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1a01';
const BRANCH_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1b01';
const ZONE_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01';
const PRICE_LIST_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d01';

function wireOrder(overrides: Record<string, unknown> = {}) {
    return {
        id: ORDER_UUID,
        order_number: 'VK-2026-0148',
        organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1e01',
        customer_account_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1f01',
        sales_channel_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2001',
        branch_id: BRANCH_UUID,
        status: 'placed',
        currency_code: 'AED',
        subtotal_minor: 14500,
        delivery_fee_minor: 1500,
        total_minor: 16000,
        payment_method: 'cash_on_delivery',
        delivery: {
            label: 'Home',
            line_one: 'Villa 12, Street 8b',
            line_two: null,
            city: null,
            area_name_en: 'Al Quoz 1',
            area_name_ar: 'القوز ١',
            area_id: null,
            window_code: 'morning',
            requested_date: '2026-08-08',
            zone_id: ZONE_UUID,
        },
        placed_at: '2026-08-06T07:12:00Z',
        confirmed_at: null,
        fulfilled_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        created_by: null,
        lock_version: 3,
        line_count: 1,
        lines: [
            {
                id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2101',
                catalogue_item_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2201',
                catalogue_item_variant_id: null,
                name_en: 'Grilled chicken bowl',
                name_ar: 'وعاء الدجاج المشوي',
                variant_label: null,
                quantity: '2.000',
                unit_price_minor: 4500,
                line_total_minor: 9000,
                currency_code: 'AED',
                allergens: [{ allergen_code: 'sesame', containment: 'contains' }],
                pack_summary: null,
                price_list_id: PRICE_LIST_UUID,
                price_list_item_id: 'entry-1',
            },
        ],
        created_at: '2026-08-06T07:12:00Z',
        updated_at: '2026-08-06T07:12:00Z',
        ...overrides,
    };
}

describe('createApiKitchenOrdersRepository — listOrders', () => {
    it('unwraps a bare array from data and the cursor from meta', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: [wireOrder(), wireOrder({ id: ORDER_UUID })],
                    meta: { count: 2, next_cursor: 'cursor-2', has_more: true },
                },
            },
        ]);

        const page = await repository.listOrders();

        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.path).toBe('/catalogue/orders');
        expect(page.items).toHaveLength(2);
        expect(page.nextCursor).toBe('cursor-2');
        expect(page.hasMore).toBe(true);
    });

    it('reports the last page honestly when meta says there is no cursor', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: { data: [], meta: { count: 0, next_cursor: null, has_more: false } },
            },
        ]);

        const page = await repository.listOrders();

        expect(page.items).toEqual([]);
        expect(page.nextCursor).toBeNull();
        expect(page.hasMore).toBe(false);
    });

    it('sends every filter under the name the endpoint reads', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: { data: [], meta: { count: 0, next_cursor: null, has_more: false } },
            },
        ]);

        await repository.listOrders({
            status: 'confirmed',
            requestedDeliveryDate: '2026-08-08',
            branchId: BRANCH_UUID as never,
            query: '  0148 ',
            cursor: 'cursor-1',
            limit: 10,
        });

        const query = new URLSearchParams(calls[0]?.path.split('?')[1] ?? '');
        expect(query.get('status')).toBe('confirmed');
        expect(query.get('requested_delivery_date')).toBe('2026-08-08');
        expect(query.get('branch_id')).toBe(BRANCH_UUID);
        expect(query.get('query')).toBe('0148');
        expect(query.get('cursor')).toBe('cursor-1');
        expect(query.get('limit')).toBe('10');
    });
});

describe('createApiKitchenOrdersRepository — getOrder', () => {
    it('unwraps data.order and maps the seller-only fields the customer shape lacks', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { order: wireOrder() }, meta: {} } },
        ]);

        const order = await repository.getOrder(OrderId.unsafe(ORDER_UUID));

        expect(calls[0]?.path).toBe(`/catalogue/orders/${ORDER_UUID}`);
        expect(order.id).toBe(ORDER_UUID);
        expect(order.orderNumber).toBe('VK-2026-0148');
        expect(order.branchId).toBe(BRANCH_UUID);
        expect(order.lockVersion).toBe(3);

        // Minor units, never a formatted string, and one currency code beside them.
        expect(order.subtotalMinor).toBe(14500);
        expect(order.deliveryFeeMinor).toBe(1500);
        expect(order.totalMinor).toBe(16000);
        expect(order.currencyCode).toBe('AED');

        // Seller-only: the zone that set the fee and the tariff that priced the line.
        expect(order.delivery.zoneId).toBe(ZONE_UUID);
        expect(order.lines[0]?.priceListId).toBe(PRICE_LIST_UUID);
        expect(order.lines[0]?.priceListItemId).toBe('entry-1');

        // Line money and quantity: an integer and the decimal string it was computed from.
        expect(order.lines[0]?.quantity).toBe('2.000');
        expect(order.lines[0]?.unitPriceMinor).toBe(4500);
        expect(order.lines[0]?.lineTotalMinor).toBe(9000);
        expect(order.lines[0]?.allergens).toEqual([
            { allergenCode: 'sesame', containment: 'contains' },
        ]);
    });

    it('falls back to USD rather than trusting an unrecognised currency code', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: { data: { order: wireOrder({ currency_code: 'XYZ' }) }, meta: {} },
            },
        ]);

        expect((await repository.getOrder(OrderId.unsafe(ORDER_UUID))).currencyCode).toBe('USD');
    });
});

describe('createApiKitchenOrdersRepository — the three lifecycle writes', () => {
    it('confirm sends the lock version as a quoted If-Match and unwraps the fresh order', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: {
                        order: wireOrder({
                            status: 'confirmed',
                            confirmed_at: '2026-08-06T08:00:00Z',
                            lock_version: 4,
                        }),
                    },
                    meta: {},
                },
            },
        ]);

        const order = await repository.confirmOrder({
            id: OrderId.unsafe(ORDER_UUID),
            lockVersion: 3,
        });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe(`/catalogue/orders/${ORDER_UUID}/confirm`);
        expect(calls[0]?.headers.get('If-Match')).toBe('"3"');
        expect(calls[0]?.body).toBeNull();
        expect(order.status).toBe('confirmed');
        expect(order.lockVersion).toBe(4);
    });

    it('fulfil posts to its own action with the same guard', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: { order: wireOrder({ status: 'fulfilled', lock_version: 5 }) },
                    meta: {},
                },
            },
        ]);

        await repository.fulfilOrder({ id: OrderId.unsafe(ORDER_UUID), lockVersion: 4 });

        expect(calls[0]?.path).toBe(`/catalogue/orders/${ORDER_UUID}/fulfil`);
        expect(calls[0]?.headers.get('If-Match')).toBe('"4"');
    });

    it('cancel sends the reason in the body and the lock version in the header', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: {
                        order: wireOrder({
                            status: 'cancelled',
                            cancellation_reason: 'delivery_unavailable',
                            lock_version: 4,
                        }),
                    },
                    meta: {},
                },
            },
        ]);

        const order = await repository.cancelOrder({
            id: OrderId.unsafe(ORDER_UUID),
            lockVersion: 3,
            reason: 'delivery_unavailable',
        });

        expect(calls[0]?.path).toBe(`/catalogue/orders/${ORDER_UUID}/cancel`);
        expect(calls[0]?.headers.get('If-Match')).toBe('"3"');
        expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ reason: 'delivery_unavailable' });
        expect(order.cancellationReason).toBe('delivery_unavailable');
    });

    it('surfaces a stale lock version as resource.conflict rather than retrying it', async () => {
        const { repository } = harness([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'This order changed while you were working on it',
                    },
                },
            },
        ]);

        const caught = await repository
            .confirmOrder({ id: OrderId.unsafe(ORDER_UUID), lockVersion: 1 })
            .catch((error: unknown) => error);

        expect(asApiFailure(caught)?.code).toBe('resource.conflict');
    });
});

describe('KitchenOrdersMockStore', () => {
    it('seeds five Verdant orders spanning all four statuses', () => {
        const statuses = new KitchenOrdersMockStore().orders().map((order) => order.status);

        expect(statuses).toHaveLength(5);
        expect(new Set(statuses)).toEqual(
            new Set(['placed', 'confirmed', 'fulfilled', 'cancelled']),
        );
    });

    it('walks placed → confirmed → fulfilled, bumping the lock version each time', () => {
        const store = new KitchenOrdersMockStore();
        const placed = store.orders().find((order) => order.status === 'placed');
        expect(placed).toBeDefined();

        const confirmed = store.confirm({ id: placed!.id, lockVersion: placed!.lockVersion });
        expect(confirmed.status).toBe('confirmed');
        expect(confirmed.lockVersion).toBe(placed!.lockVersion + 1);

        const fulfilled = store.fulfil({ id: confirmed.id, lockVersion: confirmed.lockVersion });
        expect(fulfilled.status).toBe('fulfilled');
        expect(fulfilled.fulfilledAt).not.toBeNull();
    });

    it('refuses a stale lock version with the same code the API answers', () => {
        const store = new KitchenOrdersMockStore();
        const placed = store.orders().find((order) => order.status === 'placed')!;

        let caught: unknown;
        try {
            store.confirm({ id: placed.id, lockVersion: placed.lockVersion - 1 });
        } catch (error: unknown) {
            caught = error;
        }

        expect(asApiFailure(caught)?.code).toBe('resource.conflict');
    });

    it('refuses an illegal transition out of a terminal status', () => {
        const store = new KitchenOrdersMockStore();
        const fulfilled = store.orders().find((order) => order.status === 'fulfilled')!;

        let caught: unknown;
        try {
            store.cancel({
                id: fulfilled.id,
                lockVersion: fulfilled.lockVersion,
                reason: 'customer_requested',
            });
        } catch (error: unknown) {
            caught = error;
        }

        expect(asApiFailure(caught)?.code).toBe('resource.conflict');
    });

    it('filters by status and pages on an opaque keyset cursor', () => {
        const store = new KitchenOrdersMockStore();

        const first = store.list({ status: 'placed', limit: 1 });
        expect(first.items).toHaveLength(1);
        expect(first.hasMore).toBe(true);
        expect(first.nextCursor).not.toBeNull();

        const second = store.list({ status: 'placed', limit: 1, cursor: first.nextCursor! });
        expect(second.items).toHaveLength(1);
        expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
        expect(second.hasMore).toBe(false);
    });
});
