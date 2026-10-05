import { RecipeId, SubscriptionPlanId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminWrites } from './kitchen-admin-writes.ts';
import { createTransport } from './transport.ts';

/**
 * Kitchen catalogue writes against a recorded transport: what went onto the wire, and what the
 * write answered with. A screen test stubs the repository and cannot see either — which is how the
 * recipe editor's "New draft" shipped sending no request at all.
 */

interface Call {
    readonly method: string;
    readonly path: string;
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
            const headers: Record<string, string> = {};
            new Headers(init?.headers).forEach((value, key) => {
                headers[key] = value;
            });

            calls.push({
                method: init?.method ?? 'GET',
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

    return { writes: createApiKitchenAdminWrites(transport), calls };
}

const RECIPE_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3001';
const RECIPE_ID = RecipeId.unsafe(RECIPE_UUID);

function wireVersion(versionNumber: number, status: 'draft' | 'published') {
    return {
        id: `0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e310${String(versionNumber)}`,
        recipe_id: RECIPE_UUID,
        version_number: versionNumber,
        status,
        completeness: 'indicative',
        waste_coefficient_percent: '3.00',
        packaging_waste_percent: '0.00',
        derivation_state: 'stale',
        lock_version: 0,
    };
}

const WIRE_RECIPE = {
    id: RECIPE_UUID,
    organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3900',
    slug: 'freekeh-bowl',
    name_en: 'Freekeh bowl',
    name_ar: 'Freekeh bowl',
    confidentiality: 'confidential',
    status: 'active',
    published_version_number: 1,
    current_version_status: 'draft',
    current_version_allergen_codes: [],
    current_version_line_count: 0,
    lock_version: 4,
};

describe('createRecipeVersion', () => {
    it('posts the successor as a copy, without If-Match, and answers with it as current', async () => {
        const { writes, calls } = harness([
            { status: 201, body: { data: { version: wireVersion(2, 'draft') } } },
            {
                status: 200,
                body: {
                    data: {
                        recipe: WIRE_RECIPE,
                        versions: [wireVersion(1, 'published'), wireVersion(2, 'draft')],
                    },
                },
            },
            {
                status: 200,
                body: {
                    data: {
                        version: wireVersion(2, 'draft'),
                        lines: [],
                        packaging: [],
                        outputs: [],
                        steps: [],
                        allergens: [],
                    },
                },
            },
            // The unit lookup that follows answers 500 and falls back to no units.
        ]);

        const recipe = await writes.createRecipeVersion(RECIPE_ID, 1);

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe(`/catalogue/recipes/${RECIPE_UUID}/versions`);
        expect(calls[0]?.body).toEqual({ copy_from_version: 1 });
        // Nothing existing is written, so there is no version to be stale against.
        expect(calls[0]?.headers['if-match']).toBeUndefined();

        expect(recipe.currentVersion.versionNumber).toBe(2);
        expect(recipe.currentVersion.status).toBe('draft');
    });
});

describe('updateRecipe', () => {
    it('writes a shelf life on the recipe alone, which a published recipe accepts', async () => {
        const stored = { ...WIRE_RECIPE, shelf_life_days: 7 };
        const { writes, calls } = harness([
            { status: 200, body: { data: { recipe: stored } } },
            {
                status: 200,
                body: { data: { recipe: stored, versions: [wireVersion(1, 'published')] } },
            },
            {
                status: 200,
                body: {
                    data: {
                        version: wireVersion(1, 'published'),
                        lines: [],
                        packaging: [],
                        outputs: [],
                        steps: [],
                        allergens: [],
                    },
                },
            },
        ]);

        const recipe = await writes.updateRecipe(RECIPE_ID, { lockVersion: 4, shelfLifeDays: 7 });

        expect(calls[0]?.method).toBe('PATCH');
        expect(calls[0]?.path).toBe(`/catalogue/recipes/${RECIPE_UUID}`);
        expect(calls[0]?.body).toEqual({ shelf_life_days: 7 });
        expect(calls[0]?.headers['if-match']).toBe('"4"');
        // One write, on the record: the version half would be refused as immutable.
        expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);

        expect(recipe.shelfLifeDays).toBe(7);
    });
});

const PLAN_ID = SubscriptionPlanId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4001');

describe('setPlanVariants', () => {
    it('creates the meals-a-day and energy-band rows a configuration needs, then writes the cell', async () => {
        const { writes, calls } = harness([
            // The kitchen's vocabulary is empty — every plan written from the editor starts here.
            { status: 200, body: { data: [] } },
            { status: 200, body: { data: [] } },
            {
                status: 201,
                body: { data: { combination: { id: 'combination-3', meals_per_day: 3 } } },
            },
            {
                status: 201,
                body: { data: { energy_band: { id: 'band-1', min_kcal: 1400, max_kcal: 1700 } } },
            },
            { status: 200, body: { data: { cells: [] } } },
        ]);

        // The read-back afterwards is not this test's concern; its first request finds no answer.
        await writes
            .setPlanVariants(PLAN_ID, {
                lockVersion: 2,
                variants: [
                    {
                        id: null,
                        name: { en: 'Standard', ar: '' },
                        mealsPerDay: 3,
                        snacksPerDay: 1,
                        energyBand: { min: 1400, max: 1700 },
                    },
                ],
            })
            .catch(() => undefined);

        expect(calls[2]).toMatchObject({
            method: 'POST',
            path: '/catalogue/plan-vocabulary/combinations',
            body: { meals_per_day: 3, includes_breakfast: true },
        });
        expect(calls[3]).toMatchObject({
            method: 'POST',
            path: '/catalogue/plan-vocabulary/energy-bands',
            body: { min_kcal: 1400, max_kcal: 1700 },
        });
        // The configuration is sent, not dropped — the defect was an empty `cells` that came back 200.
        expect(calls[4]).toMatchObject({
            method: 'PUT',
            path: `/catalogue/plans/${String(PLAN_ID)}/variants`,
            body: {
                cells: [
                    expect.objectContaining({
                        meal_combination_option_id: 'combination-3',
                        energy_band_id: 'band-1',
                    }),
                ],
            },
        });
    });
});

describe('updatePlan', () => {
    it('carries each write’s new version into the next, so the profile is not a conflict', async () => {
        const { writes, calls } = harness([
            { status: 200, body: { data: { item: { lock_version: 5 } } } },
            { status: 200, body: { data: { item: { lock_version: 6 }, profile: {} } } },
            { status: 200, body: { data: {} } },
        ]);

        await writes
            .updatePlan(PLAN_ID, {
                lockVersion: 4,
                name: { en: 'Weekday Fit', ar: 'خطة' },
                summary: { en: 'Edited', ar: 'معدّل' },
                dietClassifications: [],
            })
            .catch(() => undefined);

        const ifMatch = calls.slice(0, 3).map((call) => [call.method, call.headers['if-match']]);
        expect(ifMatch).toEqual([
            ['PATCH', '"4"'],
            ['PUT', '"5"'],
            ['PUT', '"6"'],
        ]);
    });
});
