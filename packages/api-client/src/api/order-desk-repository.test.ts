import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiOrderDeskRepository } from './order-desk-repository.ts';
import { createTransport } from './transport.ts';

interface Call {
    readonly method: string;
    readonly path: string;
    /** Parsed, so a body assertion reads as the object the repository built. `null` on a GET. */
    readonly body: Record<string, unknown> | null;
    readonly headers: Readonly<Record<string, string>>;
}

function harness(responses: readonly { status: number; body: unknown }[]) {
    const calls: Call[] = [];
    let index = 0;

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const sent = new Headers(init?.headers);
            const headers: Record<string, string> = {};
            sent.forEach((value, key) => {
                headers[key] = value;
            });

            calls.push({
                method: init?.method ?? 'GET',
                // Decoded so the assertions read as the query a person would write; the transport
                // still sends the percent-encoded form.
                path: decodeURIComponent(url.replace('https://api.example/api/v1', '')),
                body:
                    typeof init?.body === 'string'
                        ? (JSON.parse(init.body) as Record<string, unknown>)
                        : null,
                headers,
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
        payment: { method: 'cash_on_delivery', received_minor: 0, receipted: false },
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
        // Never null: an order with no receipt against it has received zero, which is a payment
        // position rather than an absent one.
        expect(row.payment).toEqual({
            method: 'cash_on_delivery',
            receivedMinor: 0,
            receipted: false,
        });
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
        // `status[]=`, not `status=` twice: repeated bare parameters collapse to a single string in
        // PHP and the controller validates an array. The specification declares `status[]` too.
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

const ITEM_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4201';
const VARIANT_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4202';
const ACCOUNT_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4301';
const ADDRESS_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4302';
const AREA_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4303';

function wireQuote(overrides: Record<string, unknown> = {}) {
    return {
        lines: [
            {
                catalogue_item_id: ITEM_UUID,
                catalogue_item_variant_id: null,
                quantity: '3',
                name_en: 'Flat white',
                name_ar: 'فلات وايت',
                unit_price_minor: 1_800,
                line_total_minor: 5_400,
                currency_code: 'AED',
                refusals: [],
            },
        ],
        subtotal_minor: 5_400,
        delivery_fee_minor: null,
        total_minor: 5_400,
        currency_code: 'AED',
        refusals: [],
        quotable: true,
        ...overrides,
    };
}

describe('createApiOrderDeskRepository — quoteSale', () => {
    it('posts the basket and answers the priced quote', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { quote: wireQuote() }, meta: {} } },
        ]);

        const quote = await repository.quoteSale({
            fulfilmentType: 'counter',
            lines: [{ catalogueItemId: ITEM_UUID, catalogueItemVariantId: null, quantity: '3' }],
        });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe('/catalogue/order-desk/quote');
        expect(calls[0]?.body).toEqual({
            fulfilment_type: 'counter',
            // The absent variant is sent as an explicit `null`: `(item, null)` and
            // `(item, variant)` are two different articles to the server's merge.
            lines: [
                { catalogue_item_id: ITEM_UUID, catalogue_item_variant_id: null, quantity: '3' },
            ],
        });
        // A quote creates nothing, so it carries no idempotency key.
        expect(calls[0]?.headers['idempotency-key']).toBeUndefined();

        expect(quote.quotable).toBe(true);
        expect(quote.totalMinor).toBe(5_400);
        expect(quote.deliveryFeeMinor).toBeNull();
        expect(quote.lines[0]?.unitPriceMinor).toBe(1_800);
    });

    it('omits the fields a shape does not name rather than sending them as null', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { quote: wireQuote() }, meta: {} } },
        ]);

        await repository.quoteSale({
            fulfilmentType: 'delivery',
            lines: [
                { catalogueItemId: ITEM_UUID, catalogueItemVariantId: VARIANT_UUID, quantity: '1' },
            ],
            customerAccountId: ACCOUNT_UUID,
            customerAddressId: ADDRESS_UUID,
        });

        const body = calls[0]?.body ?? {};
        expect(body['customer_account_id']).toBe(ACCOUNT_UUID);
        expect(body['customer_address_id']).toBe(ADDRESS_UUID);
        // Never sent as `null`: naming a field a shape forbids is itself a refusable act, so a key
        // this client never chose to send must not appear at all.
        expect('requested_delivery_date' in body).toBe(false);
        expect('delivery_window_code' in body).toBe(false);
        expect('branch_id' in body).toBe(false);
    });

    it('answers refusals as data, split into a key and its evidence', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: {
                        quote: wireQuote({
                            lines: [
                                {
                                    catalogue_item_id: ITEM_UUID,
                                    catalogue_item_variant_id: null,
                                    quantity: '1',
                                    name_en: 'Soup',
                                    name_ar: 'شوربة',
                                    // Null together: a refused line has no price, and a zero would
                                    // read as free.
                                    unit_price_minor: null,
                                    line_total_minor: null,
                                    currency_code: 'AED',
                                    refusals: [
                                        {
                                            reason: 'channel_unavailable',
                                            catalogue_item_id: ITEM_UUID,
                                        },
                                    ],
                                },
                            ],
                            subtotal_minor: 0,
                            total_minor: 0,
                            refusals: [{ reason: 'customer_required' }],
                            quotable: false,
                        }),
                    },
                    meta: {},
                },
            },
        ]);

        const quote = await repository.quoteSale({ fulfilmentType: 'pickup', lines: [] });

        expect(quote.quotable).toBe(false);
        expect(quote.refusals).toEqual([{ reason: 'customer_required', context: {} }]);
        expect(quote.lines[0]?.unitPriceMinor).toBeNull();
        expect(quote.lines[0]?.refusals[0]).toEqual({
            reason: 'channel_unavailable',
            // Wire casing, deliberately: this is evidence to render, not a contract to read.
            context: { catalogue_item_id: ITEM_UUID },
        });
    });
});

describe('createApiOrderDeskRepository — placeSale', () => {
    it('mints a fresh idempotency key on every attempt', async () => {
        const { repository, calls } = harness([
            { status: 201, body: { data: { order: wireRow() }, meta: {} } },
            { status: 201, body: { data: { order: wireRow() }, meta: {} } },
        ]);

        const sale = {
            fulfilmentType: 'counter',
            lines: [{ catalogueItemId: ITEM_UUID, catalogueItemVariantId: null, quantity: '1' }],
            paymentMethod: 'cash_at_counter',
            payment: { method: 'cash_at_counter' },
        } as const;

        await repository.placeSale(sale);
        await repository.placeSale(sale);

        const first = calls[0]?.headers['idempotency-key'];
        const second = calls[1]?.headers['idempotency-key'];
        expect(first).toBeTruthy();
        expect(second).toBeTruthy();
        // Per *attempt*, not per basket: a deliberate second try must place the corrected sale
        // rather than replay the first answer.
        expect(first).not.toBe(second);
    });

    it('carries the payment block on a counter sale and the method on every sale', async () => {
        const { repository, calls } = harness([
            { status: 201, body: { data: { order: wireRow() }, meta: {} } },
        ]);

        await repository.placeSale({
            fulfilmentType: 'counter',
            lines: [{ catalogueItemId: ITEM_UUID, catalogueItemVariantId: null, quantity: '2' }],
            paymentMethod: 'wish',
            payment: { method: 'wish', reference: 'WSH-4471', notes: 'Confirmed on screen' },
        });

        expect(calls[0]?.path).toBe('/catalogue/order-desk/orders');
        expect(calls[0]?.body).toMatchObject({
            fulfilment_type: 'counter',
            payment_method: 'wish',
            payment: { method: 'wish', reference: 'WSH-4471', notes: 'Confirmed on screen' },
        });
    });

    it('omits the payment block entirely for a delivery, which forbids it', async () => {
        const { repository, calls } = harness([
            { status: 201, body: { data: { order: wireRow() }, meta: {} } },
        ]);

        await repository.placeSale({
            fulfilmentType: 'delivery',
            lines: [{ catalogueItemId: ITEM_UUID, catalogueItemVariantId: null, quantity: '1' }],
            customerAccountId: ACCOUNT_UUID,
            customerAddressId: ADDRESS_UUID,
            paymentMethod: 'cash_on_delivery',
        });

        const body = calls[0]?.body ?? {};
        // A present-but-undefined key would serialise to one the server refuses with a 422.
        expect('payment' in body).toBe(false);
        expect(body['payment_method']).toBe('cash_on_delivery');
    });
});

describe('createApiOrderDeskRepository — customers', () => {
    it('sends the trimmed query and answers the rows with the cap', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: [
                        {
                            id: ACCOUNT_UUID,
                            display_name: 'Layla Haddad',
                            phone: '+971500000001',
                            origin: 'staff',
                            has_orders_with_org: true,
                        },
                    ],
                    meta: { count: 1, limit: 20 },
                },
            },
        ]);

        const found = await repository.searchCustomers('  Layla  ');

        expect(calls[0]?.path).toBe('/catalogue/order-desk/customers?query=Layla');
        expect(found.limit).toBe(20);
        expect(found.rows[0]).toEqual({
            id: ACCOUNT_UUID,
            displayName: 'Layla Haddad',
            phone: '+971500000001',
            origin: 'staff',
            hasOrdersWithOrg: true,
        });
    });

    it('answers a created customer together with who else holds that number', async () => {
        const { repository, calls } = harness([
            {
                status: 201,
                body: {
                    data: {
                        customer: {
                            id: ACCOUNT_UUID,
                            display_name: 'Sami Nassar',
                            phone: '+9613000111',
                            origin: 'staff',
                            has_orders_with_org: false,
                        },
                        possible_duplicates: [
                            {
                                id: OTHER_ORDER_UUID,
                                display_name: 'S. Nassar',
                                phone: '+9613000111',
                                origin: 'self_service',
                                has_orders_with_org: true,
                            },
                        ],
                    },
                    meta: {},
                },
            },
        ]);

        const created = await repository.createCustomer({
            displayName: 'Sami Nassar',
            phone: '+9613000111',
        });

        expect(calls[0]?.method).toBe('POST');
        // Creating an account is unrecoverable, so the key is mandatory and minted here.
        expect(calls[0]?.headers['idempotency-key']).toBeTruthy();
        expect(calls[0]?.body).toEqual({
            display_name: 'Sami Nassar',
            phone: '+9613000111',
        });
        expect(created.customer.displayName).toBe('Sami Nassar');
        // A warning, never a refusal — a household genuinely shares a telephone.
        expect(created.possibleDuplicates).toHaveLength(1);
    });

    it('writes an address against the named account, with no idempotency key', async () => {
        const { repository, calls } = harness([
            {
                status: 201,
                body: {
                    data: {
                        address: {
                            id: ADDRESS_UUID,
                            address_type: 'delivery',
                            delivery_area_id: AREA_UUID,
                            label: 'Home',
                            line_one: 'Villa 12, Street 8b',
                            line_two: null,
                            is_default: false,
                            is_deliverable: true,
                            lock_version: 1,
                        },
                    },
                    meta: {},
                },
            },
        ]);

        const address = await repository.addCustomerAddress({
            customerAccountId: ACCOUNT_UUID,
            deliveryAreaId: AREA_UUID,
            lineOne: 'Villa 12, Street 8b',
            label: 'Home',
        });

        expect(calls[0]?.path).toBe(`/catalogue/order-desk/customers/${ACCOUNT_UUID}/addresses`);
        // A duplicated address is a correctable row, not an unrecoverable write — the operation
        // does not require the header, so sending one would claim a guarantee it does not offer.
        expect(calls[0]?.headers['idempotency-key']).toBeUndefined();
        expect(calls[0]?.body).toEqual({
            delivery_area_id: AREA_UUID,
            line_one: 'Villa 12, Street 8b',
            label: 'Home',
        });
        expect(address.isDeliverable).toBe(true);
        expect(address.lineTwo).toBeNull();
    });
});
