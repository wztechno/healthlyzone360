import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
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
const JOB_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4501';
const DRIVER_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4502';

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
        fulfilment_type: 'delivery',
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
        // Read literally rather than defaulted from the column's own default: a screen decides
        // whether to draw a delivery column from this field.
        expect(row.fulfilmentType).toBe('delivery');
        expect(row.customer).toEqual({ displayName: 'Layla Haddad', phone: '+971500000001' });
    });

    it('maps the delivery job whole, and keeps a null one null', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: [
                        wireRow({
                            status: 'confirmed',
                            delivery_job: {
                                id: JOB_UUID,
                                status: 'assigned',
                                tracking_status: 'en_route',
                                driver_user_id: DRIVER_UUID,
                                assigned_at: '2026-08-16T04:10:00+00:00',
                                lock_version: 3,
                            },
                        }),
                        // A pickup: never driven anywhere, so there is no run and never will be.
                        wireRow({
                            id: OTHER_ORDER_UUID,
                            fulfilment_type: 'pickup',
                            delivery_job: null,
                        }),
                    ],
                    meta: { ...META, count: 2 },
                },
            },
        ]);

        const { rows } = await repository.listQueue();

        expect(rows[0]?.deliveryJob).toEqual({
            id: JOB_UUID,
            status: 'assigned',
            trackingStatus: 'en_route',
            driverUserId: DRIVER_UUID,
            assignedAt: '2026-08-16T04:10:00+00:00',
            // The job's own validator, not the order's — the two move independently, and the
            // order above is still on `lock_version: 1`.
            lockVersion: 3,
        });
        expect(rows[0]?.lockVersion).toBe(1);

        // Not defaulted to `{}`: a run that exists with nothing in it is the one reading of this
        // field that is never true.
        expect(rows[1]?.deliveryJob).toBeNull();
        expect(rows[1]?.fulfilmentType).toBe('pickup');
    });

    it('carries an unassigned job through with a null driver rather than dropping the job', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: [
                        wireRow({
                            status: 'confirmed',
                            delivery_job: {
                                id: JOB_UUID,
                                status: 'pending',
                                tracking_status: 'awaiting_assignment',
                                driver_user_id: null,
                                assigned_at: null,
                                lock_version: 0,
                            },
                        }),
                    ],
                    meta: META,
                },
            },
        ]);

        const [row] = (await repository.listQueue()).rows;

        // "A run exists and nobody has it" is a different state from "there is no run", and the
        // desk acts on the first and waits on the second.
        expect(row?.deliveryJob?.driverUserId).toBeNull();
        expect(row?.deliveryJob?.assignedAt).toBeNull();
        // Zero is a real validator on a job nobody has written to yet, never a missing one.
        expect(row?.deliveryJob?.lockVersion).toBe(0);
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

describe('createApiOrderDeskRepository — listCalendar', () => {
    function counts(order: number, scheduled: number, projected: number) {
        return { order, scheduled, projected };
    }

    const CALENDAR_META = {
        correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4901',
        from: '2026-08-17',
        to: '2026-08-23',
        day_count: 7,
        max_window_days: 60,
    };

    it('sends both bounds and no branch when none was named', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { days: [] }, meta: CALENDAR_META } },
        ]);

        await repository.listCalendar({ from: '2026-08-17', to: '2026-08-23' });

        expect(calls[0]?.method).toBe('GET');
        // Both bounds always: this endpoint has no default window, and an absent one is a 422
        // rather than a sensible guess.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/calendar?from=2026-08-17&to=2026-08-23');
    });

    it('sends branch_id as a query parameter, matching the rest of the order-desk family', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { days: [] }, meta: CALENDAR_META } },
        ]);

        await repository.listCalendar({
            from: '2026-08-17',
            to: '2026-08-23',
            branchId: BRANCH_UUID as never,
        });

        // Not `X-Branch-Id`: an organisation-wide desk agent selects no branch at all, so a header
        // that had to be present could not express the organisation-wide read.
        expect(calls[0]?.path).toBe(
            `/catalogue/order-desk/calendar?from=2026-08-17&to=2026-08-23&branch_id=${BRANCH_UUID}`,
        );
        expect(calls[0]?.headers['x-branch-id']).toBeUndefined();
    });

    /**
     * The three bases arrive separately and stay separate.
     *
     * The assertion is deliberately on the *whole* mapped day rather than on three fields: a mapper
     * that grew a convenient `total` would pass three field assertions and fail this one, which is
     * the only place on this client where that mistake is cheap to make and expensive to find.
     */
    it('maps the three bases without adding them, and keeps the unslotted bucket last', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: {
                        days: [
                            {
                                date: '2026-08-17',
                                counts: counts(2, 3, 4),
                                windows: [
                                    { code: 'morning', counts: counts(2, 1, 1) },
                                    { code: null, counts: counts(0, 2, 3) },
                                ],
                            },
                        ],
                    },
                    meta: CALENDAR_META,
                },
            },
        ]);

        const calendar = await repository.listCalendar({ from: '2026-08-17', to: '2026-08-23' });

        expect(calendar.days).toEqual([
            {
                date: '2026-08-17',
                counts: { order: 2, scheduled: 3, projected: 4 },
                windows: [
                    { code: 'morning', counts: { order: 2, scheduled: 1, projected: 1 } },
                    // Null rather than a placeholder word, and last, exactly as it arrived.
                    { code: null, counts: { order: 0, scheduled: 2, projected: 3 } },
                ],
            },
        ]);
    });

    it('answers the range and the ceiling the server measured against', async () => {
        const { repository } = harness([
            { status: 200, body: { data: { days: [] }, meta: CALENDAR_META } },
        ]);

        const calendar = await repository.listCalendar({ from: '2026-08-17', to: '2026-08-23' });

        // `maxWindowDays` is carried even though nothing this client asks for comes near it: a
        // screen that knows the ceiling bounds its own range instead of learning it from a 422.
        expect(calendar.meta).toEqual({
            from: '2026-08-17',
            to: '2026-08-23',
            dayCount: 7,
            maxWindowDays: 60,
        });
    });

    it('keeps an empty day rather than dropping it, because a hole is not an answer', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: {
                        days: [
                            { date: '2026-08-17', counts: counts(0, 0, 0), windows: [] },
                            {
                                date: '2026-08-18',
                                counts: counts(1, 0, 0),
                                windows: [{ code: 'evening', counts: counts(1, 0, 0) }],
                            },
                        ],
                    },
                    meta: CALENDAR_META,
                },
            },
        ]);

        const calendar = await repository.listCalendar({ from: '2026-08-17', to: '2026-08-23' });

        expect(calendar.days).toHaveLength(2);
        expect(calendar.days[0]?.windows).toEqual([]);
        // Zero on every book, which is a fact about the day rather than a missing row.
        expect(calendar.days[0]?.counts).toEqual({ order: 0, scheduled: 0, projected: 0 });
    });
});

describe('createApiOrderDeskRepository — requirements', () => {
    const REQUIREMENTS_META = {
        correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4902',
        from: '2026-09-07',
        to: '2026-09-20',
        branch_id: BRANCH_UUID,
        max_window_days: 31,
    };

    const ROW = {
        ingredient_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4201',
        stock_item_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4202',
        code: 'sku-flour',
        name_en: 'Flour',
        unit_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4203',
        unit_code: 'kg',
        required: '10.000000',
        available: '2.0000',
        short: '8.0000',
        suggested_buy: '8.0000',
    };

    it('always sends the branch, unlike every other read on this repository', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: { requirements: [], not_computable: { days: 0, reasons: {} } },
                    meta: REQUIREMENTS_META,
                },
            },
        ]);

        await repository.listRequirements({
            from: '2026-09-07',
            to: '2026-09-20',
            branchId: BRANCH_UUID as never,
        });

        // Required rather than optional: half the answer is a quantity on a shelf, and there is no
        // organisation-wide shelf to have one.
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.path).toBe(
            `/catalogue/order-desk/requirements?from=2026-09-07&to=2026-09-20&branch_id=${BRANCH_UUID}`,
        );
        expect(calls[0]?.headers['x-branch-id']).toBeUndefined();
    });

    /**
     * The quantities cross as **strings** and the holes stay outside the rows.
     *
     * Both halves matter. A `Number()` in the mapper would be the client quietly disagreeing with
     * the server about how much flour to buy; a `not_computable` folded into the rows as a zero
     * would read as "you have enough" for a day nobody could compute at all.
     */
    it('carries the quantities verbatim and keeps the holes beside the rows', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: {
                        requirements: [ROW],
                        not_computable: { days: 2, reasons: { plan_has_no_menu: 2 } },
                    },
                    meta: REQUIREMENTS_META,
                },
            },
        ]);

        const answer = await repository.listRequirements({
            from: '2026-09-07',
            to: '2026-09-20',
            branchId: BRANCH_UUID as never,
        });

        expect(answer.requirements).toEqual([
            {
                ingredientId: ROW.ingredient_id,
                stockItemId: ROW.stock_item_id,
                code: 'sku-flour',
                nameEn: 'Flour',
                unitId: ROW.unit_id,
                unitCode: 'kg',
                required: '10.000000',
                available: '2.0000',
                short: '8.0000',
                suggestedBuy: '8.0000',
            },
        ]);
        expect(answer.notComputable).toEqual({ days: 2, reasons: { plan_has_no_menu: 2 } });
        expect(answer.meta).toEqual({
            from: '2026-09-07',
            to: '2026-09-20',
            branchId: BRANCH_UUID,
            maxWindowDays: 31,
        });
    });

    it('keeps a null unit as null rather than inventing a label for it', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: {
                        requirements: [{ ...ROW, unit_id: null, unit_code: null }],
                        not_computable: { days: 0, reasons: {} },
                    },
                    meta: REQUIREMENTS_META,
                },
            },
        ]);

        const answer = await repository.listRequirements({
            from: '2026-09-07',
            to: '2026-09-20',
            branchId: BRANCH_UUID as never,
        });

        expect(answer.requirements[0]?.unitId).toBeNull();
        expect(answer.requirements[0]?.unitCode).toBeNull();
    });

    it('omits branch_id entirely from the badge when there is none, and keeps the null count null', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: { shortfall_count: null, branch_id: null },
                    meta: { correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4903' },
                },
            },
        ]);

        const answer = await repository.countRequirementShortfalls();

        // `branch_id=` would be a caller naming a field it has no value for; the endpoint's whole
        // answer to "no branch" is a null count rather than a refusal.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/requirements/shortfall-count');
        // Never coalesced to zero: that single `??` would turn "unknowable" into "all in stock".
        expect(answer).toEqual({ count: null, branchId: null });
    });

    it('sends the branch when there is one, and answers the count', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: { shortfall_count: 3, branch_id: BRANCH_UUID },
                    meta: { correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4904' },
                },
            },
        ]);

        const answer = await repository.countRequirementShortfalls(BRANCH_UUID as never);

        expect(calls[0]?.path).toBe(
            `/catalogue/order-desk/requirements/shortfall-count?branch_id=${BRANCH_UUID}`,
        );
        expect(answer).toEqual({ count: 3, branchId: BRANCH_UUID });
    });

    it('answers zero as zero, which is a different fact from null', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: { shortfall_count: 0, branch_id: BRANCH_UUID },
                    meta: { correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4905' },
                },
            },
        ]);

        expect((await repository.countRequirementShortfalls(BRANCH_UUID as never)).count).toBe(0);
    });
});

describe('createApiOrderDeskRepository — listDrivers', () => {
    const DRIVERS_META = {
        correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4902',
        count: 2,
        limit: 100,
    };

    it('reads the literal path with no query at all', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: [], meta: { ...DRIVERS_META, count: 0 } } },
        ]);

        await repository.listDrivers();

        expect(calls[0]?.method).toBe('GET');
        // No `branch_id`: a member belongs to the kitchen, not to one of its production sites.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/drivers');
    });

    it('keeps a nameless member with a null name rather than substituting the identifier', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: [
                        { user_id: DRIVER_UUID, display_name: 'Rania Haddad' },
                        { user_id: OTHER_ORDER_UUID, display_name: null },
                    ],
                    meta: DRIVERS_META,
                },
            },
        ]);

        const drivers = await repository.listDrivers();

        expect(drivers.rows).toEqual([
            { userId: DRIVER_UUID, displayName: 'Rania Haddad' },
            // Still assignable, and still nameless. Putting the UUID here would claim it was a
            // person; the em dash belongs to the screen.
            { userId: OTHER_ORDER_UUID, displayName: null },
        ]);
    });

    it('answers the cap alongside the rows, because there is no second page', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: [{ user_id: DRIVER_UUID, display_name: 'Rania Haddad' }],
                    meta: { ...DRIVERS_META, count: 1 },
                },
            },
        ]);

        const drivers = await repository.listDrivers();

        // A screen showing exactly `limit` rows without saying so would look like it had found
        // them all.
        expect(drivers.limit).toBe(100);
    });
});

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

describe('createApiOrderDeskRepository — assignDeliveryJob', () => {
    function assignedJob(overrides: Record<string, unknown> = {}) {
        return {
            id: JOB_UUID,
            order_id: ORDER_UUID,
            status: 'assigned',
            tracking_status: 'awaiting_assignment',
            driver_user_id: DRIVER_UUID,
            assigned_at: '2026-08-16T04:10:00+00:00',
            lock_version: 4,
            ...overrides,
        };
    }

    it('posts to the delivery module’s own path with the job’s version as If-Match', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { job: assignedJob() }, meta: {} } },
        ]);

        const job = await repository.assignDeliveryJob({
            jobId: JOB_UUID,
            driverUserId: DRIVER_UUID,
            lockVersion: 3,
        });

        expect(calls[0]?.method).toBe('POST');
        // Literal and outside the `order-desk` prefix: the route belongs to the delivery module,
        // and only the authority to use it is the desk's.
        expect(calls[0]?.path).toBe(`/delivery/jobs/${JOB_UUID}/assign`);
        // Quoted, the form the server serves in `ETag` and the form its parser expects. Required:
        // absent is a 428 the caller would have spent a round trip to learn.
        expect(calls[0]?.headers['if-match']).toBe('"3"');
        // The body is the person and nothing else — no version, no order, no status.
        expect(calls[0]?.body).toEqual({ driver_user_id: DRIVER_UUID });

        // The new validator comes back, so a reassignment needs no re-read.
        expect(job).toEqual({
            id: JOB_UUID,
            orderId: ORDER_UUID,
            status: 'assigned',
            trackingStatus: 'awaiting_assignment',
            driverUserId: DRIVER_UUID,
            assignedAt: '2026-08-16T04:10:00+00:00',
            lockVersion: 4,
        });
    });

    it('reports the tracking axis the server chose rather than assuming assignment moved it', async () => {
        const { repository } = harness([
            {
                status: 200,
                // The dispatch axis moved; what the customer has been told did not.
                body: { data: { job: assignedJob({ tracking_status: 'awaiting_assignment' }) } },
            },
        ]);

        const job = await repository.assignDeliveryJob({
            jobId: JOB_UUID,
            driverUserId: DRIVER_UUID,
            lockVersion: 3,
        });

        // A client that inferred `picked_up` from "somebody now has it" would tell a customer
        // something nobody promised them.
        expect(job.status).toBe('assigned');
        expect(job.trackingStatus).toBe('awaiting_assignment');
    });

    it('passes a lost race through as a conflict carrying the version to reload against', async () => {
        const { repository } = harness([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'This job changed while you were working on it.',
                        details: { current_lock_version: 5 },
                        correlation_id: 'c-409',
                    },
                },
            },
        ]);

        await expect(
            repository.assignDeliveryJob({
                jobId: JOB_UUID,
                driverUserId: DRIVER_UUID,
                lockVersion: 3,
            }),
        ).rejects.toSatisfy((caught: unknown) => {
            const failure = asApiFailure(caught);
            // Normalised by `failure.ts` into the one field a screen acts on. The dialog offers a
            // reload against this number rather than re-reading the whole queue for it.
            return failure?.code === 'resource.conflict' && failure.currentLockVersion === 5;
        });
    });

    /**
     * A job that has already finished arrives as the same code with **no version on it**, and that
     * absence is the only thing separating the two conflicts on this client.
     *
     * `failure.ts` normalises `resource.conflict` down to `currentLockVersion?`, so
     * `details.status: 'delivered'` — which the endpoint does send — is dropped before a screen sees
     * it. That is deliberate over there (the field is optional precisely because conflicts without a
     * version exist), and it means a caller distinguishes "reload and try again" from "this run is
     * over" by whether a number came back, never by reading a status the client does not carry.
     */
    it('answers a finished job as a conflict with no version to reload against', async () => {
        const { repository } = harness([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'This run has already finished.',
                        details: { status: 'delivered' },
                        correlation_id: 'c-409-terminal',
                    },
                },
            },
        ]);

        await expect(
            repository.assignDeliveryJob({
                jobId: JOB_UUID,
                driverUserId: DRIVER_UUID,
                lockVersion: 3,
            }),
        ).rejects.toSatisfy((caught: unknown) => {
            const failure = asApiFailure(caught);
            return (
                failure?.code === 'resource.conflict' && failure.currentLockVersion === undefined
            );
        });
    });

    it('passes a non-member through as a field validation failure, not as a refusal', async () => {
        const { repository } = harness([
            {
                status: 422,
                body: {
                    error: {
                        code: 'validation.failed',
                        message: 'The submitted data is invalid.',
                        details: {
                            fields: { driver_user_id: ['That person is not a member here.'] },
                        },
                        correlation_id: 'c-422',
                    },
                },
            },
        ]);

        await expect(
            repository.assignDeliveryJob({
                jobId: JOB_UUID,
                driverUserId: DRIVER_UUID,
                lockVersion: 3,
            }),
        ).rejects.toSatisfy((caught: unknown) => {
            const failure = asApiFailure(caught);
            // A validation failure about the *person*, which is what makes it correctable in a
            // picker rather than a refusal about the job.
            return (
                failure?.code === 'validation.failed' &&
                failure.fields['driver_user_id'] !== undefined
            );
        });
    });
});

describe('createApiOrderDeskRepository — the fulfilment-type filter', () => {
    it('sends one bare value, not the bracket form the statuses use', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: [wireRow()], meta: META } },
        ]);

        await repository.listQueue({ fulfilmentType: 'pickup' });

        // `fulfilment_type=pickup`, not `fulfilment_type[]=pickup`. The bracket form exists on
        // `status` because PHP collapses repeated bare parameters to the last value; a
        // single-valued parameter has nothing to lose, and the brackets would make the controller's
        // `Rule::in` see an array.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/queue?fulfilment_type=pickup');
    });

    it('omits the parameter entirely when no kind is chosen', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: [wireRow()], meta: META } },
        ]);

        await repository.listQueue({ window: 'today' });

        // Absent is what the server reads as "all three". A `fulfilment_type=` would be the client
        // naming a field it has no value for, and the endpoint would refuse it.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/queue?window=today');
    });

    it('travels alongside the other filters without disturbing the bracketed one', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: [wireRow()], meta: META } },
        ]);

        await repository.listQueue({
            window: 'overdue',
            statuses: ['placed'],
            fulfilmentType: 'delivery',
            query: 'H360',
        });

        expect(calls[0]?.path).toBe(
            '/catalogue/order-desk/queue?window=overdue&status[]=placed&fulfilment_type=delivery&query=H360',
        );
    });
});

describe('createApiOrderDeskRepository — getCashReport', () => {
    const CASH_META = {
        correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4903',
        date: '2026-05-10',
        branch_id: null,
        timezone: 'UTC',
        count: 2,
    };

    const CASH_BODY = {
        data: {
            rows: [
                {
                    confirmed_by: DRIVER_UUID,
                    display_name: 'Sara Nasr',
                    method: 'cash_on_delivery',
                    currency_code: 'USD',
                    receipt_count: 2,
                    amount_minor_sum: 4_000,
                },
                {
                    confirmed_by: DRIVER_UUID,
                    display_name: null,
                    method: 'cash_on_delivery',
                    currency_code: 'AED',
                    receipt_count: 1,
                    amount_minor_sum: 9_000,
                },
            ],
            totals: [
                {
                    method: 'cash_on_delivery',
                    currency_code: 'USD',
                    receipt_count: 2,
                    amount_minor_sum: 4_000,
                },
                {
                    method: 'cash_on_delivery',
                    currency_code: 'AED',
                    receipt_count: 1,
                    amount_minor_sum: 9_000,
                },
            ],
        },
        meta: CASH_META,
    };

    it('sends the day and nothing else when no branch is named', async () => {
        const { repository, calls } = harness([{ status: 200, body: CASH_BODY }]);

        await repository.getCashReport({ date: '2026-05-10' });

        expect(calls[0]?.method).toBe('GET');
        // No `branch_id=`: omitted is the organisation-wide read, and an empty value would be the
        // client naming a field it has no value for.
        expect(calls[0]?.path).toBe('/catalogue/order-desk/cash-report?date=2026-05-10');
    });

    it('sends the branch when one is named', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { ...CASH_BODY, meta: { ...CASH_META, branch_id: BRANCH_UUID } } },
        ]);

        await repository.getCashReport({ date: '2026-05-10', branchId: BRANCH_UUID as never });

        expect(calls[0]?.path).toBe(
            `/catalogue/order-desk/cash-report?date=2026-05-10&branch_id=${BRANCH_UUID}`,
        );
    });

    it('keeps the currency on every row and total, and folds nothing', async () => {
        const { repository } = harness([{ status: 200, body: CASH_BODY }]);

        const report = await repository.getCashReport({ date: '2026-05-10' });

        expect(report.rows).toEqual([
            {
                confirmedBy: DRIVER_UUID,
                displayName: 'Sara Nasr',
                method: 'cash_on_delivery',
                currencyCode: 'USD',
                receiptCount: 2,
                amountMinorSum: 4_000,
            },
            {
                confirmedBy: DRIVER_UUID,
                // Nameless, and still listed: dropping the row would be losing cash from a
                // reconciliation to protect a null.
                displayName: null,
                method: 'cash_on_delivery',
                currencyCode: 'AED',
                receiptCount: 1,
                amountMinorSum: 9_000,
            },
        ]);

        // Two totals for one method, because they are two currencies. The mapper passes them
        // through — a client-side fold would group on `method` and add dollars to dirhams.
        expect(report.totals).toHaveLength(2);
        expect(report.totals.map((total) => total.currencyCode)).toEqual(['USD', 'AED']);
    });

    it('carries the clock the day was cut on rather than assuming it', async () => {
        const { repository } = harness([{ status: 200, body: CASH_BODY }]);

        const report = await repository.getCashReport({ date: '2026-05-10' });

        expect(report.meta).toEqual({
            date: '2026-05-10',
            branchId: null,
            timezone: 'UTC',
            count: 2,
        });
    });
});
