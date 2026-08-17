import { OrderId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
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

describe('createApiKitchenOrdersRepository — recordPayment', () => {
    const RECEIPT_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2101';
    const AGENT_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2201';

    function receiptBody(overrides: Record<string, unknown> = {}) {
        return {
            data: {
                receipt: {
                    id: RECEIPT_UUID,
                    order_id: ORDER_UUID,
                    method: 'cash_on_delivery',
                    amount_minor: 16000,
                    currency_code: 'AED',
                    reference: null,
                    confirmed_by: AGENT_UUID,
                    confirmed_at: '2026-05-10T09:30:00+00:00',
                    notes: null,
                    created_at: '2026-05-10T09:30:01+00:00',
                    ...overrides,
                },
                payment: { method: 'cash_on_delivery', received_minor: 16000, receipted: true },
            },
            meta: { correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e2301' },
        };
    }

    it('sends the order lock version as a quoted If-Match and mints an Idempotency-Key', async () => {
        const { repository, calls } = harness([{ status: 201, body: receiptBody() }]);

        await repository.recordPayment({
            id: OrderId.unsafe(ORDER_UUID),
            lockVersion: 3,
            method: 'cash_on_delivery',
            amountMinor: 16000,
        });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe(`/catalogue/orders/${ORDER_UUID}/payments`);
        // Quoted, which is the form the server hands back in `ETag` and the form its parser
        // expects — the same convention the three lifecycle writes use.
        expect(calls[0]?.headers.get('If-Match')).toBe('"3"');
        // Minted here so no screen can forget it. The endpoint refuses a `400` without it.
        expect(calls[0]?.headers.get('Idempotency-Key')).toBeTruthy();
    });

    it('mints a fresh key per attempt so a deliberate second payment is not a replay', async () => {
        const { repository, calls } = harness([
            { status: 201, body: receiptBody() },
            { status: 201, body: receiptBody() },
        ]);

        const request = {
            id: OrderId.unsafe(ORDER_UUID),
            lockVersion: 3,
            method: 'cash_on_delivery',
            amountMinor: 800,
        } as const;

        await repository.recordPayment(request);
        // The same order, the same version — because this write does not bump it — and a second
        // part payment. A key held across attempts would replay the first receipt and lose the
        // balance.
        await repository.recordPayment(request);

        expect(calls[0]?.headers.get('Idempotency-Key')).not.toBe(
            calls[1]?.headers.get('Idempotency-Key'),
        );
        expect(calls[1]?.headers.get('If-Match')).toBe('"3"');
    });

    it('sends the amount in minor units with no currency field at all', async () => {
        const { repository, calls } = harness([{ status: 201, body: receiptBody() }]);

        await repository.recordPayment({
            id: OrderId.unsafe(ORDER_UUID),
            lockVersion: 1,
            method: 'wish',
            amountMinor: 4500,
            reference: 'WSH-ABC123',
            notes: 'Confirmed on the app.',
        });

        // No `currency_code`: the order's is the only currency this receipt can be in, and a field
        // here would let a caller assert that dirhams arrived against a dollar order.
        expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
            method: 'wish',
            amount_minor: 4500,
            reference: 'WSH-ABC123',
            notes: 'Confirmed on the app.',
        });
    });

    it('omits the optional fields rather than sending them empty', async () => {
        const { repository, calls } = harness([{ status: 201, body: receiptBody() }]);

        await repository.recordPayment({
            id: OrderId.unsafe(ORDER_UUID),
            lockVersion: 1,
            method: 'cash_at_counter',
            amountMinor: 100,
        });

        // Absent, not `null` and not `""`: the server distinguishes "no reference" from a
        // reference somebody cleared.
        expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
            method: 'cash_at_counter',
            amount_minor: 100,
        });
    });

    it('answers the receipt and the order position together', async () => {
        const { repository } = harness([
            {
                status: 201,
                body: receiptBody({ method: 'wish', amount_minor: 500, reference: 'WSH-XYZ' }),
            },
        ]);

        const recorded = await repository.recordPayment({
            id: OrderId.unsafe(ORDER_UUID),
            lockVersion: 1,
            method: 'wish',
            amountMinor: 500,
        });

        expect(recorded.receipt).toEqual({
            id: RECEIPT_UUID,
            orderId: ORDER_UUID,
            method: 'wish',
            amountMinor: 500,
            currencyCode: 'AED',
            reference: 'WSH-XYZ',
            confirmedBy: AGENT_UUID,
            confirmedAt: '2026-05-10T09:30:00+00:00',
            notes: null,
        });
        // The position is answered alongside so no screen has to re-read for a number the server
        // has just computed.
        expect(recorded.payment).toEqual({
            method: 'cash_on_delivery',
            receivedMinor: 16000,
            receipted: true,
        });
    });

    it('surfaces a cancelled order as a conflict carrying no version to reload against', async () => {
        const { repository } = harness([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'This order was cancelled.',
                        details: { status: 'cancelled' },
                    },
                },
            },
        ]);

        await expect(
            repository.recordPayment({
                id: OrderId.unsafe(ORDER_UUID),
                lockVersion: 1,
                method: 'cash_on_delivery',
                amountMinor: 100,
            }),
        ).rejects.toSatisfy((caught: unknown) => {
            const failure = asApiFailure(caught);
            // No `currentLockVersion`, which is how a screen tells "the order moved, re-read"
            // from "the order is cancelled, stop offering this".
            return (
                failure?.code === 'resource.conflict' && failure.currentLockVersion === undefined
            );
        });
    });
});
