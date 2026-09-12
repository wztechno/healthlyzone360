import { apiFailure, conflictFailure, throwFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    CursorPage,
    IngredientAdmin,
    IngredientAdminFilter,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
    AllergenClass,
    RecipeAllergenDeclaration,
    RecipeLine,
    RecipeRollupDraft,
    RecipeRollupPreview,
    RecipeVersionAdmin,
    RecipeVersionSummary,
} from '@healthy360/api-client/contracts';
import { AllergenCode, IngredientId, KitchenId, RecipeId, RoleId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import type { NutritionFacts } from '@healthy360/nutrition';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import type { ReactNode } from 'react';

import { recipeRollupHash } from '../../data/kitchen-admin-hooks.ts';
import {
    ORGANISATION_OWNER_PERMISSIONS,
    TEST_ORGANISATION_ID,
    kitchenManagerSession,
    testActiveContext,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { costPerServing, moveInList, parseQuantity, unitsInDimension } from './format.ts';
import { RecipeEditScreen } from './screens/recipe-edit-screen.tsx';
import { RecipesScreen } from './screens/recipes-screen.tsx';

/**
 * The recipe half of the kitchen workspace, against a world this file declares.
 *
 * Nothing here stubs a hook: the screens still run through `Repositories`, the interface production
 * speaks. What changed with the mock world's removal is where the data comes from — every recipe,
 * every version, every line and every rejection below is authored here and handed to
 * `renderStubScreen`, so "three lines" is a statement about what this test wrote rather than about
 * somebody else's fixture.
 *
 * Five things this file exists to prove:
 *
 * 1. **A version is a real thing.** A published version is read-only, opening a draft from it sends
 *    the contract's smallest legal write, and the editor rebases onto whatever came back.
 * 2. **The line editor keeps its promises.** Stable keys across a move, an undo that restores a row
 *    to *its own position*, a live-region announcement that names where the row landed, and no
 *    silent de-duplication of an ingredient that legitimately appears twice.
 * 3. **The roll-up preview never lies while it is thinking.** A structural edit refreshes at once, a
 *    quantity being typed waits, and in both cases the previous allergen list stays on screen —
 *    dimmed and `aria-busy` — rather than blanking to "no allergens".
 * 4. **Publication is a gate, not a button.** The happy path sends `publishRecipe` at the version it
 *    was looking at; a quarantined recipe cannot be published however hard the button is pressed;
 *    and ingredients carrying no allergen determination are named, with a route to fix each one.
 * 5. **The two safety mechanisms fire here too.** A stale lock version produces the conflict dialog,
 *    and leaving with unsaved lines asks first.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace,
            setParams: jest.fn(),
            back: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/recipes',
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

afterEach(() => {
    jest.useRealTimers();
});

/** Waits for an element, with the contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * Driving the editor
 *
 * The recipe editor is five tabs, not one long form, and its line table is driven by an inline
 * picker rather than an Add button. Both are recent and both changed how every test below reaches
 * a control, so the two moves live here rather than being spelled out fifteen times.
 * ---------------------------------------------------------------------------------------------- */

type EditorTab = 'description' | 'production' | 'packaging' | 'costing' | 'sheet';

/** Switches tabs. Only the active tab's sections are mounted, so this is how a control is reached. */
async function openTab(tab: EditorTab) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(`kitchen-recipe-tab-${tab}`));
    });
}

const LINE_PICKER = 'kitchen-recipe-lines-table-picker';

/**
 * The picker's field, which is the part that exists in the tree.
 *
 * `Picker` puts its testID on the input, the panel and each option — not on the box around them —
 * so the field is what a test waits on and what its absence proves on a read-only version.
 */
const LINE_PICKER_INPUT = `${LINE_PICKER}-input`;

/** The row testIDs the line table draws, one per drawn line. */
const LINE_ROWS = /^kitchen-recipe-lines-table-row-.+-name$/;

/**
 * Adds a raw-material line by picking from the inline field.
 *
 * Focusing opens the panel on the catalogue's first page, so nothing has to be typed — which also
 * keeps the picker's own 250ms search debounce out of tests that are not about it. The pick appends
 * a row at quantity `1` in the ingredient's own unit.
 *
 * The caller must already be on the Production tab.
 */
async function addLine(ingredientId: string) {
    await act(async () => {
        fireEvent(screen.getByTestId(LINE_PICKER_INPUT), 'focus');
    });
    await untilVisible(`${LINE_PICKER}-option-${ingredientId}`);
    await act(async () => {
        fireEvent.press(screen.getByTestId(`${LINE_PICKER}-option-${ingredientId}`));
    });
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 *
 * Every builder is typed against its contract shape, so a contract that grows a required field fails
 * the typecheck here rather than producing a record the screen cannot render. The identifiers are
 * UUIDv7-shaped because both screens parse their route parameter with `RecipeId.safeParse`.
 * ---------------------------------------------------------------------------------------------- */

const TEST_KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');

function recipeIdentifier(ordinal: number): RecipeId {
    return RecipeId.unsafe(`01935f6d-0000-7000-8000-0000000b000${String(ordinal)}`);
}

function ingredientIdentifier(ordinal: number): IngredientId {
    return IngredientId.unsafe(`01935f6d-0000-7000-8000-0000000a000${String(ordinal)}`);
}

function versionIdentifier(recipeOrdinal: number, versionNumber: number): RecipeVersionId {
    return `01935f6d-0000-7000-8000-0000000${String(recipeOrdinal)}e00${String(
        versionNumber,
    )}` as RecipeVersionId;
}

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

/** An ingredient the line editor can offer. `allergens: []` is the unmapped case, on purpose. */
function ingredient(ordinal: number, overrides: Partial<IngredientAdmin> = {}): IngredientAdmin {
    return {
        id: ingredientIdentifier(ordinal),
        meta: meta({ status: 'published' }),
        name: { en: `Ingredient ${String(ordinal)}`, ar: `مكوّن ${String(ordinal)}` },
        reference: `IG-00${String(ordinal)}`,
        subcategoryCode: null,
        categoryCode: 'store-cupboard',
        measurementUnit: 'g',
        purchaseUnit: null,
        composition: null,
        itemsPerUnit: null,
        // Packaging's three, null on food — which every fixture in this file is.
        purchasePrice: null,
        wastePercent: null,
        capacity: null,
        b2bPrice: null,
        b2cPrice: null,
        unitPrice: null,
        isSellable: false,
        costPer100g: { amount: 1.25, currency: 'AED' },
        per100g: null,
        allergens: [],
        dietClassifications: [],
        aliases: [],
        organisationId: TEST_ORGANISATION_ID,
        forkedFromId: null,
        isEditable: true,
        notes: null,
        ...overrides,
    };
}

/** Carries a determination, so a swap against the unmapped one below is unambiguous. */
const MAPPED_INGREDIENT = ingredient(1, {
    name: { en: 'Burghul', ar: 'برغل' },
    allergens: [
        {
            allergenCode: AllergenCode.parse('gluten'),
            containment: 'contains',
            marketScope: [],
            verification: 'supplier_declared',
            sourceNote: 'Supplier specification 4.',
        },
    ],
});

/** No allergen determination at all — the state the publish dialog has to name rather than hide. */
const UNMAPPED_INGREDIENT = ingredient(2, { name: { en: 'Olive oil', ar: 'زيت زيتون' } });

const LIBRARY: readonly IngredientAdmin[] = [MAPPED_INGREDIENT, UNMAPPED_INGREDIENT];

function line(source: IngredientAdmin, overrides: Partial<RecipeLine> = {}): RecipeLine {
    return {
        ingredientId: source.id,
        ingredientName: source.name,
        quantity: 200,
        unit: 'g',
        sourceDesignation: null,
        isOptional: false,
        lineCost: { amount: 2.5, currency: 'AED' },
        ...overrides,
    };
}

/** The declaration the recipe's own lines prove: gluten, from the mapped ingredient. */
const GLUTEN_DECLARATION: RecipeAllergenDeclaration = {
    allergenCode: AllergenCode.parse('gluten'),
    containment: 'contains',
    origin: 'derived',
    sourceIngredientIds: [MAPPED_INGREDIENT.id],
};

interface VersionSeed {
    readonly recipeOrdinal: number;
    readonly versionNumber?: number;
    readonly overrides?: Partial<RecipeVersionAdmin>;
}

function recipeVersion({
    recipeOrdinal,
    versionNumber = 1,
    overrides = {},
}: VersionSeed): RecipeVersionAdmin {
    return {
        id: versionIdentifier(recipeOrdinal, versionNumber),
        recipeId: recipeIdentifier(recipeOrdinal),
        versionNumber,
        status: 'draft',
        yieldQuantity: 4,
        yieldUnit: 'portion',
        yieldPieces: null,
        wastePercent: 3,
        b2bPrice: null,
        b2cPrice: null,
        packaging: [],
        lines: [line(MAPPED_INGREDIENT), line(UNMAPPED_INGREDIENT, { quantity: 30 })],
        outputs: [],
        steps: [],
        allergens: [GLUTEN_DECLARATION],
        estimatedCost: { amount: 12, currency: 'AED' },
        derivationStale: false,
        publishedAt: null,
        ...overrides,
    };
}

function versionSummary(
    version: RecipeVersionAdmin,
    overrides: Partial<RecipeVersionSummary> = {},
): RecipeVersionSummary {
    return {
        id: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        publishedAt: version.publishedAt,
        updatedAt: '2026-08-01T09:00:00.000Z',
        isCurrent: true,
        ...overrides,
    };
}

interface RecipeSeed {
    readonly ordinal: number;
    readonly name?: string;
    readonly currentVersion?: RecipeVersionAdmin;
    readonly overrides?: Partial<RecipeAdmin>;
}

function recipe({ ordinal, name, currentVersion, overrides = {} }: RecipeSeed): RecipeAdmin {
    const version = currentVersion ?? recipeVersion({ recipeOrdinal: ordinal });
    const label = name ?? `Recipe ${String(ordinal)}`;
    return {
        id: recipeIdentifier(ordinal),
        meta: meta(),
        name: { en: label, ar: `${label} بالعربية` },
        slug: label.toLocaleLowerCase().replace(/\s+/g, '-'),
        reference: null,
        kitchenId: TEST_KITCHEN_ID,
        sourceKind: null,
        recipeCategory: null,
        currentVersionNumber: version.versionNumber,
        versionCount: version.versionNumber,
        description: { en: 'A dish.', ar: 'طبق.' },
        currentVersion: version,
        versions: [versionSummary(version)],
        ...overrides,
    };
}

function summaryOf(record: RecipeAdmin): RecipeAdminSummary {
    return {
        id: record.id,
        meta: record.meta,
        name: record.name,
        slug: record.slug,
        reference: record.reference,
        kitchenId: record.kitchenId,
        sourceKind: record.sourceKind,
        recipeCategory: record.recipeCategory,
        currentVersionNumber: record.currentVersionNumber,
        versionCount: record.versionCount,
    };
}

/**
 * The recipe listing, answering the filters the screens actually send.
 *
 * `query` and `statuses` are real server parameters (`RecipeAdminFilter`), and two call sites depend
 * on them behaving: the list screen's search box narrows by name, and the kitchen picker derives its
 * vocabulary from one unfiltered page. Reading a getter rather than a captured array is what lets a
 * test move the world on mid-flight and assert the refetch.
 */
/**
 * The listing, narrowed the way the server narrows it.
 *
 * `allergenCodes` is applied here against the record's current version rather than left to the
 * screen, because that is where it happens in production: `RecipeIndexController` matches
 * `recipe_version_allergens` and returns a page that is already filtered. A stub that ignored the
 * parameter would let a page-local implementation pass the suite, which is the one outcome these
 * tests exist to prevent.
 */
function recipeListing(
    read: () => readonly RecipeAdmin[],
): (filter?: RecipeAdminFilter) => Promise<CursorPage<RecipeAdminSummary>> {
    return async (filter) => {
        const statuses = filter?.statuses;
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';
        const codes = filter?.allergenCodes;

        return page(
            read()
                .filter(
                    (row) =>
                        (statuses === undefined || statuses.includes(row.meta.status)) &&
                        (codes === undefined ||
                            codes.length === 0 ||
                            row.currentVersion.allergens.some((declaration) =>
                                codes.includes(declaration.allergenCode),
                            )) &&
                        (needle === '' ||
                            row.name.en.toLocaleLowerCase().includes(needle) ||
                            row.name.ar.includes(needle) ||
                            row.slug.includes(needle)),
                )
                .map(summaryOf),
        );
    };
}

/** Two of the fourteen regulatory classes — enough to pick one and leave another unpicked. */
const RECIPE_ALLERGEN_CLASSES: readonly AllergenClass[] = [
    {
        code: AllergenCode.unsafe('sesame'),
        name: { en: 'Sesame', ar: 'سمسم' },
        description: { en: 'The sesame class.', ar: 'فئة السمسم.' },
        markets: ['EU', 'GCC'],
        declarationThreshold: null,
        regulatoryReference: 'EU 1169/2011 Annex II',
        severeByDefault: false,
        isActive: true,
    },
    {
        code: AllergenCode.unsafe('gluten'),
        name: { en: 'Gluten', ar: 'غلوتين' },
        description: { en: 'The gluten class.', ar: 'فئة الغلوتين.' },
        markets: ['EU', 'GCC'],
        declarationThreshold: null,
        regulatoryReference: 'EU 1169/2011 Annex II',
        severeByDefault: false,
        isActive: true,
    },
];

function ingredientListing(
    read: () => readonly IngredientAdmin[],
): (filter?: IngredientAdminFilter) => Promise<CursorPage<IngredientAdmin>> {
    return async () => page(read());
}

function facts(): NutritionFacts {
    return {
        basis: 'per_serving',
        kind: 'planned',
        serving: {
            label: '1 portion',
            quantity: 1,
            unit: 'portion',
            grams: 230,
            millilitres: null,
            householdMeasure: null,
        },
        totalGrams: 230,
        amounts: [
            { nutrientId: 'energy', unit: 'kcal', value: 410, kind: 'planned', tolerance: null },
            { nutrientId: 'protein', unit: 'g', value: 11, kind: 'planned', tolerance: null },
        ],
        source: {
            kind: 'synthetic_prototype',
            label: 'Authored by this test',
            version: '1',
            calculatedAt: '2026-08-01T09:00:00.000Z',
        },
        calculation: {
            method: 'test.authored',
            basis: 'per_serving',
            calculatedAt: '2026-08-01T09:00:00.000Z',
            prototype: true,
            rounding: 'none',
            notes: ['Every figure in this panel was authored by the test that renders it.'],
        },
    };
}

/** What the roll-up would declare for the authored lines: gluten, from the mapped ingredient. */
function rollupPreview(overrides: Partial<RecipeRollupPreview> = {}): RecipeRollupPreview {
    return {
        perRecipe: facts(),
        perServing: facts(),
        per100g: null,
        allergenSources: [
            {
                allergenCode: AllergenCode.parse('gluten'),
                containment: 'contains',
                ingredientIds: [MAPPED_INGREDIENT.id],
            },
        ],
        estimatedCost: { amount: 12, currency: 'AED' },
        warnings: [],
        ...overrides,
    };
}

/** The two reads every recipe editor render needs beyond the record itself. */
function editorReads(record: () => RecipeAdmin) {
    return {
        getRecipe: async () => record(),
        listIngredients: ingredientListing(() => LIBRARY),
        previewRecipeRollup: async () => rollupPreview(),
    };
}

/** An organisation owner: an organisation, a branch, and no catalogue permission at all. */
function organisationOwnerSession() {
    return testMeResponse({
        memberships: [
            testMembership({
                organisation: testOrganisation({
                    name: 'Cedar Clinic',
                    slug: 'cedar-clinic',
                    type: 'clinic',
                }),
                roles: [
                    {
                        id: RoleId.unsafe('test-0000-role-0002'),
                        key: 'organisation_owner',
                        name: 'Owner',
                    },
                ],
            }),
        ],
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    });
}

/* ------------------------------------------------------------------------------------------------
 * Pure helpers
 * ---------------------------------------------------------------------------------------------- */

describe('recipe display helpers', () => {
    it('moves a row without losing one, and refuses an impossible move', () => {
        const rows = ['a', 'b', 'c'];
        expect(moveInList(rows, 2, 0)).toEqual(['c', 'a', 'b']);
        expect(moveInList(rows, 0, 2)).toEqual(['b', 'c', 'a']);
        // Out of range and no-ops return the same array, so a caller can compare by identity.
        expect(moveInList(rows, 0, 0)).toBe(rows);
        expect(moveInList(rows, -1, 1)).toBe(rows);
        expect(moveInList(rows, 0, 9)).toBe(rows);
    });

    it('reads a quantity in Latin digits and refuses anything that is not one yet', () => {
        expect(parseQuantity('250')).toBe(250);
        expect(parseQuantity(' 1.5 ')).toBe(1.5);
        expect(parseQuantity('')).toBeNull();
        expect(parseQuantity('-3')).toBeNull();
        expect(parseQuantity('12a')).toBeNull();
        expect(parseQuantity('١٢')).toBeNull();
    });

    it('offers only units in the ingredient’s own dimension', () => {
        expect(unitsInDimension('kg')).toEqual(['g', 'kg']);
        expect(unitsInDimension('ml')).toContain('l');
        expect(unitsInDimension('ml')).not.toContain('g');
    });

    it('never divides a cost by a yield of nothing', () => {
        expect(costPerServing({ amount: 12, currency: 'USD' }, 4)).toEqual({
            amount: 3,
            currency: 'USD',
        });
        expect(costPerServing({ amount: 12, currency: 'USD' }, 0)).toBeNull();
        expect(costPerServing(null, 4)).toBeNull();
    });

    it('fingerprints a draft by its line order, so a reorder is acknowledged', () => {
        const lines = [
            { ingredientId: MAPPED_INGREDIENT.id, quantity: 100, unit: 'g' as const },
            { ingredientId: UNMAPPED_INGREDIENT.id, quantity: 50, unit: 'g' as const },
        ];
        const draft: RecipeRollupDraft = { recipeId: null, servings: 2, lines };
        const reordered: RecipeRollupDraft = { ...draft, lines: [...lines].reverse() };

        expect(recipeRollupHash(draft)).toBe(recipeRollupHash({ ...draft, lines: [...lines] }));
        expect(recipeRollupHash(draft)).not.toBe(recipeRollupHash(reordered));
        expect(recipeRollupHash(draft)).not.toBe(recipeRollupHash({ ...draft, servings: 3 }));
    });
});

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

describe('the recipe list', () => {
    it('renders skeletons, then the authored rows with their version and derived label', async () => {
        const published = recipe({
            ordinal: 1,
            name: 'Tabbouleh',
            currentVersion: recipeVersion({
                recipeOrdinal: 1,
                versionNumber: 2,
                overrides: { status: 'published', publishedAt: '2026-08-02T09:00:00.000Z' },
            }),
            overrides: { meta: meta({ status: 'published', lockVersion: 3 }) },
        });

        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a stub that resolves on a microtask.
        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            latencyMs: 40,
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => [published]),
                    getRecipe: async () => published,
                },
            },
        });

        await untilVisible('kitchen-recipes-loading');
        await untilVisible('kitchen-recipes-table');

        const row = `kitchen-recipes-table-row-${String(published.id)}`;
        const base = `kitchen-recipe-${String(published.id)}`;

        // Below `md` the Catalogue draws a record two-line rather than as tracks (§4.1), and this
        // renderer's window is 750px — so what is asserted here is the narrow shape: the title and
        // the meta run.
        expect(screen.getByTestId(`${row}-title`)).toHaveTextContent('Tabbouleh');
        // `-reference`, not `-slug`: the identifier cell carries the record's `RC-` handle now.
        expect(screen.getByTestId(`${base}-reference`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-kitchen`)).toBeTruthy();
        // The version pair used to be the row's headline metric — which version is current, out of
        // how many. Both tracks were dropped by request; the version panel and the editor answer it
        // now, and the list has no metric column at all.
        expect(screen.queryByTestId(`${base}-version`)).toBeNull();

        // The derived label is *not* on the summary: it is read per row and rendered when it
        // arrives rather than guessed. While it is in flight the cell holds a skeleton, never the
        // dash — the dash is what "this version declares none" looks like, which is a different
        // answer. That frame is not asserted here because it is a race: `untilVisible` above
        // already flushes the row's own detail read on its way to finding the table.
        await untilVisible(`${base}-allergens`);
        expect(screen.queryByTestId(`${base}-allergens-none`)).toBeNull();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => [
                        recipe({ ordinal: 1, name: 'Tabbouleh' }),
                        recipe({ ordinal: 2, name: 'Fattoush' }),
                    ]),
                    getRecipe: async () => recipe({ ordinal: 1, name: 'Tabbouleh' }),
                },
            },
        });
        await untilVisible('kitchen-recipes-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-recipes-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-recipes-empty');
        expect(screen.getByTestId('kitchen-recipes-clear')).toBeTruthy();
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: async () =>
                        throwFailure(apiFailure('server', { message: 'Boom.' })),
                },
            },
        });

        await untilVisible('kitchen-recipes-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        // No repository overrides at all: the gate refuses before the table can ask for anything, so
        // a screen that fetched here would fail loudly with StubNotConfiguredError.
        await renderStubScreen(<RecipesScreen />, { session: organisationOwnerSession() });

        await untilVisible('kitchen-recipes-forbidden');
        expect(screen.queryByTestId('kitchen-recipes-table')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The list at desk width
 * ---------------------------------------------------------------------------------------------- */

/**
 * `/kitchen/recipes` is a desk surface, and above `md` the Catalogue draws a record as tracks
 * rather than as the two-line row the rest of this file renders (§4.1). The two are different
 * trees with different element counts — the branch is JavaScript, not a class variant — so the wide
 * shape has to actually be rendered to be asserted, and this is the one block that widens the
 * window to do it.
 *
 * `Dimensions.set` rather than a mocked `useBreakpoint`: the branch reads the real window, and a
 * test that stubbed the hook would prove the stub. The narrow default is captured up front and put
 * back afterwards, so every other block keeps the phone shape it was written against.
 */
describe('the recipe list at desk width', () => {
    const NARROW_WINDOW = Dimensions.get('window');
    const NARROW_SCREEN = Dimensions.get('screen');

    beforeAll(() => {
        Dimensions.set({
            window: { ...NARROW_WINDOW, width: 1440, height: 900 },
            screen: { ...NARROW_SCREEN, width: 1440, height: 900 },
        });
    });

    afterAll(() => {
        Dimensions.set({ window: NARROW_WINDOW, screen: NARROW_SCREEN });
    });

    it('draws the two tracks the narrow row has no room for', async () => {
        const published = recipe({
            ordinal: 1,
            name: 'Tabbouleh',
            currentVersion: recipeVersion({
                recipeOrdinal: 1,
                versionNumber: 2,
                overrides: { status: 'published', publishedAt: '2026-08-02T09:00:00.000Z' },
            }),
            overrides: { meta: meta({ status: 'published', lockVersion: 3 }) },
        });

        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => [published]),
                    getRecipe: async () => published,
                    listAllergenClasses: async () => RECIPE_ALLERGEN_CLASSES,
                },
            },
        });

        await untilVisible('kitchen-recipes-table');
        const base = `kitchen-recipe-${String(published.id)}`;

        // The record's own status. The *version's* was a second track beside it, on the argument
        // that the two answer different questions — whether the recipe is on the menu, and whether
        // the thing a kitchen would cook from it is frozen. Both version tracks were dropped by
        // request; the version panel and the editor still answer the second question.
        expect(screen.getByTestId(`${base}-status`)).toHaveTextContent(/Published/);

        // The identifier column carries the record's `RC-` handle, not its slug: a slug follows the
        // name, so it moves when the name is edited and sorts alphabetically rather than by age.
        expect(screen.getByTestId(`${base}-reference`)).toBeTruthy();

        // Sorting and filtering live on the column headers (§4.3), so every track that can do
        // either draws a trigger rather than a plain label.
        expect(screen.getByTestId('kitchen-recipes-column-name-trigger')).toBeTruthy();
        expect(screen.getByTestId('kitchen-recipes-column-kitchen-trigger')).toBeTruthy();
        // Allergens does not sort — the label is derived per row and out of order — but it does
        // filter, against the server. A column that filters is a trigger; see the tests below for
        // what the trigger does.
        expect(screen.getByTestId('kitchen-recipes-column-allergens-trigger')).toBeTruthy();
        // Gone from the row entirely, along with Updated.
        expect(screen.queryByTestId('kitchen-recipes-column-version-trigger')).toBeNull();
        expect(screen.queryByTestId(`${base}-version-status`)).toBeNull();
        expect(screen.queryByTestId(`${base}-updated`)).toBeNull();
    });

    it('narrows the whole book by an allergen class, through the request', async () => {
        /*
         * The point of the test is the *request*, not the rows.
         *
         * A page-local implementation would show the same two rows on screen and be wrong about
         * every page after this one, so what is asserted is that the screen asked the server to
         * narrow — `allergenCodes` on the filter — rather than that it managed to hide a row it
         * had already been given.
         */
        const sesame = recipe({
            ordinal: 1,
            name: 'Tahini dressing',
            currentVersion: recipeVersion({
                recipeOrdinal: 1,
                overrides: {
                    allergens: [
                        {
                            allergenCode: AllergenCode.parse('sesame'),
                            containment: 'contains',
                            origin: 'derived',
                            sourceIngredientIds: [MAPPED_INGREDIENT.id],
                        },
                    ],
                },
            }),
        });
        const gluten = recipe({ ordinal: 2, name: 'Tabbouleh' });
        const library = [sesame, gluten];

        const filters: RecipeAdminFilter[] = [];
        const listing = recipeListing(() => library);

        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: async (filter?: RecipeAdminFilter) => {
                        if (filter !== undefined) filters.push(filter);
                        return listing(filter);
                    },
                    getRecipe: async (recipeId) => {
                        const found = library.find((row) => row.id === recipeId);
                        if (found === undefined) throw new Error('No such recipe.');
                        return found;
                    },
                    listAllergenClasses: async () => RECIPE_ALLERGEN_CLASSES,
                },
            },
        });

        await untilVisible(`kitchen-recipe-${String(gluten.id)}-name`);

        await untilVisible('kitchen-recipes-column-allergens-trigger');
        fireEvent.press(screen.getByTestId('kitchen-recipes-column-allergens-trigger'));
        await untilVisible('kitchen-recipes-column-allergens-sesame');
        fireEvent.press(screen.getByTestId('kitchen-recipes-column-allergens-sesame'));

        await waitFor(() => {
            expect(screen.queryByTestId(`kitchen-recipe-${String(gluten.id)}-name`)).toBeNull();
        });
        await untilVisible(`kitchen-recipe-${String(sesame.id)}-name`);

        // The request carried it, which is what makes the count and the pager honest. `some`
        // rather than the last entry: the previous, unfiltered query key is still live and the
        // client is free to refetch it, so what matters is that a narrowed request was made at
        // all — not that it happened to be the most recent one.
        expect(
            filters.some((sent) =>
                (sent.allergenCodes ?? []).includes(AllergenCode.parse('sesame')),
            ),
        ).toBe(true);
    });

    it('turns the column\u2019s arrow over while a class is applied, and clears from the menu', async () => {
        const library = [recipe({ ordinal: 1, name: 'Tabbouleh' })];

        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => library),
                    getRecipe: async () => library[0] as RecipeAdmin,
                    listAllergenClasses: async () => RECIPE_ALLERGEN_CLASSES,
                },
            },
        });

        await untilVisible('kitchen-recipes-column-allergens-trigger');

        // The arrow is `aria-hidden` — the mark is for readers, and the menu's own tick is what a
        // screen reader is given instead — so it is reached with `includeHiddenElements`, the same
        // way the packaging suite reaches its own.
        const hidden = { includeHiddenElements: true } as const;
        const glyph = (testID: string) => screen.getByTestId(testID, hidden).props.children;

        // Allergens filters but does not sort, so its arrow is never the black one a sorted column
        // earns: `-affordance`, never `-sorted`, and pointing up until something is applied.
        expect(screen.queryByTestId('kitchen-recipes-column-allergens-sorted', hidden)).toBeNull();
        expect(glyph('kitchen-recipes-column-allergens-affordance')).toBe('\u2191');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipes-column-allergens-trigger'));
        });
        await untilVisible('kitchen-recipes-column-allergens-gluten');
        // A Clear on an unfiltered column is an item that does nothing, so it is not offered yet.
        expect(screen.queryByTestId('kitchen-recipes-column-allergens-clear')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipes-column-allergens-gluten'));
        });

        // The arrow turns over. A shape, not a shade — a filtered column a reader cannot see is a
        // filter they cannot clear.
        await waitFor(() => {
            expect(glyph('kitchen-recipes-column-allergens-affordance')).toBe('\u2193');
        });

        // And the way out is inside the menu the mark points at.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipes-column-allergens-trigger'));
        });
        await untilVisible('kitchen-recipes-column-allergens-clear');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipes-column-allergens-clear'));
        });

        await waitFor(() => {
            expect(glyph('kitchen-recipes-column-allergens-affordance')).toBe('\u2191');
        });
    });

    it('draws only the fragment of an imported row’s locator', async () => {
        // Rows that predate the `RC-` series carry their import locator instead — the file the
        // sheet arrived in, then the sheet within it. Every row from one run shares the file half,
        // so drawn whole the column is a stack of identical prefixes with the half that tells two
        // recipes apart pushed off the end of an 84px track.
        const imported = recipe({
            ordinal: 1,
            name: 'BBQ sauce dip',
            overrides: { reference: 'v6-recipes.json#bbq-sauce-dip' },
        });

        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => [imported]),
                    getRecipe: async () => imported,
                },
            },
        });

        await untilVisible('kitchen-recipes-table');
        const cell = screen.getByTestId(`kitchen-recipe-${String(imported.id)}-reference`);

        expect(cell).toHaveTextContent('bbq-sauce-dip');
        expect(cell).not.toHaveTextContent('v6-recipes.json');
    });

    it('leaves a handle with no fragment alone', async () => {
        const numbered = recipe({ ordinal: 2, overrides: { reference: 'RC-0007' } });

        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => [numbered]),
                    getRecipe: async () => numbered,
                },
            },
        });

        await untilVisible('kitchen-recipes-table');
        expect(
            screen.getByTestId(`kitchen-recipe-${String(numbered.id)}-reference`),
        ).toHaveTextContent('RC-0007');
    });

    it('offers New draft only against a version that cannot be edited in place', async () => {
        const frozen = recipe({
            ordinal: 1,
            name: 'Tabbouleh',
            currentVersion: recipeVersion({
                recipeOrdinal: 1,
                versionNumber: 2,
                overrides: { status: 'published', publishedAt: '2026-08-02T09:00:00.000Z' },
            }),
            overrides: { meta: meta({ status: 'published', lockVersion: 3 }) },
        });
        const open = recipe({ ordinal: 2, name: 'Fattoush' });
        const library = [frozen, open];

        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => library),
                    getRecipe: async (recipeId) => {
                        const found = library.find((row) => row.id === recipeId);
                        if (found === undefined) throw new Error('No such recipe.');
                        return found;
                    },
                },
            },
        });

        await untilVisible('kitchen-recipes-table');
        const frozenRow = `kitchen-recipe-${String(frozen.id)}`;
        const openRow = `kitchen-recipe-${String(open.id)}`;

        // Three actions on every row, and the fourth only where it would do something: a published
        // version is immutable, so the only way to change it is to open its successor; a draft that
        // is already open would take a version bump that changed nothing.
        await untilVisible(`${frozenRow}-new-draft`);
        expect(screen.getByTestId(`${frozenRow}-view`)).toBeTruthy();
        expect(screen.getByTestId(`${frozenRow}-open`)).toBeTruthy();
        expect(screen.getByTestId(`${frozenRow}-archive`)).toBeTruthy();

        expect(screen.getByTestId(`${openRow}-view`)).toBeTruthy();
        expect(screen.getByTestId(`${openRow}-open`)).toBeTruthy();
        expect(screen.getByTestId(`${openRow}-archive`)).toBeTruthy();
        expect(screen.queryByTestId(`${openRow}-new-draft`)).toBeNull();
    });

    it('opens the read-only View panel from the row, carrying the derived label', async () => {
        const published = recipe({
            ordinal: 1,
            name: 'Tabbouleh',
            currentVersion: recipeVersion({
                recipeOrdinal: 1,
                versionNumber: 2,
                overrides: { status: 'published', publishedAt: '2026-08-02T09:00:00.000Z' },
            }),
            overrides: { meta: meta({ status: 'published', lockVersion: 3 }) },
        });

        await renderStubScreen(<RecipesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listRecipes: recipeListing(() => [published]),
                    getRecipe: async () => published,
                },
            },
        });

        await untilVisible('kitchen-recipes-table');
        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-recipe-${String(published.id)}-view`));
        });

        await untilVisible('kitchen-recipes-view');
        // The slug is a recipe's reference, and the panel states the three facts no track holds:
        // the source sheet's Kind, the version count in words, and who last touched it.
        expect(screen.getByTestId('kitchen-recipes-view-reference')).toHaveTextContent(
            published.slug,
        );
        expect(screen.getByTestId('kitchen-recipes-view-field-versionCount')).toBeTruthy();
        expect(screen.getByTestId('kitchen-recipes-view-field-updatedBy')).toHaveTextContent(
            /Rana Haddad/,
        );
    });
});

/* ------------------------------------------------------------------------------------------------
 * Creating
 * ---------------------------------------------------------------------------------------------- */

describe('creating a recipe', () => {
    it('creates it as a draft at version one, and lands on its own address', async () => {
        const created = recipe({
            ordinal: 9,
            name: 'Smoked labneh with zaatar',
            currentVersion: recipeVersion({
                recipeOrdinal: 9,
                overrides: { lines: [], allergens: [] },
            }),
        });

        const { repositories } = await renderStubScreen(<RecipeEditScreen recipe="new" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: ingredientListing(() => LIBRARY),
                    // The create form draws the handle the record is about to take. Stubbed
                    // because it is a real read the screen makes; unstubbed it would reject and
                    // the box would simply stay empty, which is the behaviour on a failed read.
                    nextReference: async () => 'RC-0010',
                    createRecipe: async () => created,
                },
            },
        });

        await untilVisible('kitchen-recipe-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-recipe-name-en-input'),
                'Smoked labneh with zaatar',
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/recipes/${String(created.id)}`,
            );
        });

        // Exactly this request and nothing else. `CreateRecipeRequest` carries no status and no
        // version field at all, and the equality is what proves the screen invents neither: a
        // catalogue that published a row the moment it was typed would be the opposite of the
        // publication safety this phase exists to build. The version-one claim is the contract's —
        // there is nothing for a caller to ask for.
        expect(repositories.kitchenAdmin.createRecipe).toHaveBeenCalledWith({
            name: { en: 'Smoked labneh with zaatar', ar: '' },
            description: { en: '', ar: '' },
            yieldQuantity: 1,
            // Kilograms, not portions. The Yield section fixes the unit — there is no control that
            // changes it — so a draft that started in `portion` would open in a unit the form has
            // no way to correct. `EMPTY_DETAILS` records the decision.
            yieldUnit: 'kg',
            wastePercent: 0,
        });
        expect(created.currentVersion.versionNumber).toBe(1);
        expect(created.meta.status).toBe('draft');
    });
});

/* ------------------------------------------------------------------------------------------------
 * Versions
 * ---------------------------------------------------------------------------------------------- */

describe('versions', () => {
    it('renders a published version read-only and opens a draft that copies its lines', async () => {
        const publishedVersion = recipeVersion({
            recipeOrdinal: 3,
            overrides: { status: 'published', publishedAt: '2026-08-02T09:00:00.000Z' },
        });
        let stored = recipe({
            ordinal: 3,
            name: 'Freekeh bowl',
            currentVersion: publishedVersion,
            overrides: { meta: meta({ status: 'published', lockVersion: 4 }) },
        });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        // The server's rule: the first write against a published version opens the
                        // successor draft, carrying a *copy* of the published version's lines.
                        updateRecipe: async (_id, request) => {
                            const successor = recipeVersion({
                                recipeOrdinal: 3,
                                versionNumber: publishedVersion.versionNumber + 1,
                                overrides: { lines: publishedVersion.lines },
                            });
                            stored = {
                                ...stored,
                                meta: meta({
                                    status: 'published',
                                    lockVersion: request.lockVersion + 1,
                                }),
                                currentVersionNumber: successor.versionNumber,
                                versionCount: successor.versionNumber,
                                currentVersion: successor,
                                versions: [
                                    versionSummary(successor),
                                    versionSummary(publishedVersion, { isCurrent: false }),
                                ],
                            };
                            return stored;
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-versions');
        // Immutable, and the one control offered is the successor draft.
        expect(screen.getByTestId('kitchen-recipe-immutable')).toBeTruthy();

        /*
         * "No way to add a line" is now the *absence of the picker*, not a missing Add button. The
         * table itself still draws — a published version is read, constantly — and what it withholds
         * is the field that would append to it. `RecipeLineTable` renders the picker only when it
         * may write, so this is the same claim against the control that replaced the button.
         */
        await openTab('production');
        await untilVisible('kitchen-recipe-lines-table');
        expect(screen.queryByTestId(LINE_PICKER_INPUT)).toBeNull();

        await openTab('description');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-new-draft'));
        });

        // The contract's smallest legal write: the version it was based on, and no fields. Anything
        // more would be an edit nobody asked for, audited server-side as one.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateRecipe).toHaveBeenCalledWith(stored.id, {
                lockVersion: 4,
            });
        });

        // The editor rebases onto the new version and becomes editable — the picker is back.
        await openTab('production');
        await untilVisible(LINE_PICKER_INPUT);

        // A copy, not a blank: the whole point of opening a draft *from* a version. The rows the
        // table draws are the copied line set, not a fresh one.
        expect(stored.currentVersion.versionNumber).toBe(publishedVersion.versionNumber + 1);
        expect(stored.currentVersion.lines).toHaveLength(publishedVersion.lines.length);
        await waitFor(() => {
            expect(screen.getAllByTestId(LINE_ROWS)).toHaveLength(publishedVersion.lines.length);
        });
    });

    it('says plainly that an older version’s contents cannot be read', async () => {
        const older = recipeVersion({
            recipeOrdinal: 4,
            overrides: { status: 'published', publishedAt: '2026-08-02T09:00:00.000Z' },
        });
        const current = recipeVersion({ recipeOrdinal: 4, versionNumber: 2 });
        const stored = recipe({
            ordinal: 4,
            name: 'Muhammara',
            currentVersion: current,
            overrides: {
                versions: [versionSummary(current), versionSummary(older, { isCurrent: false })],
            },
        });

        await renderStubScreen(<RecipeEditScreen recipe={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: editorReads(() => stored) },
        });

        await untilVisible('kitchen-recipe-version-list');

        await act(async () => {
            fireEvent.press(
                screen.getByTestId(`kitchen-recipe-version-${String(older.id)}-select`),
            );
        });

        // `RecipeAdmin` carries only the *current* version in full, so there is nothing honest to
        // render for an older one. Saying so beats an empty ingredient list with a heading on it.
        await untilVisible('kitchen-recipe-version-unavailable');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-version-back-to-current'));
        });
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-recipe-version-unavailable')).toBeNull();
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The line editor
 * ---------------------------------------------------------------------------------------------- */

/**
 * The line editor.
 *
 * Rewritten against `RecipeLineTable`, which replaced the row-editor list. Three of the controls
 * these tests used to drive are gone by design and their coverage goes with them: **move up/down**,
 * **undo a removal** and the **position announcer**. The design draws the table as a sheet — a
 * picker, rows, a totals line — and the kitchen's own sheets carry no line order that means
 * anything, so a reorder was a control protecting an order nobody reads. What is left is what the
 * table can actually do, and it is all still asserted: add, remove, edit a quantity, and save the
 * set wholesale in the order the table is showing.
 *
 * The **per-row unit control** went the same way. A line has to be convertible to the ingredient's
 * own dimension or the roll-up cannot resolve it, so the unit follows the ingredient rather than
 * being chosen; `RecipeLineTable`'s docblock is where that is argued.
 */
describe('the line editor', () => {
    it('adds a line from the picker, removes one, and saves the set the table is showing', async () => {
        const stored = recipe({ ordinal: 5, name: 'Mujaddara' });
        const seededCount = stored.currentVersion.lines.length;

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        setRecipeLines: async () => stored,
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-editor-screen-header');
        await openTab('production');
        await untilVisible(LINE_PICKER_INPUT);

        // Two lines, because this test authored two.
        expect(seededCount).toBe(2);
        expect(screen.getAllByTestId(LINE_ROWS)).toHaveLength(seededCount);

        // ── add ──────────────────────────────────────────────────────────────────────────────
        await addLine(String(UNMAPPED_INGREDIENT.id));

        const added = 'kitchen-recipe-lines-table-row-row-1';
        await untilVisible(added);
        expect(screen.getAllByTestId(LINE_ROWS)).toHaveLength(seededCount + 1);

        // A picked line starts at quantity 1 in the ingredient's own unit; this one is corrected.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-qty`), '120');
        });

        // ── remove ───────────────────────────────────────────────────────────────────────────
        // The first seeded row goes, so the saved set proves the table sends what it draws rather
        // than what it was loaded with.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-table-row-line-0-remove'));
        });
        expect(screen.queryByTestId('kitchen-recipe-lines-table-row-line-0')).toBeNull();
        expect(screen.getAllByTestId(LINE_ROWS)).toHaveLength(seededCount);

        // ── save ─────────────────────────────────────────────────────────────────────────────
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        // Wholesale, in the order the table is showing, at the version the editor opened with: the
        // surviving seeded line first, then the one that was added.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setRecipeLines).toHaveBeenCalledWith(stored.id, {
                lockVersion: stored.meta.lockVersion,
                lines: [
                    {
                        ingredientId: UNMAPPED_INGREDIENT.id,
                        quantity: 30,
                        unit: 'g',
                        isOptional: false,
                    },
                    {
                        ingredientId: UNMAPPED_INGREDIENT.id,
                        quantity: 120,
                        unit: 'g',
                        isOptional: false,
                    },
                ],
            });
        });
    });

    it('keeps two lines that name the same ingredient', async () => {
        const stored = recipe({
            ordinal: 6,
            name: 'Zaatar oil',
            currentVersion: recipeVersion({
                recipeOrdinal: 6,
                overrides: { lines: [line(MAPPED_INGREDIENT)] },
            }),
        });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        setRecipeLines: async () => stored,
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-editor-screen-header');
        await openTab('production');
        await untilVisible(LINE_PICKER_INPUT);

        for (const key of ['row-1', 'row-2']) {
            await addLine(String(MAPPED_INGREDIENT.id));
            const row = `kitchen-recipe-lines-table-row-${key}`;
            await untilVisible(row);
            await act(async () => {
                fireEvent.changeText(screen.getByTestId(`${row}-qty`), '10');
            });
        }

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        // The original plus the two just added: nothing was merged, and picking the same row twice
        // is not treated as a mistake. A sheet that lists olive oil twice — once for the pan and
        // once to finish — is describing two things.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setRecipeLines).toHaveBeenCalled();
        });
        const [, request] = (repositories.kitchenAdmin.setRecipeLines as jest.Mock).mock
            .calls[0] as [RecipeId, { lines: readonly { ingredientId: IngredientId }[] }];
        expect(
            request.lines.filter((entry) => entry.ingredientId === MAPPED_INGREDIENT.id),
        ).toHaveLength(3);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Outputs and steps
 * ---------------------------------------------------------------------------------------------- */

/**
 * What used to be the outputs editor and the method editor.
 *
 * Both are gone from the screen, at the kitchen's request, and the editor's module note argues each:
 * a formulation is its lines, and the ordered step list was a second place to say what the lines
 * already say; outputs make a version's product stockable as an ingredient, which is a real and
 * rare capability the design draws no editor for.
 *
 * The two tests that stood here drove controls that no longer exist. What replaces them is the
 * claim their removal actually rests on, and the one that would be expensive to get wrong: a save
 * writes **only the sections this screen edits**. `setRecipeSteps` and `setRecipeOutputs` are still
 * on the contract and still wholesale, so a save that called either with what this form happens to
 * hold would clear a version's method and its outputs — silently, on the first save of any recipe
 * that had them.
 */
describe('the sections this screen no longer edits', () => {
    it('never writes steps or outputs, so a save cannot clear them', async () => {
        const stored = recipe({ ordinal: 7, name: 'Pesto base' });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        setRecipeLines: async () => stored,
                        updateRecipe: async () => stored,
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-editor-screen-header');
        await openTab('production');
        await untilVisible(LINE_PICKER_INPUT);

        // Edit both sections the screen *does* own, so the save has real work to do and the
        // absence below is a decision rather than a no-op.
        await addLine(String(UNMAPPED_INGREDIENT.id));
        await openTab('description');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-recipe-name-en-input'), 'Pesto');
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.setRecipeLines).toHaveBeenCalled();
        });
        expect(repositories.kitchenAdmin.updateRecipe).toHaveBeenCalled();

        // Not called at all — not called with the existing set, not called with an empty one. A
        // section this screen does not edit is never in the set a save writes.
        expect(repositories.kitchenAdmin.setRecipeSteps).not.toHaveBeenCalled();
        expect(repositories.kitchenAdmin.setRecipeOutputs).not.toHaveBeenCalled();
    });

    it('draws no method section and no outputs section', async () => {
        const stored = recipe({ ordinal: 8, name: 'Baba ghanoush' });

        await renderStubScreen(<RecipeEditScreen recipe={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: editorReads(() => stored) },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');

        // Every tab, because "it is on another tab" is the one way this assertion could be wrong.
        for (const tab of ['description', 'production', 'packaging', 'costing', 'sheet'] as const) {
            await openTab(tab);
            expect(screen.queryByTestId('kitchen-recipe-steps')).toBeNull();
            expect(screen.queryByTestId('kitchen-recipe-outputs')).toBeNull();
        }
    });
});

/* ------------------------------------------------------------------------------------------------
 * The roll-up preview
 * ---------------------------------------------------------------------------------------------- */

/**
 * The roll-up preview, which now surfaces on the Technical sheet tab.
 *
 * The dedicated panel these tests drove is gone: Composition renders through the shared
 * `DerivedPanel` and the allergen classes render as `Tag`s beside it. The debounce policy did not
 * change and is still the thing worth pinning — a quantity is a stream of intermediate values and
 * waits; a structural change is a completed decision and does not.
 *
 * Two assertions did not survive, and neither was about the policy. The panel no longer *dims*
 * while a request is in flight and no longer sets `aria-busy` — `DerivedPanel` takes figures and
 * nothing else — and an allergen chip no longer expands to a source list, because the chip's own
 * label names the line that put it there. `useRecipeRollupQuery`'s docblock still describes the
 * dimming, which is now a promise about a panel that does not exist; the half that matters is kept
 * below, and it is the half a kitchen would notice: the allergen list never flickers to empty.
 */
describe('the roll-up preview', () => {
    it('waits out a quantity being typed and refreshes at once when the structure changes', async () => {
        const stored = recipe({ ordinal: 5, name: 'Mujaddara' });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                latencyMs: 1,
                repositories: { kitchenAdmin: editorReads(() => stored) },
            },
        );

        await untilVisible('kitchen-recipe-editor-screen-header');
        await openTab('production');
        await untilVisible(LINE_PICKER_INPUT);

        const preview = repositories.kitchenAdmin.previewRecipeRollup as jest.Mock;
        await waitFor(() => {
            expect(preview.mock.calls.length).toBeGreaterThan(0);
        });
        const before = preview.mock.calls.length;

        jest.useFakeTimers();

        // A quantity is a stream of intermediate values; nothing is requested for any of them.
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-recipe-lines-table-row-line-1-qty'),
                '333',
            );
        });
        expect(preview.mock.calls.length).toBe(before);

        await act(async () => {
            jest.advanceTimersByTime(500);
        });
        expect(preview.mock.calls.length).toBe(before + 1);

        /*
         * Removing a line is a completed decision and is not made to wait.
         *
         * The structural half used to be a per-row unit change, which the table no longer offers —
         * the unit follows the ingredient. A removal exercises the same branch for the same reason:
         * `useDebouncedRollupDraft` keys its structure on the ingredient ids and their units, so a
         * set that loses a member is a new structure and is applied during render rather than on a
         * timer. Two seeded lines, so one survives and the draft stays runnable.
         */
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-table-row-line-0-remove'));
        });
        expect(preview.mock.calls.length).toBe(before + 2);

        jest.useRealTimers();
    });

    it('keeps the previous allergen list on screen while the next one is fetched', async () => {
        const stored = recipe({ ordinal: 5, name: 'Mujaddara' });
        // A closure the override reads, so the *next* answer can be held open mid-test — the
        // replacement for wrapping the fixture repository's method.
        let hold = false;

        await renderStubScreen(<RecipeEditScreen recipe={String(stored.id)} />, {
            session: kitchenManagerSession(),
            latencyMs: 1,
            repositories: {
                kitchenAdmin: {
                    ...editorReads(() => stored),
                    previewRecipeRollup: async () =>
                        hold
                            ? new Promise<RecipeRollupPreview>(() => {
                                  /* never settles: the panel has to cope */
                              })
                            : rollupPreview(),
                },
            },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await openTab('sheet');
        await untilVisible('kitchen-recipe-allergen-chips');
        expect(screen.getByTestId('kitchen-recipe-allergen-gluten')).toBeTruthy();

        // Hold the *next* answer open, then make a structural edit so one is requested at once.
        hold = true;
        await openTab('production');
        await untilVisible(LINE_PICKER_INPUT);
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-table-row-line-0-remove'));
        });

        await openTab('sheet');

        /*
         * Still there, and still the previous answer.
         *
         * `keepPreviousData` is what does it, and this is the one thing on the screen that must
         * never flicker to empty: "no allergens" and "not known yet" are the two states a kitchen
         * most needs told apart, and a panel that blanked between requests would show the first
         * while meaning the second.
         */
        expect(screen.getByTestId('kitchen-recipe-allergen-gluten')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-allergens-none')).toBeNull();
    });

    it('names the line that put an allergen on the sheet, on the chip itself', async () => {
        const stored = recipe({ ordinal: 5, name: 'Mujaddara' });

        await renderStubScreen(<RecipeEditScreen recipe={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: editorReads(() => stored) },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await openTab('sheet');
        await untilVisible('kitchen-recipe-allergen-chips');

        /*
         * Named on the chip, not behind a press.
         *
         * The old panel hid the sources under an expander. A derived label is only trustworthy if a
         * reader can see what derived it, and one press away is far enough that most never look —
         * so the ingredient's name is in the label and the expander is gone.
         */
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-recipe-allergen-gluten')).toHaveTextContent(
                new RegExp(MAPPED_INGREDIENT.name.en),
            );
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Publication
 * ---------------------------------------------------------------------------------------------- */

describe('publishing', () => {
    it('publishes the version it was looking at, and offers nothing to publish before that', async () => {
        const draftVersion = recipeVersion({
            recipeOrdinal: 3,
            overrides: { lines: [line(MAPPED_INGREDIENT)] },
        });
        let stored = recipe({
            ordinal: 3,
            name: 'Smoked labneh',
            currentVersion: draftVersion,
            overrides: { meta: meta({ lockVersion: 2 }) },
        });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        publishRecipe: async (_id, request) => {
                            const publishedVersion: RecipeVersionAdmin = {
                                ...draftVersion,
                                status: 'published',
                                publishedAt: '2026-08-03T09:00:00.000Z',
                            };
                            stored = {
                                ...stored,
                                meta: meta({
                                    status: 'published',
                                    lockVersion: request.lockVersion + 1,
                                }),
                                currentVersion: publishedVersion,
                                versions: [versionSummary(publishedVersion)],
                            };
                            return stored;
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-publish');
        // Not published yet, and the editor says so rather than implying it.
        expect(screen.getByTestId('kitchen-recipe-editor-screen-status')).toHaveTextContent(
            /Draft/,
        );
        expect(screen.queryByTestId('kitchen-recipe-immutable')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish'));
        });

        await untilVisible('kitchen-recipe-publish-dialog');
        // The dialog states the consequence and the label that is about to become public.
        expect(screen.getByTestId('kitchen-recipe-publish-consequence')).toBeTruthy();
        expect(screen.getByTestId('kitchen-recipe-publish-allergens')).toBeTruthy();
        expect(screen.getByTestId('kitchen-recipe-publish-allergen-gluten')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish-confirm'));
        });

        // Published at the version the editor was holding — not at whatever the cache last saw.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.publishRecipe).toHaveBeenCalledWith(stored.id, {
                lockVersion: 2,
            });
        });

        // …and the editor rebases onto the answer: a published version is immutable, so the only
        // control left is the successor draft.
        await untilVisible('kitchen-recipe-immutable');
        await waitFor(() => {
            // The editor's header badge takes the Catalogue's short status vocabulary, the same
            // one its lists use — which now reads "Published" on both.
            expect(screen.getByTestId('kitchen-recipe-editor-screen-status')).toHaveTextContent(
                /Published/,
            );
        });
    });

    it('names the ingredients that carry no allergen determination', async () => {
        const stored = recipe({
            ordinal: 4,
            name: 'Dressed leaves',
            currentVersion: recipeVersion({
                recipeOrdinal: 4,
                overrides: { lines: [line(UNMAPPED_INGREDIENT)], allergens: [] },
            }),
        });

        await renderStubScreen(<RecipeEditScreen recipe={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...editorReads(() => stored),
                    previewRecipeRollup: async () => rollupPreview({ allergenSources: [] }),
                },
            },
        });

        await untilVisible('kitchen-recipe-publish');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish'));
        });

        await untilVisible('kitchen-recipe-publish-allergen-unmapped');
        // Each offending ingredient is named and is a route to the record that fixes it.
        const link = screen.getByTestId(
            `kitchen-recipe-publish-unmapped-${String(UNMAPPED_INGREDIENT.id)}`,
        );
        await act(async () => {
            fireEvent.press(link);
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith(
                `/kitchen/ingredients/${String(UNMAPPED_INGREDIENT.id)}`,
            );
        });
    });

    it('refuses a quarantined recipe, however hard the button is pressed', async () => {
        // The burghul/pita contradiction, as the server hands it over: dropping a determination a
        // published version derived from an ingredient quarantines the recipe. Reaching that state
        // is a server decision, so the honest thing to declare is the state itself.
        const stored = recipe({
            ordinal: 5,
            name: 'Contested tabbouleh',
            currentVersion: recipeVersion({
                recipeOrdinal: 5,
                overrides: { status: 'review_required' },
            }),
            overrides: { meta: meta({ status: 'review_required', lockVersion: 6 }) },
        });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenAdmin: editorReads(() => stored) },
            },
        );

        await untilVisible('kitchen-recipe-quarantine');
        // "Review" on the short vocabulary; the Callout beside it is what says the rest.
        expect(screen.getByTestId('kitchen-recipe-editor-screen-status')).toHaveTextContent(
            /Review/,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish'));
        });
        await untilVisible('kitchen-recipe-publish-quarantine');
        expect(
            screen.getByTestId('kitchen-recipe-publish-confirm').props.accessibilityState.disabled,
        ).toBe(true);

        // Pressing it anyway sends nothing: the refusal is in front of the request, not behind it.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish-confirm'));
        });
        expect(repositories.kitchenAdmin.publishRecipe).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Concurrency and the unsaved guard
 * ---------------------------------------------------------------------------------------------- */

describe('safety', () => {
    it('offers reload-or-keep when somebody else has moved the recipe on', async () => {
        let stored = recipe({ ordinal: 6, name: 'Conflict me' });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        // The server's rule: a stale `lockVersion` is refused, and the refusal says
                        // which version it actually holds.
                        updateRecipe: async (_id, request) => {
                            if (request.lockVersion !== stored.meta.lockVersion) {
                                throwFailure(
                                    conflictFailure({
                                        currentLockVersion: stored.meta.lockVersion,
                                    }),
                                );
                            }
                            stored = {
                                ...stored,
                                ...(request.name === undefined ? {} : { name: request.name }),
                                meta: meta({ lockVersion: request.lockVersion + 1 }),
                            };
                            return stored;
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-name-en-input');

        // Somebody else saves the same recipe. The editor is now holding a superseded version —
        // exactly the state `If-Match` exists to detect.
        stored = {
            ...stored,
            description: { en: 'Changed by the other tab.', ar: 'غُيّر من التبويب الآخر.' },
            meta: meta({ lockVersion: 2 }),
        };

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-recipe-name-en-input'), 'My version');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        await untilVisible('kitchen-recipe-editor-screen-conflict-dialog');

        // One attempt, refused, and the other tab's write stands.
        expect(repositories.kitchenAdmin.updateRecipe).toHaveBeenCalledTimes(1);
        expect(stored.name.en).toBe('Conflict me');
        expect(stored.description.en).toBe('Changed by the other tab.');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-conflict-reload'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-recipe-name-en-input').props.value).toBe(
                'Conflict me',
            );
        });
    });

    it('asks before throwing away an unsaved line', async () => {
        const stored = recipe({ ordinal: 7, name: 'Discard me' });

        await renderStubScreen(<RecipeEditScreen recipe={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: editorReads(() => stored) },
        });

        await untilVisible('kitchen-recipe-editor-screen-header');
        await openTab('production');
        await untilVisible(LINE_PICKER_INPUT);
        // An unsaved *line*, specifically: the guard has to fire for a section the header's own
        // fields know nothing about, which is exactly the edit a person is most likely to lose.
        await addLine(String(UNMAPPED_INGREDIENT.id));

        // Discard is the way out now — the header is the design's Discard · Save draft · Publish,
        // and Back went with the two-pane frame. It routes through the same guard.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-discard'));
        });

        await untilVisible('kitchen-recipe-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-unsaved-discard'));
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/recipes');
        });
    });
});
