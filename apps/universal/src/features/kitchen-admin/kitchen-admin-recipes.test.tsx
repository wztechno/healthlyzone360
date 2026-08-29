import { apiFailure, conflictFailure, throwFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    CursorPage,
    IngredientAdmin,
    IngredientAdminFilter,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
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
        categoryCode: 'store-cupboard',
        measurementUnit: 'g',
        purchaseUnit: null,
        composition: null,
        itemsPerUnit: null,
        costPer100g: { amount: 1.25, currency: 'AED' },
        per100g: null,
        allergens: [],
        dietClassifications: [],
        aliases: [],
        organisationId: TEST_ORGANISATION_ID,
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
        kitchenId: TEST_KITCHEN_ID,
        sourceKind: null,
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
        kitchenId: record.kitchenId,
        sourceKind: record.sourceKind,
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
function recipeListing(
    read: () => readonly RecipeAdmin[],
): (filter?: RecipeAdminFilter) => Promise<CursorPage<RecipeAdminSummary>> {
    return async (filter) => {
        const statuses = filter?.statuses;
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';

        return page(
            read()
                .filter(
                    (row) =>
                        (statuses === undefined || statuses.includes(row.meta.status)) &&
                        (needle === '' ||
                            row.name.en.toLocaleLowerCase().includes(needle) ||
                            row.name.ar.includes(needle) ||
                            row.slug.includes(needle)),
                )
                .map(summaryOf),
        );
    };
}

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

        const base = `kitchen-recipe-${String(published.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-version`)).toHaveTextContent(
            new RegExp(String(published.currentVersionNumber)),
        );
        // The version's own state is not on the summary; it is read per row and rendered when it
        // arrives rather than guessed from the recipe's status.
        await waitFor(() => {
            expect(screen.getByTestId(`${base}-version-status`)).toHaveTextContent(/Published/);
        });
        // The derived label the authored version carries — one declaration, so the cell is the
        // list, not the "no allergens" fallback beside it.
        await untilVisible(`${base}-allergens`);
        expect(screen.queryByTestId(`${base}-allergens-none`)).toBeNull();
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();
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
            yieldUnit: 'portion',
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
        // Immutable: no way to add a line, and the one control offered is the successor draft.
        expect(screen.getByTestId('kitchen-recipe-immutable')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-lines-add')).toBeNull();

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

        // The editor rebases onto the new version and becomes editable.
        await untilVisible('kitchen-recipe-lines-add');

        // A copy, not a blank: the whole point of opening a draft *from* a version. The count the
        // editor renders is the copied line set, not a fresh one.
        expect(stored.currentVersion.versionNumber).toBe(publishedVersion.versionNumber + 1);
        expect(stored.currentVersion.lines).toHaveLength(publishedVersion.lines.length);
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-recipe-lines-count')).toHaveTextContent(
                new RegExp(String(publishedVersion.lines.length)),
            );
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

describe('the line editor', () => {
    it('adds, removes, undoes and reorders, announcing where a row landed', async () => {
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

        await untilVisible('kitchen-recipe-lines-add');

        // Two lines, because this test authored two.
        expect(seededCount).toBe(2);
        expect(screen.getByTestId('kitchen-recipe-lines-count')).toHaveTextContent(
            new RegExp(String(seededCount)),
        );

        // ── add ──────────────────────────────────────────────────────────────────────────────
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-add'));
        });
        const added = 'kitchen-recipe-lines-row-row-1';
        await untilVisible(added);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${added}-ingredient-trigger`));
        });
        await untilVisible(`${added}-ingredient-list`);
        await act(async () => {
            fireEvent.press(
                screen.getByTestId(`${added}-ingredient-option-${String(UNMAPPED_INGREDIENT.id)}`),
            );
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-quantity-input`), '120');
        });

        // ── move ─────────────────────────────────────────────────────────────────────────────
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${added}-move-up`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-recipe-lines-announcer')).toHaveTextContent(
                new RegExp(
                    `moved to position ${String(seededCount)} of ${String(seededCount + 1)}`,
                ),
            );
        });
        // The row kept its key across the move — the number beside it is its *position*, not its id.
        expect(screen.getByTestId(`${added}-position`)).toHaveTextContent(
            new RegExp(`Line ${String(seededCount)}$`),
        );

        // ── remove, then take it back ────────────────────────────────────────────────────────
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${added}-remove`));
        });
        expect(screen.queryByTestId(added)).toBeNull();
        await untilVisible('kitchen-recipe-lines-undo');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-undo'));
        });
        await untilVisible(added);
        // Restored to the position it was removed from, not appended to the end.
        expect(screen.getByTestId(`${added}-position`)).toHaveTextContent(
            new RegExp(`Line ${String(seededCount)}$`),
        );

        // ── save ─────────────────────────────────────────────────────────────────────────────
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        // Wholesale, in the order the editor is showing, at the version it opened with: the added
        // row sits second because that is where the move put it and where the undo restored it.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setRecipeLines).toHaveBeenCalledWith(stored.id, {
                lockVersion: stored.meta.lockVersion,
                lines: [
                    {
                        ingredientId: MAPPED_INGREDIENT.id,
                        quantity: 200,
                        unit: 'g',
                        isOptional: false,
                    },
                    {
                        ingredientId: UNMAPPED_INGREDIENT.id,
                        quantity: 120,
                        unit: 'g',
                        isOptional: false,
                    },
                    {
                        ingredientId: UNMAPPED_INGREDIENT.id,
                        quantity: 30,
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

        await untilVisible('kitchen-recipe-lines-add');

        for (const key of ['row-1', 'row-2']) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('kitchen-recipe-lines-add'));
            });
            const row = `kitchen-recipe-lines-row-${key}`;
            await untilVisible(row);
            await act(async () => {
                fireEvent.press(screen.getByTestId(`${row}-ingredient-trigger`));
            });
            await untilVisible(`${row}-ingredient-list`);
            await act(async () => {
                fireEvent.press(
                    screen.getByTestId(`${row}-ingredient-option-${String(MAPPED_INGREDIENT.id)}`),
                );
            });
            await act(async () => {
                fireEvent.changeText(screen.getByTestId(`${row}-quantity-input`), '10');
            });
        }

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        // The original plus the two just added: nothing was merged. A sheet that lists olive oil
        // twice — once for the pan and once to finish — is describing two things.
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

describe('the outputs editor', () => {
    it('refuses to save until exactly one output is the primary one', async () => {
        const stored = recipe({ ordinal: 7, name: 'Pesto base' });

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        setRecipeOutputs: async () => stored,
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-outputs-add');

        for (const [key, entry] of [
            ['row-1', UNMAPPED_INGREDIENT],
            ['row-2', MAPPED_INGREDIENT],
        ] as const) {
            await act(async () => {
                fireEvent.press(screen.getByTestId('kitchen-recipe-outputs-add'));
            });
            const row = `kitchen-recipe-outputs-row-${key}`;
            await untilVisible(row);
            await act(async () => {
                fireEvent.press(screen.getByTestId(`${row}-ingredient-trigger`));
            });
            await untilVisible(`${row}-ingredient-list`);
            await act(async () => {
                fireEvent.press(screen.getByTestId(`${row}-ingredient-option-${String(entry.id)}`));
            });
            await act(async () => {
                fireEvent.changeText(screen.getByTestId(`${row}-quantity-input`), '500');
            });
        }

        // Two outputs and no primary: the field says so and the save is refused before it is sent.
        await untilVisible('kitchen-recipe-outputs-primary-error');
        expect(
            screen.getByTestId('kitchen-recipe-editor-screen-save').props.accessibilityState
                .disabled,
        ).toBe(true);
        expect(repositories.kitchenAdmin.setRecipeOutputs).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-outputs-primary-trigger'));
        });
        await untilVisible('kitchen-recipe-outputs-primary-list');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-outputs-primary-option-row-2'));
        });

        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-recipe-outputs-primary-error')).toBeNull();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.setRecipeOutputs).toHaveBeenCalledWith(stored.id, {
                lockVersion: stored.meta.lockVersion,
                outputs: [
                    {
                        ingredientId: UNMAPPED_INGREDIENT.id,
                        quantity: 500,
                        unit: 'g',
                        isPrimary: false,
                    },
                    {
                        ingredientId: MAPPED_INGREDIENT.id,
                        quantity: 500,
                        unit: 'g',
                        isPrimary: true,
                    },
                ],
            });
        });
    });
});

describe('the method editor', () => {
    it('writes a step in both languages and orders by position', async () => {
        const stored = recipe({ ordinal: 8, name: 'Baba ghanoush' });
        const seededSteps = stored.currentVersion.steps.length;

        const { repositories } = await renderStubScreen(
            <RecipeEditScreen recipe={String(stored.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => stored),
                        setRecipeSteps: async () => stored,
                    },
                },
            },
        );

        await untilVisible('kitchen-recipe-steps-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-steps-add'));
        });
        const row = 'kitchen-recipe-steps-row-row-1';
        await untilVisible(row);

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId(`${row}-instruction-en-input`),
                'Rest for ten minutes.',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId(`${row}-instruction-ar-input`),
                'اتركه يرتاح عشر دقائق.',
            );
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-minutes-input`), '10');
        });

        // Each half writes in its own direction, whatever the interface does.
        expect(screen.getByTestId(`${row}-instruction-en-input`).props.style).toEqual(
            expect.objectContaining({ writingDirection: 'ltr' }),
        );
        expect(screen.getByTestId(`${row}-instruction-ar-input`).props.style).toEqual(
            expect.objectContaining({ writingDirection: 'rtl' }),
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        // Array order *is* step order — the contract says the server assigns the indices — so the
        // new step travels last, in both languages, with its own duration.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setRecipeSteps).toHaveBeenCalledWith(stored.id, {
                lockVersion: stored.meta.lockVersion,
                steps: [
                    {
                        instruction: { en: 'Rest for ten minutes.', ar: 'اتركه يرتاح عشر دقائق.' },
                        minutes: 10,
                    },
                ],
            });
        });
        expect(seededSteps).toBe(0);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The roll-up preview
 * ---------------------------------------------------------------------------------------------- */

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

        await untilVisible('kitchen-recipe-rollup-figures');
        const preview = repositories.kitchenAdmin.previewRecipeRollup as jest.Mock;
        const before = preview.mock.calls.length;
        expect(before).toBeGreaterThan(0);

        jest.useFakeTimers();

        // A quantity is a stream of intermediate values; nothing is requested for any of them.
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-recipe-lines-row-line-1-quantity-input'),
                '333',
            );
        });
        expect(preview.mock.calls.length).toBe(before);

        await act(async () => {
            jest.advanceTimersByTime(500);
        });
        expect(preview.mock.calls.length).toBe(before + 1);

        // A unit change is a completed decision and is not made to wait.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-row-line-1-unit-trigger'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-row-line-1-unit-option-kg'));
        });
        expect(preview.mock.calls.length).toBe(before + 2);

        jest.useRealTimers();
    });

    it('keeps the previous allergen list on screen, dimmed, while the next one is fetched', async () => {
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

        await untilVisible('kitchen-recipe-rollup-allergens');
        const figures = screen.getByTestId('kitchen-recipe-rollup-figures');
        expect(figures.props['aria-busy']).toBe(false);
        expect(screen.getByTestId('kitchen-recipe-rollup-allergen-gluten')).toBeTruthy();

        // Hold the *next* answer open, then make a structural edit so one is requested at once.
        hold = true;
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-row-line-1-unit-trigger'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-row-line-1-unit-option-kg'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-recipe-rollup-spinner')).toBeTruthy();
        });
        // The figures are dimmed and marked busy — and the allergen list is *still there*.
        expect(screen.getByTestId('kitchen-recipe-rollup-figures').props['aria-busy']).toBe(true);
        expect(screen.getByTestId('kitchen-recipe-rollup-allergen-gluten')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-rollup-allergens-none')).toBeNull();
    });

    it('expands an allergen to the lines that put it there', async () => {
        const stored = recipe({ ordinal: 5, name: 'Mujaddara' });

        await renderStubScreen(<RecipeEditScreen recipe={String(stored.id)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: editorReads(() => stored) },
        });

        await untilVisible('kitchen-recipe-rollup-allergens');
        const chip = 'kitchen-recipe-rollup-allergen-gluten';

        expect(screen.queryByTestId(`${chip}-sources`)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${chip}-chip`));
        });

        await untilVisible(`${chip}-sources`);
        // Named, not just counted: the ingredient the authored preview blamed.
        expect(screen.getByTestId(`${chip}-sources`)).toHaveTextContent(/from:/);
        expect(screen.getByTestId(`${chip}-sources`)).toHaveTextContent(
            new RegExp(MAPPED_INGREDIENT.name.en),
        );
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
        expect(screen.getByTestId('kitchen-recipe-editor-screen-status')).toHaveTextContent(
            /Awaiting review/,
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

        await untilVisible('kitchen-recipe-lines-add');

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

        await untilVisible('kitchen-recipe-lines-add');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-add'));
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-back'));
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
