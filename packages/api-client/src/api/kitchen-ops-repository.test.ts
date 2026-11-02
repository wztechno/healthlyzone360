import { StockItemId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenOpsRepository } from './kitchen-ops-repository.ts';
import { createTransport } from './transport.ts';

/** A uuid per shelf, so a request's ids can be read back out of its query string. */
function itemId(index: number): StockItemId {
    return StockItemId.unsafe(`0198c5f2-7d3a-7b1e-9c4d-${String(index).padStart(12, '0')}`);
}

/**
 * Answers each request from the ids it carries rather than from a fixed script: the batches fly
 * concurrently, so nothing here may depend on which lands first.
 */
function harness() {
    const requestedIds: string[][] = [];

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            const ids = url.searchParams.getAll('stock_item_ids[]');
            requestedIds.push(ids);

            return new Response(
                JSON.stringify({
                    // One row for the batch's first id — enough to see the answers concatenated.
                    data: {
                        purchases: [
                            {
                                stock_item_id: ids[0],
                                goods_receipt_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9001',
                                document_ref: 'DN-1',
                                received_at: '2026-09-01',
                                quantity: '2.000',
                                unit_id: null,
                                unit_code: 'kg',
                                unit_price_amount: '6.900',
                                cost_currency_code: 'USD',
                                supplier: null,
                            },
                        ],
                    },
                    meta: {},
                }),
                { status: 200 },
            );
        },
    });

    return { repository: createApiKitchenOpsRepository(transport), requestedIds };
}

describe('listItemLatestPurchases', () => {
    it('splits a full page of ids across several requests and returns one list', async () => {
        const { repository, requestedIds } = harness();
        const ids = Array.from({ length: 120 }, (_, index) => itemId(index));

        const purchases = await repository.listItemLatestPurchases(ids);

        // 120 uuids in one query string is the ~7 KB request line nginx answers with a 414.
        expect(requestedIds).toHaveLength(3);
        for (const batch of requestedIds) {
            expect(batch.length).toBeLessThanOrEqual(50);
        }
        expect(requestedIds.flat()).toEqual(ids.map(String));

        expect(purchases.map((purchase) => String(purchase.stockItemId)).sort()).toEqual(
            [String(itemId(0)), String(itemId(50)), String(itemId(100))].sort(),
        );
    });

    it('asks nothing when there are no ids', async () => {
        const { repository, requestedIds } = harness();

        expect(await repository.listItemLatestPurchases([])).toEqual([]);
        expect(requestedIds).toHaveLength(0);
    });
});

describe('getKitchenAnalytics', () => {
    it('asks for the range and maps the report to camelCase', async () => {
        const urls: string[] = [];
        const totals = {
            orders: 4,
            units: 7,
            cancelled: 1,
            fulfilled: 3,
            open: 1,
            fulfilled_with_due: 2,
            on_time: 1,
            avg_lead_minutes: 190,
        };
        const transport = createTransport({
            baseUrl: 'https://api.example',
            tokenStore: createMemoryTokenStore('token'),
            fetch: async (input) => {
                urls.push(input instanceof Request ? input.url : String(input));
                return new Response(
                    JSON.stringify({
                        data: {
                            from: '2026-05-10',
                            to: '2026-05-11',
                            current: totals,
                            previous: { ...totals, avg_lead_minutes: null },
                            days: [{ date: '2026-05-10', orders: 4, units: 7 }],
                            channels: [{ key: 'pos', orders: 1, units: 3 }],
                            items: [
                                {
                                    catalogue_item_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9001',
                                    name_en: 'Freekeh bowl',
                                    name_ar: null,
                                    item_type: 'meal',
                                    orders: 3,
                                    units: 4,
                                    last_ordered_at: '2026-05-11T20:30:00Z',
                                },
                            ],
                        },
                        meta: {},
                    }),
                    { status: 200 },
                );
            },
        });

        const report = await createApiKitchenOpsRepository(transport).getKitchenAnalytics({
            from: '2026-05-10',
            to: '2026-05-11',
        });

        const url = new URL(urls[0] ?? '');
        expect(url.pathname).toMatch(/\/catalogue\/reports\/kitchen-analytics$/);
        expect(url.searchParams.get('from')).toBe('2026-05-10');
        expect(url.searchParams.get('to')).toBe('2026-05-11');
        expect(report.current).toEqual({
            orders: 4,
            units: 7,
            cancelled: 1,
            fulfilled: 3,
            open: 1,
            fulfilledWithDue: 2,
            onTime: 1,
            avgLeadMinutes: 190,
        });
        expect(report.previous.avgLeadMinutes).toBeNull();
        expect(report.items[0]).toEqual({
            catalogueItemId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9001',
            nameEn: 'Freekeh bowl',
            nameAr: null,
            itemType: 'meal',
            orders: 3,
            units: 4,
            lastOrderedAt: '2026-05-11T20:30:00Z',
        });
    });
});
