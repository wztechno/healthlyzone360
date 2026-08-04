import { createMemoryTokenStore } from '@healthy360/api-client';
import { apiFailure, throwFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    IngredientAdmin,
    MealAdmin,
    PriceListAdmin,
    ProductAdmin,
    RecipeAdminSummary,
} from '@healthy360/api-client/contracts';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import {
    AllergenCode,
    IngredientId,
    MealId,
    PriceListId,
    ProductId,
    RecipeId,
} from '@healthy360/domain-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { ENTITY_FAMILIES } from './entity-registry.ts';
import {
    REVIEWABLE_FAMILY_KEYS,
    buildReviewQueue,
    editorHref,
    ingredientReviewItems,
    isBlocked,
    isBlockingReason,
    priceListReviewItems,
    productReviewItems,
    recipeReviewItems,
    reviewRowTestId,
} from './review-queue.ts';
import type { ReviewSources } from './review-queue.ts';
import { KitchenHomeScreen } from './screens/kitchen-home-screen.tsx';
import { ReviewScreen } from './screens/review-screen.tsx';

/**
 * The publication review queue (K1.8), against the real mock repositories.
 *
 * Nothing here stubs a hook. Five things this file exists to prove, in rough order of how badly it
 * would matter if they were wrong:
 *
 * 1. **A quarantined record is visible without anybody having to go looking for it.** The whole
 *    slice exists because a food-safety quarantine that only shows up if you happen to open the
 *    right family is a quarantine that gets published around. The seeded contradiction sample — the
 *    synthetic stand-in for the source data's burghul/pita rows — has to appear on this screen from
 *    a cold start, with the reason stated.
 * 2. **The queue aggregates rather than picking a family.** Six families answer at once, and a row
 *    that carries two reasons carries both rather than the first one found. The recipe half is the
 *    sharp case: `statuses` and `staleOnly` are separate server filters with no union, so the same
 *    recipe can arrive twice and must be rendered once.
 * 3. **The deep link points at the right editor and the right record.** A queue whose links were
 *    built by string concatenation somewhere would be one refactor away from sending a person to
 *    `/kitchen/meals/<a-recipe-id>`, and this is the only screen where every link crosses families.
 * 4. **All-clear is honest.** It names what was checked, because a green state whose scope is
 *    unstated is indistinguishable from a query that quietly returned nothing.
 * 5. **The permission boundary holds**, and the hub card and the screen agree — they read one cache
 *    entry precisely so they cannot disagree.
 */

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;
const CLINIC_OWNER = MOCK_SCENARIOS['single-org-owner'].primaryEmail;

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/kitchen/review',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

interface Harness {
    readonly repositories: MockRepositories;
}

/** Signs in, applies the organisation context, lets a test arrange the world, then renders. */
async function renderKitchen(
    node: ReactNode,
    options: {
        readonly email?: string;
        readonly organisationSlug?: string;
        readonly latencyMs?: number;
        readonly prepare?: (repositories: MockRepositories) => Promise<void> | void;
    } = {},
): Promise<Harness> {
    const email = options.email ?? KITCHEN_MANAGER;
    const slug = options.organisationSlug ?? 'verdant-kitchen';

    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: email === CLINIC_OWNER ? 'single-org-owner' : 'multi-org-dietitian',
        latencyMs: options.latencyMs ?? 1,
        tokenStore,
    });
    await repositories.auth.login({ email, password: 'password' });

    const me = await repositories.session.me();
    const membership = me.memberships.find(
        (candidate) => candidate.organisation.slug === slug && candidate.status === 'active',
    );
    if (membership === undefined) throw new Error(`No active membership in "${slug}".`);
    await repositories.context.setContext({ organisationId: membership.organisation.id });

    await options.prepare?.(repositories);

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {node}
        </AppProviders>,
    );

    return { repositories };
}

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

const scratch = createMockRepositories({ scenario: 'multi-org-dietitian', latencyMs: 0 });

/** The seeded contradiction sample this whole slice exists to surface. */
let quarantinedIngredient: IngredientAdmin;

beforeAll(async () => {
    const page = await scratch.kitchenAdmin.listIngredients({
        limit: 100,
        statuses: ['review_required'],
    });
    const first = page.items[0];
    if (first === undefined) {
        throw new Error('The seed carries no quarantined ingredient for the review queue.');
    }
    quarantinedIngredient = first;
});

/* ------------------------------------------------------------------------------------------------
 * Pure builders
 * ---------------------------------------------------------------------------------------------- */

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function ingredient(overrides: Partial<IngredientAdmin> = {}): IngredientAdmin {
    return {
        id: IngredientId.unsafe('01935f6d-0000-7000-8000-00000000a001'),
        meta: meta(),
        name: { en: 'Burghul', ar: 'برغل' },
        reference: null,
        categoryCode: 'store-cupboard',
        measurementUnit: 'g',
        costPer100g: null,
        per100g: null,
        allergens: [],
        dietClassifications: [],
        aliases: [],
        organisationId: null,
        notes: null,
        ...overrides,
    };
}

function recipe(overrides: Partial<RecipeAdminSummary> = {}): RecipeAdminSummary {
    return {
        id: RecipeId.unsafe('01935f6d-0000-7000-8000-00000000b001'),
        meta: meta({ status: 'published' }),
        name: { en: 'Lamb and burghul', ar: 'لحم وبرغل' },
        slug: 'lamb-and-burghul',
        kitchenId: '01935f6d-0000-7000-8000-00000000f000' as RecipeAdminSummary['kitchenId'],
        currentVersionNumber: 1,
        versionCount: 1,
        ...overrides,
    };
}

function emptySources(): ReviewSources {
    return {
        ingredients: [],
        quarantinedRecipes: [],
        staleRecipes: [],
        products: [],
        meals: [],
        plans: [],
        priceLists: [],
    };
}

describe('the review model', () => {
    it('reports a quarantine as the blocking reason it is', () => {
        const [item] = ingredientReviewItems([
            ingredient({ meta: meta({ status: 'review_required' }) }),
        ]);

        expect(item?.reasons).toEqual([{ code: 'quarantined', count: null }]);
        expect(isBlocked(item!)).toBe(true);
        expect(isBlockingReason('quarantined')).toBe(true);
    });

    /**
     * A record that is merely unfinished is *not* blocked, and the distinction is the plan's rather
     * than a presentation choice: publication is refused structurally from a quarantine (§4.7), and
     * an unverified mapping is real work that nothing refuses.
     */
    it('separates work still to do from publication being refused', () => {
        const [item] = ingredientReviewItems([
            ingredient({
                allergens: [
                    {
                        allergenCode: AllergenCode.parse('gluten'),
                        containment: 'contains',
                        marketScope: [],
                        verification: 'unverified',
                        sourceNote: null,
                    },
                ],
            }),
        ]);

        expect(item?.reasons).toEqual([{ code: 'unverifiedAllergens', count: 1 }]);
        expect(isBlocked(item!)).toBe(false);
    });

    it('says nothing about a record with nothing wrong with it', () => {
        expect(
            ingredientReviewItems([ingredient({ meta: meta({ status: 'published' }) })]),
        ).toEqual([]);
    });

    it('marks a name with one language still empty, because that alone blocks publication', () => {
        const [item] = ingredientReviewItems([ingredient({ name: { en: 'Burghul', ar: '  ' } })]);
        expect(item?.reasons).toEqual([{ code: 'missingTranslation', count: null }]);
    });

    /**
     * The sharp case. `RecipeAdminFilter` publishes `statuses` and `staleOnly` separately with no
     * union, so a quarantined *and* stale recipe arrives from both listings — and must be one row
     * carrying two reasons rather than two rows carrying one each.
     */
    it('merges a recipe that arrives from both listings into one row with both reasons', () => {
        const quarantined = recipe({ meta: meta({ status: 'review_required' }) });
        const items = recipeReviewItems([quarantined], [quarantined]);

        expect(items).toHaveLength(1);
        expect(items[0]?.reasons.map((reason) => reason.code)).toEqual([
            'quarantined',
            'derivationStale',
        ]);
    });

    it('counts the price entries that break the amount rule rather than only naming the list', () => {
        const list: PriceListAdmin = {
            id: PriceListId.unsafe('01935f6d-0000-7000-8000-00000000c201'),
            meta: meta({ status: 'draft' }),
            name: { en: 'Retail packs', ar: 'عبوات التجزئة' },
            currency: 'USD',
            kitchenId: '01935f6d-0000-7000-8000-00000000f000' as PriceListAdmin['kitchenId'],
            channels: ['b2c'],
            entries: [
                // Legal: a confirmed price carries an amount.
                {
                    item: { kind: 'meal', mealId: MealId.unsafe('m1') },
                    priceStatus: 'confirmed',
                    amountMinor: 2500,
                    effectiveFrom: '2026-08-01',
                    effectiveUntil: null,
                    note: null,
                },
                // Illegal both ways round — the `CHECK` the migration enforces, on screen.
                {
                    item: { kind: 'meal', mealId: MealId.unsafe('m2') },
                    priceStatus: 'confirmed',
                    amountMinor: null,
                    effectiveFrom: '2026-08-01',
                    effectiveUntil: null,
                    note: null,
                },
                {
                    item: { kind: 'meal', mealId: MealId.unsafe('m3') },
                    priceStatus: 'placeholder',
                    amountMinor: 900,
                    effectiveFrom: '2026-08-01',
                    effectiveUntil: null,
                    note: null,
                },
            ],
        };

        const [item] = priceListReviewItems([list]);
        expect(item?.reasons).toEqual([{ code: 'inconsistentPrices', count: 2 }]);
        expect(isBlocked(item!)).toBe(true);
    });

    it('surfaces unresolved import findings on a product', () => {
        const product: ProductAdmin = {
            id: ProductId.unsafe('01935f6d-0000-7000-8000-00000000c101'),
            meta: meta({ status: 'draft' }),
            name: { en: 'Mixed mezze tray', ar: 'صينية مزّة' },
            description: { en: 'Assorted', ar: 'متنوّعة' },
            categoryCode: 'prepared-food',
            kitchenId: '01935f6d-0000-7000-8000-00000000f000' as ProductAdmin['kitchenId'],
            isMarketPriced: false,
            isAssorted: true,
            packVariants: [],
            channelAvailability: [],
            recipeId: null,
            dietClassifications: [],
            dataQualityFlags: ['dual_pack_single_price', 'assorted_members_expanded'],
        };

        expect(productReviewItems([product])[0]?.reasons).toEqual([
            { code: 'dataQuality', count: 2 },
        ]);
    });

    /**
     * Ordering is a decision, not an accident: a record nobody can publish outranks one that merely
     * needs finishing, and among equals the one that has been sitting longest is the one to look at.
     */
    it('orders blocked rows first, then oldest change first', () => {
        const queue = buildReviewQueue({
            ...emptySources(),
            ingredients: [
                ingredient({
                    id: IngredientId.unsafe('01935f6d-0000-7000-8000-00000000a002'),
                    name: { en: 'Recent unfinished', ar: '' },
                    meta: meta({ updatedAt: '2026-08-02T09:00:00.000Z' }),
                }),
                ingredient({
                    id: IngredientId.unsafe('01935f6d-0000-7000-8000-00000000a003'),
                    name: { en: 'Older unfinished', ar: '' },
                    meta: meta({ updatedAt: '2026-07-01T09:00:00.000Z' }),
                }),
                ingredient({
                    id: IngredientId.unsafe('01935f6d-0000-7000-8000-00000000a004'),
                    name: { en: 'Blocked', ar: 'محجوز' },
                    meta: meta({
                        status: 'review_required',
                        updatedAt: '2026-08-02T10:00:00.000Z',
                    }),
                }),
            ],
        });

        expect(queue.sections[0]?.items.map((item) => item.name.en)).toEqual([
            'Blocked',
            'Older unfinished',
            'Recent unfinished',
        ]);
        expect(queue.total).toBe(3);
        expect(queue.blocked).toBe(1);
    });

    it('drops a family with nothing to report rather than rendering an empty heading', () => {
        const queue = buildReviewQueue({
            ...emptySources(),
            meals: [
                {
                    id: MealId.unsafe('01935f6d-0000-7000-8000-00000000c001'),
                    meta: meta({ status: 'review_required' }),
                    name: { en: 'Herb garden bowl', ar: 'وعاء الأعشاب' },
                    description: { en: '', ar: '' },
                    kitchenId: '01935f6d-0000-7000-8000-00000000f000' as MealAdmin['kitchenId'],
                    recipeId: null,
                    recipeVersionId: null,
                    portionFactor: 1,
                    mealTypes: [],
                    dietClassifications: [],
                    allergens: [],
                    channelAvailability: [],
                    availability: [],
                    imagePlaceholderId: 'meal-1',
                    marginPercent: null,
                },
            ],
        });

        expect(queue.sections.map((section) => section.familyKey)).toEqual(['meals']);
    });

    it('is empty, and reports zero, when nothing needs review', () => {
        expect(buildReviewQueue(emptySources())).toEqual({ sections: [], total: 0, blocked: 0 });
    });

    /**
     * Deep links come from the registry rather than from a second table of paths, which is what
     * keeps `/kitchen/meals/<a-recipe-id>` from ever being constructible.
     */
    it('builds every deep link from the entity registry', () => {
        for (const familyKey of REVIEWABLE_FAMILY_KEYS) {
            const family = ENTITY_FAMILIES.find((candidate) => candidate.key === familyKey);
            expect(family).toBeDefined();
            expect(editorHref(familyKey, 'abc')).toBe(`${family?.href ?? ''}/abc`);
        }
        expect(editorHref('no-such-family', 'abc')).toBeNull();
    });

    it('carries the record identifier into the link, not the family name', () => {
        const [item] = ingredientReviewItems([
            ingredient({
                id: IngredientId.unsafe('01935f6d-0000-7000-8000-00000000a0ff'),
                meta: meta({ status: 'review_required' }),
            }),
        ]);
        expect(item?.href).toBe('/kitchen/ingredients/01935f6d-0000-7000-8000-00000000a0ff');
    });

    it('has a registry entry for every family it can report on', () => {
        const keys = new Set(ENTITY_FAMILIES.map((family) => family.key));
        for (const familyKey of REVIEWABLE_FAMILY_KEYS) expect(keys.has(familyKey)).toBe(true);
        // …and the queue itself is one, so the hub can offer it like any other card.
        expect(keys.has('review')).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------------------------------- */

describe('the review queue screen', () => {
    it('shows the seeded quarantine from a cold start, with the reason stated', async () => {
        await renderKitchen(<ReviewScreen />);

        await untilVisible('kitchen-review-screen');
        await untilVisible('kitchen-review-section-ingredients');

        const row = reviewRowTestId('ingredients', String(quarantinedIngredient.id));
        await untilVisible(row);

        expect(screen.getByTestId(`${row}-reason-quarantined`)).toBeTruthy();
        expect(screen.getByTestId(`${row}-status`)).toHaveTextContent(/Awaiting review/);
        expect(screen.getByTestId(`${row}-name`)).toHaveTextContent(quarantinedIngredient.name.en);
        // Provenance: this row came out of the import, and the queue says so rather than
        // attributing it to whoever last signed in.
        expect(screen.getByTestId(`${row}-updated`)).toHaveTextContent(/import/);
    });

    it('leads with a summary that counts what is blocked separately from what is unfinished', async () => {
        await renderKitchen(<ReviewScreen />);

        await untilVisible('kitchen-review-summary');
        expect(screen.getByTestId('kitchen-review-summary')).toHaveTextContent(/needs? review/i);
        expect(screen.getByTestId('kitchen-review-summary')).toHaveTextContent(
            /cannot be published/,
        );
    });

    it('states what it checked and what it did not, so the scope is never inferred', async () => {
        await renderKitchen(<ReviewScreen />);

        await untilVisible('kitchen-review-scope');
        expect(screen.getByTestId('kitchen-review-scope')).toHaveTextContent(
            /allergen quarantines/,
        );
        // Delivery zones and opening hours have no publication state; the screen says so out loud
        // rather than leaving a reader to wonder whether they were silently skipped.
        expect(screen.getByTestId('kitchen-review-not-checked')).toHaveTextContent(
            /delivery zones and opening hours/,
        );
    });

    it('opens the record’s own editor at the record’s own address', async () => {
        await renderKitchen(<ReviewScreen />);

        const row = reviewRowTestId('ingredients', String(quarantinedIngredient.id));
        await untilVisible(`${row}-open`);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-open`));
        });

        expect(routerMock.__push).toHaveBeenCalledWith(
            `/kitchen/ingredients/${String(quarantinedIngredient.id)}`,
        );
    });

    /**
     * Aggregation across families, arranged rather than assumed: the seed quarantines an ingredient,
     * and this test additionally quarantines a *recipe* by dropping a determination a published
     * version derives from — the store's one real safety event. Both sections must then render.
     */
    it('aggregates several families at once, each under its own heading', async () => {
        await renderKitchen(<ReviewScreen />, {
            prepare: async (repositories) => {
                const page = await repositories.kitchenAdmin.listIngredients({ limit: 100 });
                const mapped = page.items.find((row) => row.allergens.length > 0);
                if (mapped === undefined) throw new Error('No mapped ingredient in the seed.');
                await repositories.kitchenAdmin.setIngredientAllergens(mapped.id, {
                    lockVersion: mapped.meta.lockVersion,
                    mappings: [],
                });
            },
        });

        await untilVisible('kitchen-review-section-ingredients');
        await untilVisible('kitchen-review-section-recipes');

        // The ingredient the arrangement quarantined joins the seeded one under one heading.
        expect(screen.getByTestId('kitchen-review-section-ingredients-count')).toHaveTextContent(
            /\d+ records?/,
        );
    });

    it('celebrates an all-clear queue only alongside what it measured', async () => {
        await renderKitchen(<ReviewScreen />, {
            prepare: async (repositories) => {
                // Archive the one seeded quarantine, which is the only thing in this world's queue
                // to start with. Retired is not `review_required`, so the queue empties.
                const page = await repositories.kitchenAdmin.listIngredients({
                    limit: 100,
                    statuses: ['review_required'],
                });
                for (const row of page.items) {
                    await repositories.kitchenAdmin.archiveIngredient(row.id, {
                        lockVersion: row.meta.lockVersion,
                    });
                }
            },
        });

        await untilVisible('kitchen-review-clear');
        expect(screen.getByTestId('kitchen-review-clear')).toHaveTextContent(
            /Nothing is waiting for review/,
        );
        expect(screen.getByTestId('kitchen-review-clear-scope')).toHaveTextContent(/Checked:/);
        expect(screen.queryByTestId('kitchen-review-sections')).toBeNull();
    });

    it('renders skeletons before the answer, and an error state with a retry after a failure', async () => {
        await renderKitchen(<ReviewScreen />, { latencyMs: 40 });
        await untilVisible('kitchen-review-loading');
        await untilVisible('kitchen-review-screen');
    });

    it('offers a retry rather than a dead end when the queue cannot be read', async () => {
        await renderKitchen(<ReviewScreen />, {
            prepare: (repositories) => {
                // The real bundle with one method replaced: the mock world has no way to *make* a
                // listing fail, and a screen that never renders `ErrorState` is a screen whose
                // error path is a guess.
                const failing = repositories.kitchenAdmin as unknown as {
                    listIngredients: () => Promise<never>;
                };
                failing.listIngredients = () =>
                    Promise.reject(
                        throwFailure(apiFailure('server', { message: 'The catalogue is down.' })),
                    );
            },
        });

        await untilVisible('kitchen-review-error');
        expect(screen.queryByTestId('kitchen-review-sections')).toBeNull();
    });

    it('refuses a signed-in person whose role carries no catalogue permission', async () => {
        await renderKitchen(<ReviewScreen />, {
            email: CLINIC_OWNER,
            organisationSlug: 'cedar-clinic',
        });

        await untilVisible('kitchen-review-forbidden');
        expect(screen.queryByTestId('kitchen-review-screen')).toBeNull();
        expect(screen.queryByTestId('kitchen-review-sections')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The hub card
 * ---------------------------------------------------------------------------------------------- */

describe('the hub’s needs-review card', () => {
    it('counts the same queue the screen renders, and links to it', async () => {
        await renderKitchen(<KitchenHomeScreen />);

        await untilVisible('kitchen-family-review');
        await untilVisible('kitchen-family-review-total');

        // The seed carries exactly one quarantine, and a quarantine is blocking, so both badges
        // are present and both say one.
        expect(screen.getByTestId('kitchen-family-review-total')).toHaveTextContent(
            /1 needs? review/i,
        );
        // A regex, because `Badge` renders its icon glyph inside the same text content.
        expect(screen.getByTestId('kitchen-family-review-blocked')).toHaveTextContent(/1 blocked/);

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-family-review-open'));
        });
        expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/review');
    });

    it('says all clear rather than “0 blocked” when there is nothing to do', async () => {
        await renderKitchen(<KitchenHomeScreen />, {
            prepare: async (repositories) => {
                const page = await repositories.kitchenAdmin.listIngredients({
                    limit: 100,
                    statuses: ['review_required'],
                });
                for (const row of page.items) {
                    await repositories.kitchenAdmin.archiveIngredient(row.id, {
                        lockVersion: row.meta.lockVersion,
                    });
                }
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-family-review-total')).toHaveTextContent(
                    /All clear/,
                );
            },
            { timeout: 15_000 },
        );
        // A permanent "0 blocked" badge would be furniture, so there is not one.
        expect(screen.queryByTestId('kitchen-family-review-blocked')).toBeNull();
    });
});
