import { ProductionOrderId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenOpsRepository } from './kitchen-ops-repository.ts';
import { createTransport } from './transport.ts';

/**
 * The production repository (PROD1).
 *
 * Two things are worth testing on this side and nothing else is: the **redaction model** — an
 * absent money key is a reader who may not see it, a null one is a figure nobody could compute, and
 * a mapper that defaulted the first into the second would tell a kitchen manager a batch was free —
 * and the **`If-Match` every edge carries**, because a desk shared by two people is the situation
 * the header exists for.
 */

const ORDER_ID = ProductionOrderId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7001');

interface Call {
    readonly method: string;
    readonly path: string;
    readonly headers: Record<string, string>;
    readonly body: unknown;
}

function harness(bodies: readonly unknown[]) {
    const calls: Call[] = [];
    let index = 0;

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const request = input instanceof Request ? input : new Request(String(input), init);
            const url = new URL(request.url);
            const headers: Record<string, string> = {};
            request.headers.forEach((value, key) => {
                headers[key.toLowerCase()] = value;
            });

            const raw = init?.body;
            calls.push({
                method: request.method,
                path: `${url.pathname}${url.search}`.replace('/api/v1', ''),
                headers,
                body: typeof raw === 'string' && raw !== '' ? JSON.parse(raw) : null,
            });

            const body = bodies[Math.min(index, bodies.length - 1)];
            index += 1;

            return new Response(JSON.stringify(body), { status: 200 });
        },
    });

    return { repository: createApiKitchenOpsRepository(transport), calls };
}

/** A batch as the server sends it, with the money keys present or absent. */
function wireOrder(withCosts: boolean): Record<string, unknown> {
    const order: Record<string, unknown> = {
        id: String(ORDER_ID),
        reference: 'PB-7K3MQ9ZV',
        branch_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7101',
        recipe_version_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7201',
        production_item_ingredient_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7301',
        production_item_name_en: 'Caesar dressing',
        planned_yield_unit_code: 'l',
        status: 'completed',
        batch_factor: '2.000000',
        planned_yield: '40.0000',
        planned_yield_unit_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7401',
        produced_quantity: '38.0000',
        rejected_quantity: '1.0000',
        usable_yield_quantity: '37.0000',
        yield_variance_quantity: '-2.0000',
        production_date: '2026-09-18',
        batch_reference: 'TRAY-14',
        storage_location: 'Freezer 2',
        expiry_date: '2026-10-20',
        is_expired: false,
        confirmed_at: '2026-09-18T08:00:00+00:00',
        started_at: '2026-09-18T09:00:00+00:00',
        completed_at: '2026-09-18T12:00:00+00:00',
        cancelled_at: null,
        abandoned_at: null,
        abandon_reason: null,
        lock_version: 3,
        notes: null,
    };

    if (!withCosts) return order;

    return {
        ...order,
        estimated_cost_amount: '20.000000',
        estimated_cost_currency_code: 'USD',
        weekly_price_publication_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7501',
        // Present and null: nobody could compute it, which is not the same as
        // "you may not see it".
        actual_cost_amount: null,
        actual_cost_currency_code: null,
        actual_unit_cost_amount: null,
        actual_cost_status: 'unvalued',
        valuation_note: 'No cost is recorded for one of the inputs.',
    };
}

describe('production — the redaction model', () => {
    it('carries the money when the server sent it', async () => {
        const { repository } = harness([
            {
                data: { production_order: wireOrder(true), lines: [] },
                meta: { costs_visible: true },
            },
        ]);

        const detail = await repository.getProductionOrder(ORDER_ID);

        expect(detail.costsVisible).toBe(true);
        expect(detail.order.estimatedCostAmount).toBe('20.000000');
        // Present and null stays null — the batch could not be valued, and an em
        // dash is the honest rendering.
        expect(detail.order.actualUnitCostAmount).toBeNull();
        expect(detail.order.actualCostStatus).toBe('unvalued');
    });

    it('leaves the money keys absent when the reader may not see them', async () => {
        const { repository } = harness([
            { data: { production_order: wireOrder(false), lines: [] }, meta: {} },
        ]);

        const detail = await repository.getProductionOrder(ORDER_ID);

        // `undefined`, not `null`. A screen renders the first as nothing at all
        // and the second as an em dash, and collapsing them would claim the
        // batch cost nothing.
        expect(detail.costsVisible).toBe(false);
        expect('estimatedCostAmount' in detail.order).toBe(false);
        expect(detail.order.estimatedCostAmount).toBeUndefined();
    });

    it('keeps every quantity a string, including the ones that look like numbers', async () => {
        const { repository } = harness([
            { data: { production_order: wireOrder(true), lines: [] }, meta: {} },
        ]);

        const detail = await repository.getProductionOrder(ORDER_ID);

        // A `Number()` anywhere in the mapper would be the client quietly
        // disagreeing with the server about how much is on the shelf.
        expect(detail.order.usableYieldQuantity).toBe('37.0000');
        expect(detail.order.yieldVarianceQuantity).toBe('-2.0000');
        expect(typeof detail.order.producedQuantity).toBe('string');
    });
});

describe('production — the batch edges', () => {
    it('sends the version it last read on every edge', async () => {
        const { repository, calls } = harness([
            { data: { production_order: wireOrder(true), lines: [] }, meta: {} },
        ]);

        await repository.confirmProductionOrder(ORDER_ID, 3);
        await repository.startProductionOrder(ORDER_ID, 4);
        await repository.cancelProductionOrder(ORDER_ID, 5);

        expect(calls.map((call) => call.path)).toEqual([
            `/catalogue/production/orders/${String(ORDER_ID)}/confirm`,
            `/catalogue/production/orders/${String(ORDER_ID)}/start`,
            `/catalogue/production/orders/${String(ORDER_ID)}/cancel`,
        ]);
        expect(calls.map((call) => call.headers['if-match'])).toEqual(['"3"', '"4"', '"5"']);
    });

    it('omits a completion field rather than nulling it, because omission means something', async () => {
        const { repository, calls } = harness([
            { data: { production_order: wireOrder(true), lines: [] }, meta: {} },
        ]);

        await repository.completeProductionOrder(ORDER_ID, 3, {
            producedQuantity: 38,
            rejectedQuantity: 1,
            consumed: { 'shelf-1': 9 },
        });

        // A shelf absent from `consumed` means "as planned" and one absent from
        // `waste` means none. Sending `waste: null` would make the server choose
        // between reading it as zero and rejecting it, and neither is what a cook
        // meant.
        expect(calls[0]?.body).toEqual({
            produced_quantity: 38,
            rejected_quantity: 1,
            consumed: { 'shelf-1': 9 },
        });
    });

    it('sends the reason with an abandonment, beside the same report a completion takes', async () => {
        const { repository, calls } = harness([
            { data: { production_order: wireOrder(true), lines: [] }, meta: {} },
        ]);

        await repository.abandonProductionOrder(ORDER_ID, 3, {
            producedQuantity: 5,
            reason: 'The mixer failed halfway through.',
        });

        expect(calls[0]?.body).toEqual({
            produced_quantity: 5,
            reason: 'The mixer failed halfway through.',
        });
    });
});

describe('production — the desk queue', () => {
    it('states its page rather than inferring it from a short list', async () => {
        const { repository, calls } = harness([
            {
                data: { production_orders: [wireOrder(false)] },
                meta: { page: 2, per_page: 50, has_more: true, costs_visible: false },
            },
        ]);

        const page = await repository.listProductionOrders({ status: 'confirmed', page: 2 });

        expect(calls[0]?.path).toBe('/catalogue/production/orders?status=confirmed&page=2');
        expect(page.hasMore).toBe(true);
        expect(page.page).toBe(2);
        expect(page.orders).toHaveLength(1);
    });

    it('does not offer a next page the server did not promise', async () => {
        const { repository } = harness([
            { data: { production_orders: [wireOrder(false)] }, meta: {} },
        ]);

        const page = await repository.listProductionOrders();

        // A pager that offers a page it cannot fetch is worse than one that
        // stops, so a missing `has_more` reads as false rather than as maybe.
        expect(page.hasMore).toBe(false);
    });
});

describe('production — the plan', () => {
    it('keeps the holes beside the lines rather than folding them in as zeroes', async () => {
        const { repository } = harness([
            {
                data: {
                    plan: {
                        batch_factor: '2.000000',
                        ingredients: [
                            {
                                stock_item_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7601',
                                ingredient_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7701',
                                line_kind: 'ingredient',
                                unit_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7801',
                                stock_item_code: 'FLOUR-00',
                                stock_item_name_en: 'Flour, plain',
                                unit_code: 'kg',
                                required: '10.000000',
                                on_hand: '10.0000',
                                reserved: '8.0000',
                                available: '2.0000',
                                missing: '8.0000',
                            },
                        ],
                        packaging: [],
                        not_computable: [
                            { reason_code: 'no_stock_item', detail: 'Ingredient X has no shelf.' },
                        ],
                        short_line_count: 1,
                        is_confirmable: false,
                    },
                },
                meta: {},
            },
        ]);

        const plan = await repository.getProductionOrderPlan(ORDER_ID);

        // "Need nothing for that" and "we could not work out what this needs" are
        // opposite statements; the whole reason they arrive apart is that a
        // client cannot then merge them by accident.
        expect(plan.ingredients).toHaveLength(1);
        expect(plan.notComputable).toEqual([
            { reasonCode: 'no_stock_item', detail: 'Ingredient X has no shelf.' },
        ]);
        expect(plan.isConfirmable).toBe(false);
        // Ten on the shelf, eight claimed by other batches, two free.
        expect(plan.ingredients[0]?.available).toBe('2.0000');
        // The words on the shelf, carried beside the id. A plan rendered as a
        // column of uuids is a plan nobody can shop from.
        expect(plan.ingredients[0]?.stockItemNameEn).toBe('Flour, plain');
        expect(plan.ingredients[0]?.unitCode).toBe('kg');
    });
});

describe('the finance reads PROD1 adds', () => {
    it('never folds two currencies into one valuation, and says what it could not price', async () => {
        const { repository } = harness([
            {
                data: {
                    inventory_value: [
                        { currency_code: 'EUR', value_amount: '30.000000', valued_item_count: 1 },
                        { currency_code: 'USD', value_amount: '20.000000', valued_item_count: 2 },
                    ],
                },
                meta: {
                    as_of: '2026-09-19T08:00:00+00:00',
                    unvalued_item_count: 3,
                    is_complete: false,
                },
            },
        ]);

        const value = await repository.getInventoryValue();

        expect(value.rows).toHaveLength(2);
        // Two valuations rather than one sum: this system has no exchange rate.
        expect(value.rows.map((row) => row.currencyCode)).toEqual(['EUR', 'USD']);
        // The count is what stops the amounts reading complete.
        expect(value.unvaluedItemCount).toBe(3);
        expect(value.isComplete).toBe(false);
        expect(value.asOf).toBe('2026-09-19T08:00:00+00:00');
    });

    it('treats an unstated completeness as incomplete rather than as whole', async () => {
        const { repository } = harness([{ data: { inventory_value: [] }, meta: {} }]);

        const value = await repository.getInventoryValue();

        // A valuation whose completeness the server did not state is one to
        // distrust, not one to present as finished.
        expect(value.isComplete).toBe(false);
    });

    it('reads the pending-valuation queue off the production surface', async () => {
        const { repository, calls } = harness([
            { data: { production_orders: [wireOrder(true)] }, meta: { is_truncated: false } },
        ]);

        const pending = await repository.listPendingProductionValuations();

        expect(calls[0]?.path).toBe('/catalogue/production/valuations-pending');
        expect(pending).toHaveLength(1);
        expect(pending[0]?.actualCostStatus).toBe('unvalued');
    });
});
