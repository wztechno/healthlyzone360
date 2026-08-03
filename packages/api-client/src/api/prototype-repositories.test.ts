import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import type { MarketplaceRepository } from '../contracts/marketplace.ts';
import { describeRepositoryContract } from '../mock/prototype/repository-contract.ts';
import {
    API_PROTOTYPE_REPOSITORIES,
    PROTOTYPE_ENDPOINTS,
    apiMarketplacePrototypeRepository,
    notImplemented,
} from './prototype-repositories.ts';
import { createApiRepositories } from './repositories.ts';

/**
 * The still-unimplemented API surface, run against the same contract as the mock.
 *
 * Everything here rejects, and that is the point: these contracts describe endpoints that do not
 * exist. What is being asserted is that the *surface* is identical, that every method fails in the
 * same, nameable way, and that the fixture world has not crept into the api-mode chunk.
 *
 * **The marketplace needs a stand-in, and the stand-in is the interesting part.** Four of its nine
 * methods are real since M1 (`listKitchens`, `getKitchen`, `listMeals`, `getMeal`); their behaviour
 * is proven in `marketplace-conformance.test.ts`, against a stubbed transport, with real payloads.
 * They are therefore not in the production bundle any more, and they cannot be — a bundle of
 * rejections that still carried them would describe the surface as unimplemented when it is not.
 *
 * What the shared contract helper still buys, and what this stand-in exists to keep, is the **drift
 * check**: it walks all nine marketplace methods and fails if the contract grows one nobody
 * implemented. Wiring the still-prototype five to their real stubs and the switched four to a local
 * rejection keeps that check running over the whole contract while the production code stays
 * honest about which half is which.
 */
const MARKETPLACE_SURFACE: MarketplaceRepository = {
    ...apiMarketplacePrototypeRepository,
    listKitchens: () => notImplemented(SWITCHED_ENDPOINTS.listKitchens),
    getKitchen: () => notImplemented(SWITCHED_ENDPOINTS.getKitchen),
    listMeals: () => notImplemented(SWITCHED_ENDPOINTS.listMeals),
    getMeal: () => notImplemented(SWITCHED_ENDPOINTS.getMeal),
};

/** The four the ledger no longer lists, named here only so the surface check has something to say. */
const SWITCHED_ENDPOINTS = {
    listKitchens: 'GET /api/v1/marketplace/kitchens',
    getKitchen: 'GET /api/v1/marketplace/kitchens/{kitchen}',
    listMeals: 'GET /api/v1/marketplace/meals',
    getMeal: 'GET /api/v1/marketplace/meals/{meal}',
} as const;

describeRepositoryContract({
    name: 'api bundle',
    mode: 'api',
    create: () => ({ ...API_PROTOTYPE_REPOSITORIES, marketplace: MARKETPLACE_SURFACE }),
});

describe('the api bundle exposes the prototype repositories', () => {
    /**
     * Which repositories are still the *shared rejection object*, and which are built per bundle.
     *
     * The distinction is not cosmetic: a repository that holds the transport cannot be shared, so
     * "is it the shared object" is a reliable, cheap test for "has this family been switched on".
     * Four are built per bundle now — the marketplace since M1, and `commerce` and `kitchenAdmin`
     * since the integrator wave, each of which overrides a *part* of an otherwise-rejecting object.
     */
    it('shares the still-proposed repositories and builds the switched ones per bundle', () => {
        const repositories = createApiRepositories({
            baseUrl: 'https://api.example',
            tokenStore: createMemoryTokenStore(),
        });

        expect(repositories.marketplace).toBeDefined();
        expect(repositories.marketplace).not.toBe(
            (API_PROTOTYPE_REPOSITORIES as Record<string, unknown>).marketplace,
        );
        expect(repositories.nutrition).toBe(API_PROTOTYPE_REPOSITORIES.nutrition);
        expect(repositories.planner).toBe(API_PROTOTYPE_REPOSITORIES.planner);
        expect(repositories.foods).toBe(API_PROTOTYPE_REPOSITORIES.foods);
        expect(repositories.virtualDietitian).toBe(API_PROTOTYPE_REPOSITORIES.virtualDietitian);
        expect(repositories.business).toBe(API_PROTOTYPE_REPOSITORIES.business);
        expect(repositories.professional).toBe(API_PROTOTYPE_REPOSITORIES.professional);

        // Commerce is a copy with one real method spread over it: `POST /orders` is served.
        expect(repositories.commerce).not.toBe(API_PROTOTYPE_REPOSITORIES.commerce);
        expect(repositories.commerce.getCart).toBe(API_PROTOTYPE_REPOSITORIES.commerce.getCart);
        expect(repositories.commerce.placeOrder).not.toBe(
            API_PROTOTYPE_REPOSITORIES.commerce.placeOrder,
        );

        // The kitchen workspace is the same arrangement with its two reference reads.
        expect(repositories.kitchenAdmin).not.toBe(API_PROTOTYPE_REPOSITORIES.kitchenAdmin);
        expect(repositories.kitchenAdmin.createMeal).toBe(
            API_PROTOTYPE_REPOSITORIES.kitchenAdmin.createMeal,
        );
        expect(repositories.kitchenAdmin.listAllergenClasses).not.toBe(
            API_PROTOTYPE_REPOSITORIES.kitchenAdmin.listAllergenClasses,
        );
        expect(repositories.kitchenAdmin.listServiceAreas).not.toBe(
            API_PROTOTYPE_REPOSITORIES.kitchenAdmin.listServiceAreas,
        );
    });

    /**
     * The four journey repositories are real, and the cheapest proof that they are is that they do
     * not reject the way a stub does. Their behaviour is proven against a stubbed transport in
     * `journeys-conformance.test.ts`; this is the registration check.
     */
    it('carries the four journey repositories as ordinary bundle members', () => {
        const repositories = createApiRepositories({
            baseUrl: 'https://api.example',
            tokenStore: createMemoryTokenStore(),
        });

        expect(typeof repositories.verification.issueChallenge).toBe('function');
        expect(typeof repositories.account.getOverview).toBe('function');
        expect(typeof repositories.guest.startSession).toBe('function');
        expect(typeof repositories.b2bApplication.getApplication).toBe('function');
    });

    /**
     * The management endpoints live under two prefixes and nowhere else: `/reference/` for the
     * platform-owned vocabularies a kitchen may only read, `/catalogue/` for the rows it owns.
     * Asserted rather than assumed, because a management path that leaked into, say,
     * `/marketplace/` would be an anonymous surface serving confidential data.
     */
    it('serves kitchen management from the reference and catalogue families only', () => {
        const adminEndpoints = Object.entries(PROTOTYPE_ENDPOINTS)
            .filter(([name]) => name.startsWith('admin'))
            .map(([, endpoint]) => endpoint);

        expect(adminEndpoints.length).toBeGreaterThan(40);
        for (const endpoint of adminEndpoints) {
            expect(endpoint).toMatch(/^(GET|POST|PUT|PATCH) \/api\/v1\/(reference|catalogue)\//);
        }
    });

    /** Lifecycle transitions are sub-resource actions, never a status on a `PATCH` (plan §4.15). */
    it('models publish, retire and archive as POST actions', () => {
        for (const [name, endpoint] of Object.entries(PROTOTYPE_ENDPOINTS)) {
            if (!/^admin(Publish|Retire|Archive)/.test(name)) continue;
            expect(endpoint).toMatch(/^POST .*\/(publish|retire|archive)$/);
        }
    });

    /**
     * A rejected promise, not a synchronous throw. A caller writing `.catch()` without a `try` must
     * get the failure, exactly as it would from any other repository in this package.
     */
    it('rejects rather than throwing synchronously', async () => {
        // Captured rather than discarded: an unawaited rejected promise is an unhandled rejection,
        // which is exactly the failure mode this assertion is about.
        const started: Promise<unknown>[] = [];
        expect(() => started.push(apiMarketplacePrototypeRepository.listPlans())).not.toThrow();
        await expect(started[0]).rejects.toBeInstanceOf(Error);
    });

    it('names the endpoint it would have called', async () => {
        const failure = await apiMarketplacePrototypeRepository
            .listPlans()
            .then(() => null, asApiFailure);
        expect(failure?.message).toContain(PROTOTYPE_ENDPOINTS.listPlans);
    });

    /**
     * The ledger rule (master plan v2 §7): an entry is deleted only once the endpoint is real, the
     * document describes it, the client is generated and the repository is implemented. M1 did that
     * for kitchens and meals, so their entries must be gone — an entry that outlived its stub would
     * make `PROTOTYPE_ENDPOINTS` a list of things that *are* implemented.
     */
    it('no longer lists the marketplace families M1 switched', () => {
        const table = PROTOTYPE_ENDPOINTS as Record<string, string | undefined>;

        expect(table.listKitchens).toBeUndefined();
        expect(table.getKitchen).toBeUndefined();
        expect(table.listMeals).toBeUndefined();
        expect(table.getMeal).toBeUndefined();

        // And the five that are genuinely still prototypes are still listed.
        expect(table.listPlans).toBe('GET /api/v1/marketplace/meal-plans');
        expect(table.listDietitians).toBe('GET /api/v1/marketplace/dietitians');
        expect(table.listDietCategories).toBe('GET /api/v1/marketplace/diet-categories');
    });

    it('gives every endpoint in the table a distinct method and verb', () => {
        const endpoints = Object.values(PROTOTYPE_ENDPOINTS);
        expect(new Set(endpoints).size).toBe(endpoints.length);
        for (const endpoint of endpoints) {
            expect(endpoint).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/api\/v1\//);
        }
    });
});

/**
 * **The import graph.**
 *
 * The fixture world is large — sixty ingredients, twenty recipes rolled up through the nutrition
 * package, forty meals with fourteen days of availability each — and it exists only for mock mode.
 * `createRepositories` keeps the two implementations behind separate dynamic imports so a build can
 * split them; that split is worth nothing if a file under `src/api/` reaches into `src/mock/`.
 *
 * Asserted by reading the source rather than by inspecting a bundle, because it has to fail in the
 * unit suite, on the commit that introduces it, rather than in a bundle-size report later.
 */
describe('the api chunk does not import the fixture world', () => {
    const API_DIR = fileURLToPath(new URL('.', import.meta.url));

    const sources = readdirSync(API_DIR).filter(
        (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );

    it('has source files to check', () => {
        expect(sources.length).toBeGreaterThan(4);
    });

    /**
     * The package root re-exports the scenario *names* so the development banner and the Playwright
     * harness can list them without pulling the world they describe. That only holds while
     * `mock/scenarios.ts` itself stays free of the prototype subtree.
     */
    it('keeps the scenario list free of the prototype fixtures', () => {
        const scenarios = readFileSync(
            fileURLToPath(new URL('../mock/scenarios.ts', import.meta.url)),
            'utf8',
        );
        // Import specifiers only: the prose above the scenarios legitimately points at the store.
        const imports = [...scenarios.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
        expect(imports.filter((specifier) => specifier.includes('prototype'))).toEqual([]);
    });

    it.each(sources)('%s imports nothing from ../mock', (file) => {
        const content = readFileSync(`${API_DIR}${file}`, 'utf8');
        const imports = [...content.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1] ?? '');
        const offenders = imports.filter((specifier) => specifier.includes('mock'));
        expect(offenders, `${file} reaches into the mock world`).toEqual([]);
    });
});
