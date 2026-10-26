import { PriceListId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminWholesale } from './kitchen-admin-wholesale.ts';
import { createTransport } from './transport.ts';

/**
 * The wholesale setup's client against a transport that answers by path.
 *
 * What only a wire test proves: the bodies match the FormRequests, the If-Match carries the right
 * record's lock version, and `offerItemOnChannel` **appends** — the item's channel write replaces
 * the whole set, so dropping an existing row would take the item off its retail channel.
 */

const ORG = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7301';
const LIST = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7001';
const RETAIL = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7501';
const WHOLESALE = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7502';
const ITEM = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7101';
const VARIANT = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7102';

function channel(id: string, code: string, kind: string) {
    return {
        id,
        organisation_id: ORG,
        code,
        channel_kind: kind,
        name_en: code,
        name_ar: code,
        order_source: null,
        status: 'active',
        lock_version: 1,
    };
}

const PRICE_LIST = {
    id: LIST,
    organisation_id: ORG,
    branch_id: null,
    code: 'acme-2026',
    name_en: 'Acme agreement',
    name_ar: 'اتفاقية أكمي',
    currency_code: 'USD',
    customer_scope: 'agreement',
    status: 'draft',
    lock_version: 4,
    updated_at: '2026-10-26T06:00:00+00:00',
};

const RETAIL_ROW = {
    id: 'a1',
    sales_channel_id: RETAIL,
    catalogue_item_variant_id: VARIANT,
    is_available: false,
    available_from: '2026-10-01',
    available_to: null,
};

interface Call {
    readonly method: string;
    readonly path: string;
    readonly ifMatch: string | null;
    readonly body: unknown;
}

function harness(itemChannels: readonly Record<string, unknown>[] = [RETAIL_ROW]) {
    const calls: Call[] = [];

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const path = decodeURIComponent(url.replace('https://api.example/api/v1', ''));
            const method = init?.method ?? 'GET';
            const headers = new Headers(init?.headers);
            const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
            calls.push({ method, path, ifMatch: headers.get('If-Match'), body });

            const json = (payload: unknown, status = 200) =>
                new Response(JSON.stringify(payload), { status });

            if (path === '/catalogue/sales-channels' && method === 'GET') {
                return json({
                    data: [
                        channel(RETAIL, 'web', 'b2c_web'),
                        channel(WHOLESALE, 'wholesale', 'b2b'),
                    ],
                });
            }
            if (path === '/catalogue/sales-channels' && method === 'POST') {
                return json(
                    { data: { sales_channel: channel(WHOLESALE, 'wholesale', 'b2b') } },
                    201,
                );
            }
            if (path === '/catalogue/price-lists' && method === 'POST') {
                return json({ data: { price_list: PRICE_LIST } }, 201);
            }
            if (path === `/catalogue/price-lists/${LIST}`) {
                return json({
                    data: {
                        price_list: PRICE_LIST,
                        channels: [
                            {
                                id: 'p2',
                                sales_channel_id: WHOLESALE,
                                price_list_id: LIST,
                                priority: 2,
                            },
                            {
                                id: 'p1',
                                sales_channel_id: RETAIL,
                                price_list_id: LIST,
                                priority: 1,
                            },
                        ],
                    },
                });
            }
            if (path === `/catalogue/price-lists/${LIST}/channels`) {
                return json({
                    data: {
                        price_list: { ...PRICE_LIST, lock_version: 5 },
                        channels: [
                            {
                                id: 'p3',
                                sales_channel_id: WHOLESALE,
                                price_list_id: LIST,
                                priority: 0,
                            },
                        ],
                    },
                });
            }
            if (path === `/catalogue/items/${ITEM}` && method === 'GET') {
                return json({
                    data: {
                        item: { id: ITEM, lock_version: 7, name_en: 'Granola', name_ar: 'غرانولا' },
                        variants: [],
                        channels: itemChannels,
                    },
                });
            }
            if (path === `/catalogue/items/${ITEM}/channels`) {
                return json({
                    data: {
                        item: { id: ITEM, lock_version: 8, name_en: 'Granola', name_ar: 'غرانولا' },
                        channels: [
                            RETAIL_ROW,
                            { ...RETAIL_ROW, id: 'a2', sales_channel_id: WHOLESALE },
                        ],
                    },
                });
            }
            return json({ error: { code: 'request.invalid' } }, 500);
        },
    });

    return { client: createApiKitchenAdminWholesale(transport), calls };
}

describe('kitchen wholesale client', () => {
    it('lists the channel rows by id, kind and both names', async () => {
        const { client } = harness();
        const rows = await client.listSalesChannels();
        expect(rows.map((row) => [row.id, row.kind, row.isActive])).toEqual([
            [RETAIL, 'b2c_web', true],
            [WHOLESALE, 'b2b', true],
        ]);
    });

    it('opens a channel with the store request’s field names', async () => {
        const { client, calls } = harness();
        const created = await client.createSalesChannel({
            code: 'wholesale',
            kind: 'b2b',
            name: { en: 'Wholesale', ar: '' },
        });
        expect(created.id).toBe(WHOLESALE);
        expect(calls[0]).toMatchObject({
            method: 'POST',
            path: '/catalogue/sales-channels',
            body: { code: 'wholesale', channel_kind: 'b2b', name_en: 'Wholesale', name_ar: null },
        });
    });

    it('creates an agreement list, upper-casing the currency', async () => {
        const { client, calls } = harness();
        const list = await client.createPriceList({
            code: 'acme-2026',
            name: { en: 'Acme agreement', ar: 'اتفاقية أكمي' },
            currency: 'usd',
            customerScope: 'agreement',
        });
        expect(String(list.id)).toBe(LIST);
        expect(list.channels).toEqual([]);
        expect(calls[0]?.body).toEqual({
            code: 'acme-2026',
            name_en: 'Acme agreement',
            name_ar: 'اتفاقية أكمي',
            currency_code: 'USD',
            customer_scope: 'agreement',
        });
    });

    it('reads a list’s scope and its channels in priority order', async () => {
        const { client } = harness();
        const read = await client.getPriceListChannels(PriceListId.unsafe(LIST));
        expect(read).toEqual({
            priceListId: LIST,
            lockVersion: 4,
            customerScope: 'agreement',
            salesChannelIds: [RETAIL, WHOLESALE],
        });
    });

    it('replaces the assignments under the list’s lock version', async () => {
        const { client, calls } = harness();
        const saved = await client.setPriceListChannels(PriceListId.unsafe(LIST), {
            lockVersion: 4,
            salesChannelIds: [WHOLESALE],
        });
        expect(saved.lockVersion).toBe(5);
        expect(calls[0]).toMatchObject({
            method: 'PUT',
            path: `/catalogue/price-lists/${LIST}/channels`,
            ifMatch: '"4"',
            body: { channels: [{ sales_channel_id: WHOLESALE, priority: 0 }] },
        });
    });

    it('offers an item on wholesale and keeps every row it already had', async () => {
        const { client, calls } = harness();
        const offering = await client.offerItemOnChannel(ITEM, WHOLESALE);

        expect(offering.salesChannelIds).toEqual([RETAIL, WHOLESALE]);
        expect(offering.name).toEqual({ en: 'Granola', ar: 'غرانولا' });
        const put = calls.find((call) => call.method === 'PUT');
        expect(put).toMatchObject({ path: `/catalogue/items/${ITEM}/channels`, ifMatch: '"7"' });
        expect(put?.body).toEqual({
            channels: [
                {
                    sales_channel_id: RETAIL,
                    catalogue_item_variant_id: VARIANT,
                    is_available: false,
                    available_from: '2026-10-01',
                    available_to: null,
                },
                { sales_channel_id: WHOLESALE, is_available: true },
            ],
        });
    });

    it('writes nothing for an item already on the channel', async () => {
        const { client, calls } = harness([{ ...RETAIL_ROW, sales_channel_id: WHOLESALE }]);
        const offering = await client.offerItemOnChannel(ITEM, WHOLESALE);

        expect(offering.salesChannelIds).toEqual([WHOLESALE]);
        expect(calls.map((call) => call.method)).toEqual(['GET']);
    });
});
