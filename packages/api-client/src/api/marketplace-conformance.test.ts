import { describe, expect, it } from 'vitest';

import { KitchenId, MealId } from '@healthy360/domain-types';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import * as wire from '../generated/zod.ts';
import { NO_NUTRITION_FACTS, UNSTATED_SERVING } from './marketplace-mappers.ts';
import { createApiMarketplaceRepository } from './marketplace-repository.ts';
import { createTransport } from './transport.ts';

/**
 * The switched marketplace families, mapped from real payloads (M1).
 *
 * **The payloads are recorded, not invented.** Both bodies below were taken verbatim from the
 * seeded stack — `DatabaseSeeder` with the demonstration kitchen's three published meals — and are
 * validated here against the **generated Zod schemas** before anything maps them. That is the check
 * that matters: if the backend's serialisation drifts from the OpenAPI document, the document is
 * regenerated, the schemas change, and these stop parsing. What the API really sends is checked
 * against what the contract says it sends, and only then against what the mapper produces.
 *
 * The transport is driven by a stubbed `fetch` rather than a running server, so the suite stays a
 * unit suite; what it exercises is the whole client path — URL, headers, envelope, mapper.
 */

/** `GET /api/v1/marketplace/kitchens` — Verdant Kitchen, one branch, two zones. */
const RECORDED_KITCHENS = {
    data: [
        {
            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
            name: 'Verdant Kitchen',
            slug: 'verdant-kitchen',
            tagline: '',
            description: '',
            country_code: 'AE',
            cuisines: [],
            diet_classifications: ['vegetarian', 'vegan', 'high_protein'],
            channels: {
                b2c: true,
                b2b: true,
                marketplace: false,
                pos: false,
                subscription: false,
                delivery: false,
                pickup: false,
                corporate: false,
            },
            branches: [
                {
                    id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1aa1',
                    kitchen_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
                    name: 'Al Quoz',
                    area: 'Dubai',
                    country_code: 'AE',
                    time_zone: 'Asia/Dubai',
                    delivery_zones: [
                        {
                            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1bb1',
                            name: 'Emirates wide',
                            area: 'Al Quoz, Business Bay, Jumeirah, Deira',
                            country_code: 'AE',
                            delivery_fee: { amount: 1500, currency: 'USD' },
                            minimum_order: { amount: 5000, currency: 'USD' },
                            estimated_minutes: 90,
                        },
                        {
                            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1bb2',
                            name: 'Al Quoz express',
                            area: 'Al Quoz, Al Barsha',
                            country_code: 'AE',
                            delivery_fee: { amount: 2500, currency: 'USD' },
                            minimum_order: { amount: 3000, currency: 'USD' },
                            estimated_minutes: 30,
                        },
                    ],
                    opening_hours: [
                        {
                            weekday: 1,
                            opens_at: '08:00',
                            closes_at: '20:00',
                            order_cut_off_at: '18:00',
                        },
                        { weekday: 5, opens_at: null, closes_at: null, order_cut_off_at: null },
                    ],
                    supports_pickup: false,
                    is_active: true,
                },
            ],
            rating: null,
            rating_count: 0,
            image_placeholder_id: 'kitchen-verdant-kitchen',
            is_verified: false,
            delivery_windows: [
                {
                    code: 'morning',
                    label: 'Morning',
                    starts_at: '09:00',
                    ends_at: '12:00',
                    weekdays: [],
                },
                {
                    code: 'evening',
                    label: 'Evening',
                    starts_at: '18:00',
                    ends_at: '21:00',
                    weekdays: [1, 2, 3, 4],
                },
            ],
        },
    ],
    meta: {
        correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3d',
        count: 1,
        next_cursor: null,
        has_more: false,
        locale: 'en',
        unsupported_filters: [],
    },
};

/** `GET /api/v1/marketplace/meals` — the published menu, two of its three rows. */
const RECORDED_MEALS = {
    data: [
        {
            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01',
            kitchen_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
            kitchen_name: 'Verdant Kitchen',
            name: 'Grilled chicken and freekeh',
            slug: 'grilled-chicken-freekeh',
            item_type: 'meal',
            description: 'Grilled chicken breast, cracked freekeh and a lemon dressing.',
            meal_types: [],
            diet_classifications: ['high_protein'],
            cuisines: [],
            allergens: ['gluten'],
            serving: null,
            nutrition: null,
            price: { amount: 4200, currency: 'USD' },
            preparation_minutes: null,
            image_placeholder_id: 'meal-grilled-chicken-freekeh',
            availability: [
                {
                    date: '2026-08-02',
                    available: true,
                    remaining: null,
                    order_cut_off_at: '2026-08-02T18:00:00+04:00',
                },
                { date: '2026-08-07', available: false, remaining: null, order_cut_off_at: null },
            ],
            channels: {
                b2c: true,
                b2b: true,
                marketplace: false,
                pos: false,
                subscription: false,
                delivery: false,
                pickup: false,
                corporate: false,
            },
            rating: null,
            rating_count: 0,
        },
        {
            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c02',
            kitchen_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
            kitchen_name: 'Verdant Kitchen',
            name: 'Mezze plate',
            slug: 'mezze-plate',
            item_type: 'meal',
            description: 'Hummus, muhammara and a tahini dressing with warm bread.',
            meal_types: [],
            diet_classifications: ['vegetarian'],
            cuisines: [],
            allergens: ['sesame'],
            serving: null,
            nutrition: null,
            price: { amount: 3800, currency: 'USD' },
            preparation_minutes: null,
            image_placeholder_id: 'meal-mezze-plate',
            availability: [],
            channels: {
                b2c: true,
                b2b: true,
                marketplace: false,
                pos: false,
                subscription: false,
                delivery: false,
                pickup: false,
                corporate: false,
            },
            rating: null,
            rating_count: 0,
        },
    ],
    meta: {
        correlation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1d3e',
        count: 2,
        next_cursor: 'eyJpIjoyfQ',
        has_more: true,
        locale: 'en',
        unsupported_filters: ['energy_max'],
    },
};

interface Call {
    readonly url: string;
    readonly headers: Record<string, string>;
}

function repositoryReturning(body: unknown, calls: Call[] = []) {
    const transport = createTransport({
        baseUrl: 'https://api.example/api/v1',
        tokenStore: {
            ...createMemoryTokenStore(),
            // A token that exists and must never be sent: the marketplace is anonymous.
            get: () => 'a-real-session-token',
        },
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({
                url: String(input),
                headers: (init?.headers ?? {}) as Record<string, string>,
            });
            return Promise.resolve(
                new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            );
        },
    });

    return createApiMarketplaceRepository(transport);
}

describe('the recorded payloads match the generated schemas', () => {
    it('validates a page of kitchens', () => {
        for (const kitchen of RECORDED_KITCHENS.data) {
            expect(wire.zMarketplaceKitchen.parse(kitchen)).toBeTruthy();
        }
    });

    it('validates a page of meals', () => {
        for (const meal of RECORDED_MEALS.data) {
            expect(wire.zMarketplaceMeal.parse(meal)).toBeTruthy();
        }
    });
});

describe('the api marketplace repository', () => {
    it('maps a kitchen, its branches, its zones and its week', async () => {
        const page = await repositoryReturning(RECORDED_KITCHENS).listKitchens();

        expect(page.hasMore).toBe(false);
        expect(page.nextCursor).toBeNull();

        // Keyset pagination cannot know a total without a second count that would disagree with the
        // page; `null` is the contract's word for that, not a mapping that lost something.
        expect(page.totalCount).toBeNull();

        const kitchen = page.items[0];
        expect(kitchen?.name).toBe('Verdant Kitchen');
        expect(kitchen?.channels.b2c).toBe(true);
        expect(kitchen?.channels.pickup).toBe(false);
        expect(kitchen?.branches[0]?.timeZone).toBe('Asia/Dubai');
        expect(kitchen?.branches[0]?.deliveryZones[0]?.deliveryFee).toEqual({
            amount: 1500,
            currency: 'USD',
        });

        // A closed day is a row with no times, and it survives the mapping as one.
        expect(kitchen?.branches[0]?.openingHours[1]).toEqual({
            weekday: 5,
            opensAt: null,
            closesAt: null,
            orderCutOffAt: null,
        });
    });

    it('maps a meal, and turns the absent nutrition into an absence rather than a number', async () => {
        const page = await repositoryReturning(RECORDED_MEALS).listMeals();

        const meal = page.items[0];
        expect(meal?.price).toEqual({ amount: 4200, currency: 'USD' });
        expect(meal?.allergens).toEqual(['gluten']);
        expect(meal?.availability[0]?.orderCutOffAt).toBe('2026-08-02T18:00:00+04:00');
        expect(meal?.availability[0]?.remaining).toBeNull();

        // The whole point of the deviation: the contract's required shape is present, and it
        // contains no figures at all.
        expect(meal?.nutrition).toBe(NO_NUTRITION_FACTS);
        expect(meal?.nutrition.amounts).toEqual([]);
        expect(meal?.serving).toBe(UNSTATED_SERVING);
        expect(page.hasMore).toBe(true);
        expect(page.nextCursor).toBe('eyJpIjoyfQ');
    });

    it('sends the filters the endpoints publish, and nothing else', async () => {
        const calls: Call[] = [];
        await repositoryReturning(RECORDED_MEALS, calls).listMeals({
            query: 'freekeh',
            excludeAllergens: ['gluten' as never, 'peanut' as never],
            dietClassifications: ['vegan' as never],
            price: { max: 5000 },
            availableOn: '2026-08-04',
            limit: 10,
        });

        const url = new URL(calls[0]?.url ?? '');
        expect(url.pathname).toBe('/api/v1/marketplace/meals');
        expect(url.searchParams.get('query')).toBe('freekeh');
        expect(url.searchParams.get('exclude_allergens')).toBe('gluten,peanut');
        expect(url.searchParams.get('diet_classifications')).toBe('vegan');
        expect(url.searchParams.get('price_max')).toBe('5000');
        expect(url.searchParams.get('available_on')).toBe('2026-08-04');
        expect(url.searchParams.get('limit')).toBe('10');

        // An absent filter is absent from the URL rather than sent empty.
        expect(url.searchParams.has('cursor')).toBe(false);
        expect(url.searchParams.has('kitchen_ids')).toBe(false);
    });

    /**
     * The marketplace is identical for everybody, which is exactly why its responses may be cached
     * across a sign-out. Sending a bearer token would break that property and would make a signed-in
     * person's browsing linkable to their account in the access log, for no benefit.
     */
    it('never sends the session token, even when one exists', async () => {
        const calls: Call[] = [];

        await repositoryReturning(RECORDED_KITCHENS, calls).listKitchens();
        await repositoryReturning({ data: RECORDED_KITCHENS.data[0], meta: {} }, calls).getKitchen(
            KitchenId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0'),
        );

        expect(calls).toHaveLength(2);
        for (const call of calls) {
            expect(call.headers['Authorization']).toBeUndefined();
        }
    });

    it('reads one kitchen and one meal by identifier', async () => {
        const calls: Call[] = [];
        await repositoryReturning({ data: RECORDED_KITCHENS.data[0], meta: {} }, calls).getKitchen(
            KitchenId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0'),
        );
        await repositoryReturning({ data: RECORDED_MEALS.data[0], meta: {} }, calls).getMeal(
            MealId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01'),
        );

        expect(calls[0]?.url).toBe(
            'https://api.example/api/v1/marketplace/kitchens/0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1df0',
        );
        expect(calls[1]?.url).toBe(
            'https://api.example/api/v1/marketplace/meals/0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c01',
        );
    });

    /**
     * The families with no backend keep failing in the one nameable way they always did. A screen
     * that reaches for a dietitian is told there is no backend, not shown an empty list. (Plans
     * left this list when DEC1 published real plans and the prepared reads were spread in.)
     */
    it('still rejects the families with no backend', async () => {
        const repository = repositoryReturning(RECORDED_MEALS);

        for (const call of [
            () => repository.listDietitians(),
            () => repository.listDietCategories(),
        ]) {
            const failure = await call().then(() => null, asApiFailure);
            expect(failure?.code).toBe('prototype.not_implemented');
            expect(failure?.message).toContain('/api/v1/');
        }
    });
});
