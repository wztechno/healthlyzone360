import { MealId, SubscriptionPlanId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import { createApiKitchenAdminWrites } from './kitchen-admin-writes.ts';
import { createTransport } from './transport.ts';

/**
 * `GET`/`PUT /catalogue/plans/{item}/menu` against a recorded transport (Order Desk, phase 5).
 *
 * The two things a repository test can prove that no screen test can: what went **onto the wire**,
 * and what came back off it. Three of those matter here more than usual —
 *
 * 1. **`If-Match` carries the catalogue item's lock version.** `subscription_plan_profiles` has none,
 *    so a client that sent anything else would be refused with a `428`/`412` nobody could account for.
 * 2. **All three fields are always sent**, `null` and `[]` included. The endpoint takes them as
 *    `present`, precisely so "no menu" can be *stated*; a body that dropped an empty field would be a
 *    half-document refused as an accident rather than honoured as a withdrawal.
 * 3. **A read failure stays a failure.** The menu read has no degrade-to-empty path, because an empty
 *    menu is a legitimate *save* — the one that withdraws it — and a failed read rendered as an empty
 *    one is a single press away from turning a kitchen's stock deduction off.
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
            const sent = new Headers(init?.headers);
            const headers: Record<string, string> = {};
            sent.forEach((value, key) => {
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

    return {
        reads: createApiKitchenAdminReads(transport),
        writes: createApiKitchenAdminWrites(transport),
        calls,
    };
}

const PLAN_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5001';
const MEAL_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5101';
const OTHER_MEAL_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5102';
const PLAN_ID = SubscriptionPlanId.unsafe(PLAN_UUID);
const MEAL_ID = MealId.unsafe(MEAL_UUID);
const OTHER_MEAL_ID = MealId.unsafe(OTHER_MEAL_UUID);

function wireItem(overrides: Record<string, unknown> = {}) {
    return {
        id: PLAN_UUID,
        organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5900',
        item_type: 'subscription_plan',
        status: 'published',
        slug: 'lean-fourteen',
        name_en: 'Lean fourteen',
        name_ar: 'الرشيق أربعة عشر',
        description_en: null,
        description_ar: null,
        recipe_id: null,
        image_placeholder_id: null,
        lock_version: 9,
        updated_at: '2026-08-16T10:00:00+00:00',
        ...overrides,
    };
}

function wireEnvelope(
    cycle: { cycle_days: number | null; anchor_date: string | null },
    entries: readonly Record<string, unknown>[],
    item: Record<string, unknown> = wireItem(),
) {
    return {
        data: { item, cycle, entries },
        meta: { count: entries.length },
    };
}

function wireEntry(overrides: Record<string, unknown> = {}) {
    return {
        id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5201',
        cycle_day: 1,
        slot: 'lunch',
        sequence: 1,
        meal_catalogue_item_id: MEAL_UUID,
        meal_name_en: 'Grilled hammour',
        meal_name_ar: 'هامور مشوي',
        ...overrides,
    };
}

describe('getPlanMenu', () => {
    it('reads the plan, its cycle and its entries from one request', async () => {
        const { reads, calls } = harness([
            {
                status: 200,
                body: wireEnvelope({ cycle_days: 14, anchor_date: '2026-09-07' }, [
                    wireEntry(),
                    wireEntry({
                        id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5202',
                        cycle_day: 2,
                        slot: 'dinner',
                        sequence: 2,
                        meal_catalogue_item_id: OTHER_MEAL_UUID,
                    }),
                ]),
            },
        ]);

        const menu = await reads.getPlanMenu(PLAN_ID);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.path).toBe(`/catalogue/plans/${PLAN_UUID}/menu`);

        expect(String(menu.planId)).toBe(PLAN_UUID);
        // The *item's* version, which is what the next write has to send.
        expect(menu.meta.lockVersion).toBe(9);
        expect(menu.cycleDays).toBe(14);
        expect(menu.anchorDate).toBe('2026-09-07');
        expect(menu.entries).toHaveLength(2);
        expect(menu.entries[0]).toEqual({
            id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e5201',
            cycleDay: 1,
            slot: 'lunch',
            sequence: 1,
            mealId: MEAL_UUID,
            mealName: { en: 'Grilled hammour', ar: 'هامور مشوي' },
        });
        expect(menu.entries[1]?.slot).toBe('dinner');
    });

    it('reads an unpublished menu as three empty parts rather than as an absence', async () => {
        const { reads } = harness([
            { status: 200, body: wireEnvelope({ cycle_days: null, anchor_date: null }, []) },
        ]);

        const menu = await reads.getPlanMenu(PLAN_ID);

        expect(menu.cycleDays).toBeNull();
        expect(menu.anchorDate).toBeNull();
        expect(menu.entries).toEqual([]);
    });

    it('renders a withdrawn dish as an empty name rather than inventing one', async () => {
        const { reads } = harness([
            {
                status: 200,
                body: wireEnvelope({ cycle_days: 7, anchor_date: '2026-09-07' }, [
                    wireEntry({ meal_name_en: null, meal_name_ar: null }),
                ]),
            },
        ]);

        const menu = await reads.getPlanMenu(PLAN_ID);

        expect(menu.entries[0]?.mealName).toEqual({ en: '', ar: '' });
        // The identifier survives, so the editor can still say which dish is missing.
        expect(menu.entries[0]?.mealId).toBe(MEAL_UUID);
    });

    it('lets a failed read fail, rather than degrading to an empty menu', async () => {
        const { reads } = harness([
            { status: 403, body: { error: { code: 'authz.permission_denied' } } },
        ]);

        await expect(reads.getPlanMenu(PLAN_ID)).rejects.toBeDefined();
    });
});

describe('replacePlanMenu', () => {
    it('sends the whole document with the item’s lock version in If-Match', async () => {
        const { writes, calls } = harness([
            {
                status: 200,
                body: wireEnvelope(
                    { cycle_days: 14, anchor_date: '2026-09-07' },
                    [wireEntry()],
                    wireItem({ lock_version: 10 }),
                ),
            },
        ]);

        const saved = await writes.replacePlanMenu(PLAN_ID, {
            lockVersion: 9,
            cycleDays: 14,
            anchorDate: '2026-09-07',
            entries: [
                { cycleDay: 1, slot: 'lunch', sequence: 1, mealId: MEAL_ID },
                { cycleDay: 2, slot: 'dinner', sequence: 2, mealId: OTHER_MEAL_ID },
            ],
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('PUT');
        expect(calls[0]?.path).toBe(`/catalogue/plans/${PLAN_UUID}/menu`);
        expect(calls[0]?.headers['if-match']).toBe('"9"');
        expect(calls[0]?.body).toEqual({
            entries: [
                {
                    cycle_day: 1,
                    slot: 'lunch',
                    sequence: 1,
                    meal_catalogue_item_id: MEAL_UUID,
                },
                {
                    cycle_day: 2,
                    slot: 'dinner',
                    sequence: 2,
                    meal_catalogue_item_id: OTHER_MEAL_UUID,
                },
            ],
            menu_cycle_days: 14,
            menu_cycle_anchor_date: '2026-09-07',
        });

        // The response carries the version the *next* save has to send.
        expect(saved.meta.lockVersion).toBe(10);
        expect(saved.entries).toHaveLength(1);
    });

    it('states a withdrawal rather than omitting the fields it has nothing to say about', async () => {
        const { writes, calls } = harness([
            {
                status: 200,
                body: wireEnvelope(
                    { cycle_days: null, anchor_date: null },
                    [],
                    wireItem({ lock_version: 11 }),
                ),
            },
        ]);

        const saved = await writes.replacePlanMenu(PLAN_ID, {
            lockVersion: 10,
            cycleDays: null,
            anchorDate: null,
            entries: [],
        });

        const body = calls[0]?.body;
        expect(Object.keys(body ?? {}).sort()).toEqual([
            'entries',
            'menu_cycle_anchor_date',
            'menu_cycle_days',
        ]);
        expect(body?.entries).toEqual([]);
        expect(body?.menu_cycle_days).toBeNull();
        expect(body?.menu_cycle_anchor_date).toBeNull();

        expect(saved.cycleDays).toBeNull();
        expect(saved.entries).toEqual([]);
    });

    it('surfaces the server’s refusal of an unpublished dish as a validation failure', async () => {
        const { writes } = harness([
            {
                status: 422,
                body: {
                    error: {
                        code: 'validation.failed',
                        message: 'This meal is draft, so it cannot be put on a menu.',
                        fields: {
                            'entries.0.meal_catalogue_item_id': [
                                'This meal is draft, so it cannot be put on a menu.',
                            ],
                        },
                    },
                },
            },
        ]);

        const error = await writes
            .replacePlanMenu(PLAN_ID, {
                lockVersion: 9,
                cycleDays: 7,
                anchorDate: '2026-09-07',
                entries: [{ cycleDay: 1, slot: 'lunch', sequence: 1, mealId: MEAL_ID }],
            })
            .then(() => null)
            .catch((thrown: unknown) => asApiFailure(thrown));

        expect(error?.code).toBe('validation.failed');
    });

    it('surfaces a stale lock version as `resource.conflict`, for the editor’s dialog', async () => {
        const { writes } = harness([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'This plan has moved on.',
                        current_lock_version: 12,
                    },
                },
            },
        ]);

        const error = await writes
            .replacePlanMenu(PLAN_ID, {
                lockVersion: 9,
                cycleDays: null,
                anchorDate: null,
                entries: [],
            })
            .then(() => null)
            .catch((thrown: unknown) => asApiFailure(thrown));

        expect(error?.code).toBe('resource.conflict');
    });
});
