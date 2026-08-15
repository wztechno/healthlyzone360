import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Parity between the prompt's promised endpoint list and the OpenAPI drafts on disk.
 *
 * The drafts are read as **text**, not parsed. A YAML parser is not a workspace dependency, adding
 * one would violate the phase's zero-new-dependency rule, and the assertions that matter here —
 * "does this path exist", "does every operation have an identifier", "is this still marked as a
 * draft" — are all answerable from the text. A structural check already exists and is stronger:
 * `pnpm run api:lint:proposed` runs Redocly over the same files.
 *
 * What this test is actually for is drift. The drafts and
 * `packages/api-client/src/contracts/*.ts` are maintained together, and it is entirely possible to
 * add a repository method and forget the wire counterpart. This fails when that happens.
 */

const PROPOSED_DIR = fileURLToPath(new URL('../../../../docs/api/proposed/', import.meta.url));

function read(file: string): string {
    return readFileSync(`${PROPOSED_DIR}${file}`, 'utf8');
}

/**
 * The endpoint list from the prompt, verbatim in structure, split by the draft that owns it.
 *
 * Paths are stated without the `/api/v1` prefix because that prefix lives in `servers`, exactly as
 * it does in the implemented contract.
 */
const DRAFTS = {
    'nutrition.v1.draft.yaml': {
        title: 'Nutrition Targets',
        paths: ['/nutrition/calculate-targets', '/nutrition/targets/current'],
        operationIds: [
            'calculateNutritionTargets',
            'getCurrentNutritionTargets',
            'updateCurrentNutritionTargets',
        ],
    },
    'virtual-dietitian.v1.draft.yaml': {
        title: 'Virtual Dietitian',
        paths: [
            '/virtual-dietitian/sessions',
            '/virtual-dietitian/sessions/{session}/messages',
            '/virtual-dietitian/sessions/{session}/generate-draft',
            '/virtual-dietitian/sessions/{session}/request-review',
        ],
        operationIds: [
            'createVirtualDietitianSession',
            'sendVirtualDietitianMessage',
            'generateVirtualDietitianDraft',
            'requestVirtualDietitianReview',
        ],
    },
    'marketplace.v1.draft.yaml': {
        title: 'Marketplace',
        paths: [
            '/marketplace/kitchens',
            '/marketplace/kitchens/{kitchen}',
            '/marketplace/meals',
            '/marketplace/meals/{meal}',
            '/marketplace/meal-plans',
            '/marketplace/meal-plans/{plan}',
        ],
        operationIds: [
            'listMarketplaceKitchens',
            'getMarketplaceKitchen',
            'listMarketplaceMeals',
            'getMarketplaceMeal',
            'listMarketplaceMealPlans',
            'getMarketplaceMealPlan',
        ],
    },
    'meal-plans.v1.draft.yaml': {
        title: 'Meal Plans',
        paths: [
            '/meal-plans',
            '/meal-plans/current',
            '/meal-plans/generate',
            '/meal-plans/{plan}',
            '/meal-plans/{plan}/regenerate',
            '/meal-plans/{plan}/days/{day}/regenerate',
            '/meal-plans/{plan}/entries/{entry}/regenerate',
            '/meal-plans/{plan}/entries/{entry}/lock',
            '/meal-plans/{plan}/entries/{entry}/replace',
            '/meal-plans/{plan}/entries/{entry}/portion',
        ],
        operationIds: [
            'listMealPlans',
            'getCurrentMealPlan',
            'generateMealPlan',
            'getMealPlan',
            'regenerateMealPlan',
            'regenerateMealPlanDay',
            'regenerateMealPlanEntry',
            // The prompt's `POST/DELETE .../lock` is two operations on one path.
            'lockMealPlanEntry',
            'unlockMealPlanEntry',
            'replaceMealPlanEntry',
            'adjustMealPlanEntryPortion',
        ],
    },
    'foods-recipes.v1.draft.yaml': {
        title: 'Foods, Recipes',
        paths: ['/foods', '/recipes', '/recipes/{recipe}', '/grocery-lists/{week}', '/pantry'],
        operationIds: ['listFoods', 'listRecipes', 'getRecipe', 'getGroceryList', 'getPantry'],
    },
    'commerce.v1.draft.yaml': {
        title: 'Cart, Checkout Preview and Subscriptions',
        paths: [
            '/carts',
            '/carts/{cart}/items',
            '/checkouts/preview',
            '/subscriptions/preview',
            '/subscriptions',
            '/subscriptions/{subscription}/pause',
            '/subscriptions/{subscription}/resume',
            '/subscriptions/{subscription}/skip',
        ],
        operationIds: [
            'createCart',
            'addCartItem',
            'previewCheckout',
            'previewSubscription',
            'createSubscription',
            'pauseSubscription',
            'resumeSubscription',
            'skipSubscriptionDay',
        ],
    },
} as const;

type DraftFile = keyof typeof DRAFTS;

const DRAFT_FILES = Object.keys(DRAFTS) as readonly DraftFile[];

/** The prompt's 33 paths / 35 operations, plus the two discovery operations added at the Wave 2 gate. */
const EXPECTED_PATH_COUNT = 35;
const EXPECTED_OPERATION_COUNT = 37;

function operationIdsIn(content: string): readonly string[] {
    return [...content.matchAll(/^\s+operationId:\s+(\S+)\s*$/gm)].map((match) => match[1]!);
}

describe('every promised endpoint exists', () => {
    it.each(DRAFT_FILES)('%s declares each of its paths exactly once', (file) => {
        const content = read(file);
        for (const path of DRAFTS[file].paths) {
            // Path items sit at two-space indent directly under `paths:`.
            const occurrences = content.split(`\n  ${path}:\n`).length - 1;
            expect(occurrences, `${file} → ${path}`).toBe(1);
        }
    });

    it('covers all 35 paths (33 specified + 2 gate additions), with none duplicated across drafts', () => {
        const all = DRAFT_FILES.flatMap((file) => [...DRAFTS[file].paths]);
        expect(all).toHaveLength(EXPECTED_PATH_COUNT);
        expect(new Set(all).size).toBe(EXPECTED_PATH_COUNT);
    });
});

describe('operation identifiers', () => {
    it.each(DRAFT_FILES)('%s declares exactly its expected operationIds, in order', (file) => {
        expect(operationIdsIn(read(file))).toEqual([...DRAFTS[file].operationIds]);
    });

    it('declares 37 operations in total', () => {
        const total = DRAFT_FILES.reduce(
            (count, file) => count + operationIdsIn(read(file)).length,
            0,
        );
        expect(total).toBe(EXPECTED_OPERATION_COUNT);
    });

    it('keeps every operationId unique across the whole draft set', () => {
        const all = DRAFT_FILES.flatMap((file) => operationIdsIn(read(file)));
        const duplicates = all.filter((id, index) => all.indexOf(id) !== index);
        expect(duplicates).toEqual([]);
    });

    it('gives every operation a summary', () => {
        for (const file of DRAFT_FILES) {
            const content = read(file);
            const summaries = [...content.matchAll(/^\s+summary:\s+\S/gm)].length;
            // One `info.summary` plus one per operation.
            expect(summaries, file).toBeGreaterThanOrEqual(operationIdsIn(content).length + 1);
        }
    });
});

describe('draft status is stated everywhere it can be', () => {
    it.each(DRAFT_FILES)('%s carries info.x-status: draft', (file) => {
        expect(read(file)).toContain('x-status: draft');
    });

    it.each(DRAFT_FILES)('%s says NOT IMPLEMENTED in its description', (file) => {
        expect(read(file)).toContain('DRAFT — NOT IMPLEMENTED');
    });

    it.each(DRAFT_FILES)('%s pins a draft version', (file) => {
        expect(read(file)).toContain('version: 0.1.0-draft');
    });

    it('the shared component library is marked draft and is not listed as an API', () => {
        expect(read('_shared/schemas.yaml')).toContain('x-status: draft');
        expect(read('redocly.yaml')).not.toContain('_shared/schemas.yaml');
    });

    it('the README states the status and the endpoint counts', () => {
        const readme = read('README.md');
        expect(readme).toContain('DRAFT, NOT IMPLEMENTED');
        // The layout table understated meal-plans as 8 / 9 and so totalled the
        // prompt's original 33 / 35; the drafts have carried the Wave 2 gate's
        // two extra paths since then. EXPECTED_PATH_COUNT is the authority.
        expect(readme).toContain(`**${EXPECTED_PATH_COUNT} / ${EXPECTED_OPERATION_COUNT}**`);
    });
});

describe('the drafts follow the implemented conventions', () => {
    it.each(DRAFT_FILES)('%s serves under /api/v1', (file) => {
        expect(read(file)).toContain('/api/v1');
    });

    it.each(DRAFT_FILES)(
        '%s reuses the shared error responses rather than inventing them',
        (file) => {
            expect(read(file)).toContain('_shared/schemas.yaml#/components/responses/');
        },
    );

    it('proposes no error code outside the implemented vocabulary', () => {
        const vocabulary = new Set(
            [...read('_shared/schemas.yaml').matchAll(/^\s+-\s+([a-z_]+\.[a-z_]+)\s*$/gm)].map(
                (match) => match[1]!,
            ),
        );
        expect(vocabulary.size).toBeGreaterThan(10);

        for (const file of DRAFT_FILES) {
            for (const match of read(file).matchAll(/^\s+code:\s+([a-z_]+\.[a-z_]+)\s*$/gm)) {
                expect(vocabulary, `${file} → ${match[1]!}`).toContain(match[1]!);
            }
        }
    });
});

describe('deliberate absences', () => {
    it('proposes no payment endpoint and accepts no payment credential', () => {
        const commerce = read('commerce.v1.draft.yaml');
        for (const forbidden of ['card_number', 'payment_method', 'payment_token', 'cvv']) {
            expect(commerce, forbidden).not.toContain(forbidden);
        }
        // The prose explains the absence of `confirmCheckout`; what must not exist is an operation.
        expect(operationIdsIn(commerce)).not.toContain('confirmCheckout');
        expect(commerce).toContain('payment_deferred');
    });

    it('exposes no negotiated B2B price in the consumer-facing marketplace draft', () => {
        const marketplace = read('marketplace.v1.draft.yaml');
        for (const forbidden of ['contract_price', 'volume_tier', 'minimum_order_quantity']) {
            expect(marketplace, forbidden).not.toContain(forbidden);
        }
    });

    it('uses generated image placeholders rather than image URLs in the catalogue drafts', () => {
        for (const file of ['marketplace.v1.draft.yaml', 'foods-recipes.v1.draft.yaml'] as const) {
            expect(read(file), file).toContain('image_placeholder_id');
        }
    });

    it('links no third-party host from any draft', () => {
        for (const file of [...DRAFT_FILES, '_shared/schemas.yaml'] as const) {
            expect(read(file), file).not.toMatch(
                /https?:\/\/(?!healthy360\.com|localhost|\{host\})/,
            );
        }
    });
});
