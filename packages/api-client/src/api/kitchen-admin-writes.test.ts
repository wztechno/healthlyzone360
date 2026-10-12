import {
    DeliveryWindowId,
    DeliveryZoneId,
    IngredientId,
    RecipeId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import {
    createApiKitchenAdminWrites,
    deriveWindowCode,
    MeasurementUnitLookup,
} from './kitchen-admin-writes.ts';
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

describe('delivery windows', () => {
    const ORG = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3900';
    const ZONE_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e4001';
    const WINDOW_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5001';

    function wireWindow(overrides: Record<string, unknown> = {}) {
        return {
            id: WINDOW_UUID,
            organisation_id: ORG,
            code: 'morning',
            name_en: 'Morning',
            name_ar: 'صباح',
            starts_at: '08:00',
            ends_at: '11:00',
            weekdays: [],
            display_order: 0,
            is_active: true,
            delivery_zone_ids: [],
            ...overrides,
        };
    }

    it('derives a unique code of at most thirty characters from the English name', () => {
        expect(deriveWindowCode('Morning', [])).toBe('morning');
        expect(deriveWindowCode('Morning', ['morning', 'morning-2'])).toBe('morning-3');
        const long = deriveWindowCode('A very long delivery window name indeed', []);
        expect(long.length).toBeLessThanOrEqual(30);
        const suffixed = deriveWindowCode('A very long delivery window name indeed', [long]);
        expect(suffixed.length).toBeLessThanOrEqual(30);
        expect(suffixed.endsWith('-2')).toBe(true);
        expect(deriveWindowCode('صباح', [])).toBe('item');
    });

    it('creates a window with a code unique against the kitchen’s existing ones', async () => {
        const { writes, calls } = harness([
            { status: 200, body: { data: [wireWindow()], meta: {} } },
            {
                status: 201,
                body: {
                    data: { delivery_window: wireWindow({ id: ZONE_UUID, code: 'morning-2' }) },
                    meta: {},
                },
            },
        ]);

        const created = await writes.createDeliveryWindow({
            label: { en: 'Morning', ar: '' },
            weekdays: [1, 2],
            startsAt: '08:00',
            endsAt: '10:00',
        });

        expect(calls[1]).toMatchObject({
            method: 'POST',
            path: '/catalogue/delivery-windows',
            body: {
                code: 'morning-2',
                name_en: 'Morning',
                weekdays: [1, 2],
                starts_at: '08:00',
                ends_at: '10:00',
            },
        });
        expect(calls[1]?.body).not.toHaveProperty('name_ar');
        expect(created.code).toBe('morning-2');
        expect(created.zoneIds).toEqual([]);
    });

    it('replaces a zone’s window set under the zone’s lock version', async () => {
        const wireZone = {
            id: ZONE_UUID,
            organisation_id: ORG,
            branch_id: null,
            code: 'ring',
            name_en: 'Ring',
            name_ar: 'حلقة',
            currency_code: 'USD',
            delivery_fee_minor: null,
            minimum_order_minor: null,
            estimated_minutes: null,
            status: 'active',
            is_active: true,
            lock_version: 4,
            delivery_window_ids: [WINDOW_UUID],
        };
        const { writes, calls } = harness([
            { status: 200, body: { data: { delivery_window_ids: [WINDOW_UUID] }, meta: {} } },
            { status: 200, body: { data: { delivery_zone: wireZone }, meta: {} } },
            { status: 200, body: { data: [], meta: {} } },
        ]);

        const zone = await writes.setZoneWindows(DeliveryZoneId.unsafe(ZONE_UUID), {
            lockVersion: 3,
            windowIds: [DeliveryWindowId.unsafe(WINDOW_UUID)],
        });

        expect(calls[0]).toMatchObject({
            method: 'PUT',
            path: `/catalogue/delivery-zones/${ZONE_UUID}/windows`,
            body: { delivery_window_ids: [WINDOW_UUID] },
        });
        expect(calls[0]?.headers['if-match']).toBe('"3"');
        expect(zone.meta.lockVersion).toBe(4);
        expect(zone.windowIds.map(String)).toEqual([WINDOW_UUID]);
    });
});

/*
 * The reference lookups are shared in flight: N reads that start before the first reference
 * response answers make one request, not N. A burst of N used to trip the API's per-user limiter.
 */
describe('reference lookups', () => {
    interface Reply {
        readonly status: number;
        readonly body: unknown;
    }

    /** A transport answered by path, counting what each path was asked for. */
    function routed(route: (path: string) => Reply) {
        const counts = new Map<string, number>();
        const transport = createTransport({
            baseUrl: 'https://api.example',
            tokenStore: createMemoryTokenStore('token'),
            fetch: async (input) => {
                const url = input instanceof Request ? input.url : String(input);
                const path = decodeURIComponent(url.replace('https://api.example/api/v1', ''));
                counts.set(path, (counts.get(path) ?? 0) + 1);
                const { status, body } = route(path);
                return new Response(JSON.stringify(body), { status });
            },
        });
        return { transport, count: (path: string) => counts.get(path) ?? 0 };
    }

    const REFERENCE = '/catalogue/procurement/reference';
    const CATEGORIES = '/catalogue/ingredient-categories';
    const INGREDIENT_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3a01';
    const NOT_ROUTED: Reply = { status: 500, body: { error: { code: 'request.invalid' } } };
    const REFERENCE_OK: Reply = {
        status: 200,
        body: { data: { measurement_units: [{ id: 'unit-kg', code: 'kg' }] } },
    };
    const RATE_LIMITED: Reply = {
        status: 429,
        body: {
            error: { code: 'rate_limit.exceeded', message: 'Slow down.', correlation_id: 'c' },
        },
    };
    const PERMISSION_DENIED: Reply = {
        status: 403,
        body: {
            error: {
                code: 'authz.permission_denied',
                message: 'Your role does not allow that.',
                details: { permission: 'inventory.view_organisation' },
                correlation_id: 'c',
            },
        },
    };

    /** The recipe read's own two requests, with one line keyed in `unit-kg`. */
    function recipeReply(path: string): Reply {
        if (path === `/catalogue/recipes/${RECIPE_UUID}`) {
            return {
                status: 200,
                body: { data: { recipe: WIRE_RECIPE, versions: [wireVersion(1, 'published')] } },
            };
        }
        if (path === `/catalogue/recipes/${RECIPE_UUID}/versions/1`) {
            return {
                status: 200,
                body: {
                    data: {
                        version: wireVersion(1, 'published'),
                        lines: [
                            {
                                ingredient_id: INGREDIENT_UUID,
                                quantity: '2',
                                unit_id: 'unit-kg',
                                source_designation: 'Freekeh',
                            },
                        ],
                        packaging: [],
                        outputs: [],
                        steps: [],
                        allergens: [],
                    },
                },
            };
        }
        return NOT_ROUTED;
    }

    it('ten concurrent ingredient reads make one ingredient-categories request', async () => {
        const { transport, count } = routed((path) => {
            if (path === CATEGORIES) return { status: 200, body: { data: [] } };
            if (path !== `/catalogue/ingredients/${INGREDIENT_UUID}`) return NOT_ROUTED;
            return {
                status: 200,
                body: {
                    data: {
                        ingredient: {
                            id: INGREDIENT_UUID,
                            name_en: 'Freekeh',
                            name_ar: 'Freekeh',
                            slug: 'freekeh',
                            status: 'active',
                            is_platform: false,
                            aliases: [],
                            allergens: [],
                            diet_classifications: [],
                            ingredient_category_id: null,
                            default_unit_code: 'kg',
                            organisation_id: 'org-1',
                            notes: null,
                            lock_version: 0,
                        },
                        aliases: [],
                    },
                },
            };
        });
        const reads = createApiKitchenAdminReads(transport);

        const ingredients = await Promise.all(
            Array.from({ length: 10 }, () =>
                reads.getIngredient(IngredientId.unsafe(INGREDIENT_UUID)),
            ),
        );

        expect(ingredients).toHaveLength(10);
        expect(count(CATEGORIES)).toBe(1);
    });

    it('ten concurrent recipe reads make one procurement-reference request', async () => {
        const { transport, count } = routed((path) =>
            path === REFERENCE ? REFERENCE_OK : recipeReply(path),
        );
        const reads = createApiKitchenAdminReads(transport);

        const recipes = await Promise.all(
            Array.from({ length: 10 }, () => reads.getRecipe(RECIPE_ID)),
        );

        expect(recipes.map((recipe) => recipe.currentVersion.lines[0]?.unit)).toEqual(
            Array.from({ length: 10 }, () => 'kg'),
        );
        expect(count(REFERENCE)).toBe(1);
    });

    it('falls back for the read a transient failure hit, and recovers on the next', async () => {
        let reference: Reply = RATE_LIMITED;
        const { transport, count } = routed((path) =>
            path === REFERENCE ? reference : recipeReply(path),
        );
        const reads = createApiKitchenAdminReads(transport);

        // The mapper's honest default, not a rejection.
        const throttled = await reads.getRecipe(RECIPE_ID);
        expect(throttled.currentVersion.lines[0]?.unit).toBe('g');
        expect(count(REFERENCE)).toBe(1);

        reference = REFERENCE_OK;
        const recovered = await reads.getRecipe(RECIPE_ID);
        expect(recovered.currentVersion.lines[0]?.unit).toBe('kg');
        expect(count(REFERENCE)).toBe(2);
    });

    it('keeps the fallback for a refused permission, which will not change mid-session', async () => {
        const { transport, count } = routed((path) =>
            path === REFERENCE ? PERMISSION_DENIED : recipeReply(path),
        );
        const reads = createApiKitchenAdminReads(transport);

        expect((await reads.getRecipe(RECIPE_ID)).currentVersion.lines[0]?.unit).toBe('g');
        expect((await reads.getRecipe(RECIPE_ID)).currentVersion.lines[0]?.unit).toBe('g');
        expect(count(REFERENCE)).toBe(1);
    });

    it('the writes-side unit lookup shares one request and retries after a rejection', async () => {
        let reference: Reply = RATE_LIMITED;
        const { transport, count } = routed((path) =>
            path === REFERENCE ? reference : NOT_ROUTED,
        );
        const units = new MeasurementUnitLookup();

        const failed = await Promise.allSettled(
            Array.from({ length: 5 }, () => units.resolve(transport, 'kg')),
        );
        expect(failed.every((result) => result.status === 'rejected')).toBe(true);
        expect(count(REFERENCE)).toBe(1);

        reference = REFERENCE_OK;
        const resolved = await Promise.all([
            units.resolve(transport, 'kg'),
            units.resolve(transport, 'kg'),
            units.resolve(transport, 'g'),
        ]);
        expect(resolved).toEqual(['unit-kg', 'unit-kg', null]);
        expect(count(REFERENCE)).toBe(2);

        // Settled: answered from the kept rows.
        expect(await units.resolve(transport, 'kg')).toBe('unit-kg');
        expect(count(REFERENCE)).toBe(2);
    });

    it('a recipe open that reads and previews at once makes one reference request', async () => {
        // The recipe editor reads the recipe (id → code) while its rollup preview resolves every
        // line's unit (code → id); the two modules used to keep a cache each.
        const { transport, count } = routed((path) =>
            path === REFERENCE ? REFERENCE_OK : recipeReply(path),
        );
        const reads = createApiKitchenAdminReads(transport);
        const units = new MeasurementUnitLookup();

        await Promise.all([
            reads.getRecipe(RECIPE_ID),
            ...Array.from({ length: 13 }, () => units.resolve(transport, 'kg')),
        ]);

        expect(count(REFERENCE)).toBe(1);
    });
});
