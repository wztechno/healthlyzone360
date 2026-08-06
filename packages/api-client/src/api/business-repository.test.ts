import { CorporateProgrammeId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiBusinessReads } from './business-repository.ts';
import { createTransport } from './transport.ts';

function harness(responses: readonly { status: number; body: unknown }[], token = 'token') {
    const calls: { method: string; url: string; path: string }[] = [];
    let index = 0;

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore(token),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const method = init?.method ?? 'GET';
            const path = url.replace('https://api.example/api/v1', '');
            calls.push({ method, url, path });

            const next = responses[index++];
            if (next === undefined) {
                return new Response(JSON.stringify({ error: { code: 'request.invalid' } }), {
                    status: 500,
                });
            }

            return new Response(JSON.stringify(next.body), { status: next.status });
        },
    });

    return { reads: createApiBusinessReads(transport), calls };
}

describe('createApiBusinessReads', () => {
    const programmeId = CorporateProgrammeId.unsafe('programme-1');

    it('lists catalogue items from the corporate buyer endpoint', async () => {
        const itemId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01';

        const { reads, calls } = harness([
            {
                status: 200,
                body: {
                    data: {
                        items: [
                            {
                                id: itemId,
                                name: 'Wholesale lunch tray',
                                item_type: 'meal',
                                seller_organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
                                sales_channel_id: 'channel-wholesale',
                                price: { amount_minor: 1800, currency_code: 'USD' },
                            },
                        ],
                    },
                    meta: {},
                },
            },
        ]);

        const page = await reads.listCatalogue({ programmeId });

        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.path).toBe('/b2b/catalogue/items');
        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.id).toBe(itemId);
        expect(page.items[0]?.programmeId).toBe(programmeId);
        expect(page.items[0]?.contractPrice).toEqual({ amount: 1800, currency: 'USD' });
        expect(page.items[0]?.channels).toEqual(['b2b']);
    });

    it('reads one catalogue item by identifier', async () => {
        const itemId = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01';

        const { reads, calls } = harness([
            {
                status: 200,
                body: {
                    data: {
                        item: {
                            id: itemId,
                            name: 'Wholesale lunch tray',
                            item_type: 'meal',
                            seller_organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
                            sales_channel_id: 'channel-wholesale',
                            price: { amount_minor: 1800, currency_code: 'USD' },
                        },
                    },
                    meta: {},
                },
            },
        ]);

        const item = await reads.getCatalogueItem(itemId);

        expect(calls[0]?.path).toBe(`/b2b/catalogue/items/${itemId}`);
        expect(item.name).toBe('Wholesale lunch tray');
        expect(item.contractPrice).toEqual({ amount: 1800, currency: 'USD' });
    });

    it('filters listed items client-side by search query', async () => {
        const { reads } = harness([
            {
                status: 200,
                body: {
                    data: {
                        items: [
                            {
                                id: 'item-a',
                                name: 'Chicken tray',
                                item_type: 'meal',
                                seller_organisation_id: 'org-1',
                                sales_channel_id: 'channel-1',
                                price: { amount_minor: 1000, currency_code: 'USD' },
                            },
                            {
                                id: 'item-b',
                                name: 'Vegetable pallet',
                                item_type: 'product',
                                seller_organisation_id: 'org-1',
                                sales_channel_id: 'channel-1',
                                price: { amount_minor: 2000, currency_code: 'USD' },
                            },
                        ],
                    },
                    meta: {},
                },
            },
        ]);

        const page = await reads.listCatalogue({ programmeId, query: 'pallet' });

        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.kind).toBe('bulk_package');
    });
});
