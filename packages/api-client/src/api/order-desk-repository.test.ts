import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiOrderDeskRepository } from './order-desk-repository.ts';
import { createTransport } from './transport.ts';

interface Call {
    readonly method: string;
    readonly path: string;
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
                // Decoded so the assertions read as the query a person would write; the transport
                // still sends the percent-encoded form.
                path: decodeURIComponent(url.replace('https://api.example/api/v1', '')),
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

    return { repository: createApiOrderDeskRepository(transport), calls };
}

const ORDER_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4001';
const OTHER_ORDER_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4002';
const BRANCH_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4101';

function wireRow(overrides: Record<string, unknown> = {}) {
    return {
        id: ORDER_UUID,
        order_number: 'H360-2026-0148',
        branch_id: BRANCH_UUID,
        status: 'placed',
        currency_code: 'AED',
        subtotal_minor: 14_500,
        delivery_fee_minor: 1_500,
        total_minor: 16_000,
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
            requested_date: '2026-08-16',
            zone_id: null,
        },
        placed_at: '2026-08-15T07:12:00+00:00',
        confirmed_at: null,
        fulfilled_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        lock_version: 1,
        line_count: 0,
        lines: [],
        due_at: '2026-08-16T05:00:00+00:00',
        payment: null,
        delivery_job: null,
        ...overrides,
    };
}

const META = {
    correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4900',
    count: 1,
    limit: 200,
    truncated: false,
    window: 'today',
    today: '2026-08-15',
    timezone: 'Asia/Dubai',
};

describe('createApiOrderDeskRepository — listQueue', () => {
    it('reads the literal path with no query at all when nothing is filtered', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: [wireRow()], meta: META } },
        ]);

        const queue = await repository.listQueue();

        expect(calls[0]?.method).toBe('GET');
        // No `?window=today`: the default is the server's, and sending it would make the
        // unfiltered read a different cache entry from the one the screen starts on.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/queue');
        expect(queue.rows).toHaveLength(1);
    });

    it('composes the kitchen order and the four fields the desk adds', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: [
                        wireRow({
                            customer: { display_name: 'Layla Haddad', phone: '+971500000001' },
                        }),
                    ],
                    meta: META,
                },
            },
        ]);

        const [row] = (await repository.listQueue()).rows;
        if (row === undefined) throw new Error('the queue answered no rows');

        // The kitchen order is mapped by `mapKitchenOrder`, not restated here.
        expect(row.id).toBe(ORDER_UUID);
        expect(row.orderNumber).toBe('H360-2026-0148');
        expect(row.status).toBe('placed');
        expect(row.totalMinor).toBe(16_000);
        expect(row.lockVersion).toBe(1);
        expect(row.delivery.windowCode).toBe('morning');

        expect(row.dueAt).toBe('2026-08-16T05:00:00+00:00');
        expect(row.payment).toBeNull();
        expect(row.deliveryJob).toBeNull();
        expect(row.customer).toEqual({ displayName: 'Layla Haddad', phone: '+971500000001' });
    });

    it('keeps an absent customer block absent rather than turning it into nulls', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: [
                        // Without `order.view_customer_contact_organisation` the key is missing.
                        wireRow(),
                        // With it, an anonymised account still has no name — a different fact.
                        wireRow({
                            id: OTHER_ORDER_UUID,
                            customer: { display_name: null, phone: '+971500000002' },
                        }),
                    ],
                    meta: { ...META, count: 2 },
                },
            },
        ]);

        const { rows } = await repository.listQueue();

        // Absence is the disclosure signal: `'customer' in row` is false, not "present and null".
        expect(rows[0] && 'customer' in rows[0]).toBe(false);
        expect(rows[0]?.customer).toBeUndefined();
        // Present-with-a-null-name is the customer's fact, and it survives as one.
        expect(rows[1] && 'customer' in rows[1]).toBe(true);
        expect(rows[1]?.customer).toEqual({ displayName: null, phone: '+971500000002' });
    });

    it('answers the cap and the clock the queue was measured against', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: [wireRow()],
                    meta: { ...META, count: 200, truncated: true, window: 'next_7' },
                },
            },
        ]);

        const { meta } = await repository.listQueue({ window: 'next_7' });

        // `truncated` is never inferred from `count === limit` — the server says it, and a screen
        // that guessed would call a queue of exactly 200 open orders truncated when it is not.
        expect(meta).toEqual({
            count: 200,
            limit: 200,
            truncated: true,
            window: 'next_7',
            today: '2026-08-15',
            timezone: 'Asia/Dubai',
        });
    });

    it('sends every filter, with the statuses in the bracket form PHP actually parses', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: [], meta: { ...META, count: 0 } } },
        ]);

        await repository.listQueue({
            window: 'overdue',
            branchId: BRANCH_UUID as never,
            statuses: ['placed', 'confirmed'],
            deliveryWindowCode: 'morning',
            query: '  0148  ',
        });

        const path = calls[0]?.path ?? '';
        expect(path.startsWith('/catalogue/order-desk/queue?')).toBe(true);
        expect(path).toContain('window=overdue');
        expect(path).toContain(`branch_id=${BRANCH_UUID}`);
        // `status[]=`, not `status=` twice: the exploded form the specification declares collapses
        // to a single string in PHP and the controller validates an array. See the module header.
        expect(path).toContain('status[]=placed');
        expect(path).toContain('status[]=confirmed');
        expect(path).toContain('delivery_window_code=morning');
        // Trimmed, like every other search this codebase sends.
        expect(path).toContain('query=0148');
    });

    it('sends nothing for an empty status list or a whitespace-only search', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: [], meta: { ...META, count: 0 } } },
        ]);

        await repository.listQueue({ statuses: [], query: '   ' });

        // Both mean "do not narrow", which is the request with no parameters at all.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/queue');
    });

    it('answers an empty queue as an empty list carrying its meta, not as a failure', async () => {
        const { repository } = harness([
            { status: 200, body: { data: [], meta: { ...META, count: 0 } } },
        ]);

        const queue = await repository.listQueue();

        expect(queue.rows).toEqual([]);
        expect(queue.meta.truncated).toBe(false);
        expect(queue.meta.today).toBe('2026-08-15');
    });
});
