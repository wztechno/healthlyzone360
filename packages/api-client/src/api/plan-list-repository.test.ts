import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import type { AdminCatalogueItem } from '../generated/types.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import { createTransport } from './transport.ts';

/**
 * `listPlans` against a transport that answers by path (HA-46).
 *
 * The catalogue index carries no configurations or durations, so a plans list read from it alone
 * showed every plan as "No configurations · No durations · Nothing priced yet" while the customer
 * page sold the same plans priced. `withMatrix` reads each row's own matrix; without it the list
 * stays one request, which is all the counts need.
 */

const PLAN_ID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e6001';
const BAND_ID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e6101';
const DURATION_ID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e6201';

const plan: AdminCatalogueItem = {
    id: PLAN_ID,
    organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e6901',
    catalogue_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e6902',
    item_type: 'subscription_plan',
    slug: 'lean-lunch',
    name_en: 'Lean lunch',
    name_ar: 'غداء خفيف',
    is_market_priced: false,
    is_assorted: false,
    portion_factor: '1.000',
    sells_from_finished_stock: false,
    status: 'published',
    data_quality_flags: [],
    stock_blockers: [],
    lock_version: 0,
};

const routes: Record<string, unknown> = {
    '/catalogue/items': { data: [plan], meta: { has_more: false, next_cursor: null } },
    [`/catalogue/plans/${PLAN_ID}/variants`]: {
        data: {
            item: plan,
            cells: [
                {
                    catalogue_item_variant_id: 'variant-lean-1',
                    status: 'active',
                    name_en: null,
                    name_ar: null,
                    meal_combination_option_id: null,
                    energy_band_id: BAND_ID,
                    service_tier: 'standard',
                    includes_snacks: false,
                    meals_per_day: 1,
                    snacks_per_day: 0,
                },
            ],
        },
    },
    [`/catalogue/plans/${PLAN_ID}/variant-durations`]: {
        data: {
            assignments: [
                {
                    id: 'assignment-1',
                    catalogue_item_variant_id: 'variant-lean-1',
                    plan_duration_id: DURATION_ID,
                    discount_percent: '10.00',
                    is_available: true,
                },
            ],
        },
    },
    '/catalogue/plan-vocabulary/durations': {
        data: [{ id: DURATION_ID, duration_kind: 'fixed_days', duration_days: 28 }],
    },
    '/catalogue/plan-vocabulary/combinations': { data: [] },
    '/catalogue/plan-vocabulary/energy-bands': {
        data: [
            {
                id: BAND_ID,
                code: 'kcal-1200-1500',
                name_en: '1200–1500 kcal',
                name_ar: '١٢٠٠–١٥٠٠ سعرة',
                min_kcal: 1200,
                max_kcal: 1500,
                display_order: 1,
                is_active: true,
            },
        ],
    },
};

function harness() {
    const paths: string[] = [];
    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input) => {
            const url = input instanceof Request ? input.url : String(input);
            const path = decodeURIComponent(url.replace('https://api.example/api/v1', '')).split(
                '?',
            )[0];
            paths.push(path ?? '');
            const body = routes[path ?? ''];
            if (body === undefined) {
                return new Response(JSON.stringify({ error: { code: 'request.invalid' } }), {
                    status: 404,
                });
            }
            return new Response(JSON.stringify(body), { status: 200 });
        },
    });
    return { reads: createApiKitchenAdminReads(transport), paths };
}

describe('listPlans', () => {
    it('reads each plan’s configurations and durations when asked for the matrix', async () => {
        const { reads } = harness();

        const page = await reads.listPlans({ page: 1, perPage: 18, withMatrix: true });
        const [row] = page.items;

        expect(row?.variants).toHaveLength(1);
        expect(row?.variants[0]?.energyBand).toEqual({ min: 1200, max: 1500 });
        expect(row?.durations).toEqual([{ kind: 'fixed_days', days: 28, discountPercent: 10 }]);
    });

    it('stays one request when only the rows are needed', async () => {
        const { reads, paths } = harness();

        const page = await reads.listPlans({ page: 1, perPage: 18 });

        expect(paths).toEqual(['/catalogue/items']);
        expect(page.items[0]?.variants).toEqual([]);
    });
});
