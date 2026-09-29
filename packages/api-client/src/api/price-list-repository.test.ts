import { PriceListId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import { createTransport } from './transport.ts';

/**
 * `getPriceList` against a transport that answers by path.
 *
 * Three things only a repository test can prove, about what crosses the wire:
 *
 * 1. **Every page of entries is read.** The endpoint is cursor-paged, and the editor saves with a
 *    `PUT` that replaces the whole set — so a list read one page short saved away every price past
 *    the first page.
 * 2. **No read per article.** Each entry carries its article's type and its variant's code, so the
 *    list opens in a fixed number of requests however many articles it prices. The per-article
 *    reads it replaced kept the editor on its skeleton for a minute and more.
 * 3. **A sauce is a product.** Sauces, dressings and frozen meals share the product shape and map to
 *    product rows; reading them as plans left rows pointing at plans that do not exist.
 */

const LIST_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7001';
const PRODUCT_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7101';
const PACK_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7102';
const MEAL_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7201';
const OTHER_MEAL_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7202';
const SAUCE_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7401';
const SAUCE_PACK_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7402';

function entry(
    id: string,
    itemId: string,
    type: string,
    variant: { readonly id: string; readonly code: string } | null,
): Record<string, unknown> {
    return {
        id,
        catalogue_item_id: itemId,
        catalogue_item_type: type,
        catalogue_item_variant_id: variant?.id ?? null,
        catalogue_item_variant_code: variant?.code ?? null,
        min_quantity: null,
        unit_amount_minor: 300,
        currency_code: 'USD',
        price_status: 'confirmed',
        effective_from: '2026-09-21',
        effective_to: null,
        superseded_by_id: null,
        created_at: '2026-09-21T06:01:25+00:00',
    };
}

const PRICE_LIST = {
    id: LIST_UUID,
    organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e7301',
    branch_id: null,
    code: 'retail-usd',
    name_en: 'Retail prices (USD)',
    name_ar: 'أسعار التجزئة',
    currency_code: 'USD',
    customer_scope: 'public',
    status: 'active',
    valid_from: null,
    valid_to: null,
    source_system: null,
    source_ref: null,
    lock_version: 2,
    created_at: '2026-09-21T06:01:25+00:00',
    updated_at: '2026-09-21T06:01:27+00:00',
};

function harness() {
    const paths: string[] = [];

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input) => {
            const url = input instanceof Request ? input.url : String(input);
            const path = decodeURIComponent(url.replace('https://api.example/api/v1', ''));
            paths.push(path);

            const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

            if (path === '/catalogue/sales-channels') return json({ data: [] });
            if (path === `/catalogue/price-lists/${LIST_UUID}`) {
                return json({ data: { price_list: PRICE_LIST, channels: [] } });
            }
            if (path.startsWith(`/catalogue/price-lists/${LIST_UUID}/entries`)) {
                // Two pages: the second reached only through the first's cursor.
                return path.includes('cursor=page-two')
                    ? json({
                          data: [
                              entry('e3', OTHER_MEAL_UUID, 'meal', null),
                              entry('e4', SAUCE_UUID, 'sauce', {
                                  id: SAUCE_PACK_UUID,
                                  code: 'b2c',
                              }),
                          ],
                          meta: { has_more: false, next_cursor: null },
                      })
                    : json({
                          data: [
                              entry('e1', PRODUCT_UUID, 'product', {
                                  id: PACK_UUID,
                                  code: 'jar-250g',
                              }),
                              entry('e2', MEAL_UUID, 'meal', null),
                          ],
                          meta: { has_more: true, next_cursor: 'page-two' },
                      });
            }
            return new Response(JSON.stringify({ error: { code: 'request.invalid' } }), {
                status: 500,
            });
        },
    });

    return { reads: createApiKitchenAdminReads(transport), paths };
}

describe('getPriceList', () => {
    it('reads every page of entries and asks for no article on its own', async () => {
        const { reads, paths } = harness();

        const list = await reads.getPriceList(PriceListId.unsafe(LIST_UUID));

        expect(list.entries).toHaveLength(4);
        expect(list.entries.map((row) => row.item)).toEqual([
            { kind: 'product', productId: PRODUCT_UUID, packCode: 'jar-250g' },
            { kind: 'meal', mealId: MEAL_UUID },
            { kind: 'meal', mealId: OTHER_MEAL_UUID },
            // A sauce is priced as a product — never read as a plan.
            { kind: 'product', productId: SAUCE_UUID, packCode: 'b2c' },
        ]);

        const entryReads = paths.filter((path) => path.includes('/entries'));
        expect(entryReads).toEqual([
            `/catalogue/price-lists/${LIST_UUID}/entries?limit=100`,
            `/catalogue/price-lists/${LIST_UUID}/entries?limit=100&cursor=page-two`,
        ]);
        expect(paths.some((path) => path.startsWith('/catalogue/items/'))).toBe(false);
    });
});
