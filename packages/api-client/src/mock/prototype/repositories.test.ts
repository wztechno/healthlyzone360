import { describe, expect, it } from 'vitest';

import { createMockRepositories } from '../repositories.ts';
import { createPrototypeRepositories } from './repositories.ts';
import { describeRepositoryContract } from './repository-contract.ts';
import { PROTOTYPE_PLAN_IDS } from './fixtures/index.ts';
import { PROTOTYPE_WEEK_START } from './constants.ts';

/**
 * The mock bundle, run against the shared repository contract.
 *
 * The same specification runs against the API bundle in `../../api/prototype-repositories.test.ts`,
 * where it asserts rejections instead of behaviour. Having one file per bundle rather than one
 * combined file is deliberate: a failure names which implementation broke.
 */
describeRepositoryContract({
    name: 'mock bundle',
    mode: 'mock',
    create: () => createPrototypeRepositories(),
});

describe('the prototype repositories inside the foundation mock bundle', () => {
    it('are reachable from createMockRepositories, sharing its latency', async () => {
        const repositories = createMockRepositories({
            scenario: 'consumer-prototype',
            latencyMs: 0,
        });

        const week = await repositories.planner.getWeek(
            PROTOTYPE_PLAN_IDS.week,
            PROTOTYPE_WEEK_START,
        );
        expect(week.days).toHaveLength(7);
        expect(repositories.prototypeStore.onboardingComplete).toBe(true);
    });

    /**
     * The second scenario is not a smaller version of the first: it is the world *before* onboarding
     * has produced anything, which is a state several screens have to render honestly.
     */
    it('gives the onboarding scenario an empty planner and no stored target', async () => {
        const repositories = createMockRepositories({
            scenario: 'consumer-onboarding',
            latencyMs: 0,
        });

        expect(await repositories.nutrition.getCurrentTargets()).toBeNull();

        const week = await repositories.planner.getWeek(
            PROTOTYPE_PLAN_IDS.week,
            PROTOTYPE_WEEK_START,
        );
        expect(week.days.flatMap((day) => day.entries)).toEqual([]);
        expect(week.state).toBe('draft');
        expect(week.targets).toEqual([]);
        expect(week.generatedAt).toBeNull();

        const subscriptions = await repositories.commerce.listSubscriptions();
        expect(subscriptions.items).toEqual([]);

        const queue = await repositories.professional.listReviewQueue();
        expect(queue.items).toEqual([]);
    });

    it('can generate a first week for the onboarding scenario', async () => {
        const repositories = createMockRepositories({
            scenario: 'consumer-onboarding',
            latencyMs: 0,
        });

        const week = await repositories.planner.generate({ weekStart: PROTOTYPE_WEEK_START });
        expect(week.days.flatMap((day) => day.entries).length).toBeGreaterThan(0);
        expect(week.generatedAt).not.toBeNull();
    });

    it('keeps two bundles independent, so no test can see another one’s mutations', async () => {
        const first = createPrototypeRepositories();
        const second = createPrototypeRepositories();

        const entry = (await first.planner.getDay(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START))
            .entries[0];
        expect(entry).toBeDefined();
        if (entry === undefined) return;

        await first.planner.lockEntry(PROTOTYPE_PLAN_IDS.week, entry.id);

        const untouched = (
            await second.planner.getDay(PROTOTYPE_PLAN_IDS.week, PROTOTYPE_WEEK_START)
        ).entries.find((candidate) => candidate.id === entry.id);
        expect(untouched?.locked).toBe(entry.locked);
    });
});
