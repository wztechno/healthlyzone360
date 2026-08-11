import { apiFailure, conflictFailure, throwFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    AllergenClass,
    BranchOperating,
    CursorPage,
    IngredientAdmin,
    IngredientAdminFilter,
    IngredientAllergenMapping,
} from '@healthy360/api-client/contracts';
import { AllergenCode, IngredientId, KitchenBranchId, RoleId } from '@healthy360/domain-types';
import type { AccessState } from '@healthy360/permissions';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
    ORGANISATION_OWNER_PERMISSIONS,
    TEST_BRANCH_ID,
    TEST_ORGANISATION_ID,
    kitchenManagerSession,
    testActiveContext,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { displayName, isTranslationIncomplete, statusTone, unitDimension } from './format.ts';
import { ENTITY_FAMILIES, WORKSPACE_PERMISSIONS, permittedFamilies } from './entity-registry.ts';
import { AllergenClassesScreen } from './screens/allergen-classes-screen.tsx';
import { IngredientEditScreen } from './screens/ingredient-edit-screen.tsx';
import { IngredientsScreen } from './screens/ingredients-screen.tsx';
import { KitchenHomeScreen } from './screens/kitchen-home-screen.tsx';

/**
 * The kitchen workspace, against a world this file declares.
 *
 * Nothing here stubs a hook: the screens still run through `Repositories`, the same interface
 * production speaks. What changed is where the data comes from — every record, every count and every
 * rejection below is authored in this file and handed to `renderStubScreen`, so a count assertion is
 * a statement about what the test wrote rather than about somebody else's fixture world.
 *
 * Four things this file exists to prove, in rough order of how badly it would matter if they were
 * wrong:
 *
 * 1. **The permission boundary is real on both sides.** The kitchen manager sees the workspace; an
 *    organisation owner with an organisation, a branch and no catalogue permission gets the forbidden
 *    page rather than an empty grid. A test that only checked the positive half would pass just as
 *    happily if the gate had been left off.
 * 2. **A write really writes, and carries the version it was based on.** Creating, renaming,
 *    archiving and re-mapping all go through the contract, and the assertions read the *call* —
 *    identifier, lock version, payload — rather than trusting the screen's own optimism.
 * 3. **The two safety mechanisms fire.** A stale `lockVersion` produces the conflict dialog rather
 *    than a silent overwrite, and weakening a platform baseline allergen determination is refused
 *    per row before anything is sent.
 * 4. **Both languages are editable in their own direction.** The bilingual field pins each input's
 *    `writingDirection` to the language it holds, in either interface direction — which is the
 *    whole reason it exists.
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
        usePathname: () => '/kitchen',
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

/**
 * Waits for an element, with headroom.
 *
 * Twenty-one suites saturate every core under `turbo run test`, and a screen that settles instantly
 * alone can cross React Native Testing Library's one-second default when they all run at once — the
 * same contention `jest.config.js` raises `testTimeout` for. Contention headroom only: a screen that
 * needs this long alone is a defect.
 */
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
 * Every builder is typed against its contract shape, so a contract that grows a required field
 * fails the typecheck here rather than producing a record the screen cannot render.
 * ---------------------------------------------------------------------------------------------- */

/** UUIDv7-shaped, because `IngredientEditScreen` parses the route parameter with `IngredientId`. */
function ingredientId(ordinal: number): IngredientId {
    return IngredientId.unsafe(`01935f6d-0000-7000-8000-0000000a000${String(ordinal)}`);
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

function mapping(
    code: string,
    overrides: Partial<IngredientAllergenMapping> = {},
): IngredientAllergenMapping {
    return {
        allergenCode: AllergenCode.parse(code),
        containment: 'contains',
        marketScope: [],
        verification: 'supplier_declared',
        sourceNote: null,
        ...overrides,
    };
}

/** A kitchen-owned row: the editor may rename, alias and archive it. */
function ingredient(ordinal: number, overrides: Partial<IngredientAdmin> = {}): IngredientAdmin {
    return {
        id: ingredientId(ordinal),
        meta: meta(),
        name: { en: `Ingredient ${String(ordinal)}`, ar: `مكوّن ${String(ordinal)}` },
        reference: `IG-00${String(ordinal)}`,
        categoryCode: 'store-cupboard',
        measurementUnit: 'g',
        costPer100g: null,
        per100g: null,
        allergens: [],
        dietClassifications: [],
        aliases: [],
        organisationId: TEST_ORGANISATION_ID,
        notes: null,
        ...overrides,
    };
}

/**
 * A shared-library row: `organisationId === null` is what makes the editor read-only and its
 * allergen determination a platform baseline (plan §4.6).
 */
function platformIngredient(
    ordinal: number,
    overrides: Partial<IngredientAdmin> = {},
): IngredientAdmin {
    return ingredient(ordinal, { organisationId: null, reference: null, ...overrides });
}

const ALLERGEN_CLASS_CODES: readonly string[] = [
    'gluten',
    'crustaceans',
    'eggs',
    'fish',
    'peanuts',
    'soybeans',
    'milk',
    'tree_nuts',
    'celery',
    'mustard',
    'sesame',
    'sulphites',
    'lupin',
    'molluscs',
];

function allergenClass(code: string, overrides: Partial<AllergenClass> = {}): AllergenClass {
    return {
        code: AllergenCode.parse(code),
        name: { en: code.replace(/_/g, ' '), ar: `${code} بالعربية` },
        description: { en: `The ${code} class.`, ar: `فئة ${code}.` },
        markets: ['EU', 'GCC'],
        declarationThreshold: null,
        regulatoryReference: 'EU 1169/2011 Annex II',
        severeByDefault: false,
        isActive: true,
        ...overrides,
    };
}

/** The fourteen regulatory classes, with sulphites carrying the one stated threshold. */
const ALLERGEN_CLASSES: readonly AllergenClass[] = ALLERGEN_CLASS_CODES.map((code) =>
    code === 'sulphites'
        ? allergenClass(code, { declarationThreshold: { value: 10, unit: 'mg/kg' } })
        : code === 'peanuts'
          ? allergenClass(code, { severeByDefault: true })
          : allergenClass(code),
);

function branchOperating(): BranchOperating {
    return {
        branchId: KitchenBranchId.unsafe(String(TEST_BRANCH_ID)),
        meta: {
            lockVersion: 1,
            updatedAt: '2026-08-01T09:00:00.000Z',
            updatedByName: 'Rana Haddad',
        },
        timeZone: 'Asia/Dubai',
        days: [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
            weekday <= 5
                ? { weekday, opensAt: '08:00', closesAt: '20:00', orderCutOffAt: '16:00' }
                : { weekday, opensAt: null, closesAt: null, orderCutOffAt: null },
        ),
    };
}

/**
 * The ingredient listing, answering the filters the screens actually send.
 *
 * `statuses` and `query` are real server filters (`IngredientAdminFilter`), and three call sites
 * depend on them behaving: the hub's summary counts one status at a time, the list screen's search
 * box narrows by name, and the review queue asks for `review_required` alone. Reading a getter
 * rather than a captured array is what lets a test mutate the world mid-flight and assert the
 * refetch.
 */
function ingredientListing(
    read: () => readonly IngredientAdmin[],
): (filter?: IngredientAdminFilter) => Promise<CursorPage<IngredientAdmin>> {
    return async (filter) => {
        const statuses = filter?.statuses;
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';

        return page(
            read().filter(
                (row) =>
                    (statuses === undefined || statuses.includes(row.meta.status)) &&
                    (needle === '' ||
                        row.name.en.toLocaleLowerCase().includes(needle) ||
                        row.name.ar.includes(needle) ||
                        (row.reference ?? '').toLocaleLowerCase().includes(needle)),
            ),
        );
    };
}

/**
 * Everything the hub reads.
 *
 * The kitchen manager holds every workspace permission, so the grid renders every family and each
 * card fetches its own summary. Declaring all of them is the point of the harness: a card whose
 * listing this file forgot would reject with `StubNotConfiguredError` naming it, rather than
 * quietly rendering "Count unavailable" over a hole in the test.
 */
function hubRepositories(ingredients: readonly IngredientAdmin[]): RepositoryOverrides {
    return {
        kitchenAdmin: {
            listIngredients: ingredientListing(() => ingredients),
            listRecipes: async () => page([]),
            listProducts: async () => page([]),
            listMeals: async () => page([]),
            listPlans: async () => page([]),
            listPriceLists: async () => page([]),
            listZones: async () => page([]),
            listAllergenClasses: async () => ALLERGEN_CLASSES,
            getBranchOperating: async () => branchOperating(),
        },
        kitchenOps: {
            countLowStockLevels: async () => 0,
            countUnresolvedConsumptionExceptions: async () => 0,
        },
    };
}

/** The two reads every editor render needs: the class vocabulary and the category derivation. */
function editorReads(library: () => readonly IngredientAdmin[]) {
    return {
        listAllergenClasses: async () => ALLERGEN_CLASSES,
        listIngredients: ingredientListing(library),
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

describe('display helpers', () => {
    it('prefers the reader language and marks a fallback', () => {
        const both = { en: 'Chickpeas', ar: 'حمّص' };
        expect(displayName(both, 'en')).toEqual({ value: 'Chickpeas', isFallback: false });
        expect(displayName(both, 'ar')).toEqual({ value: 'حمّص', isFallback: false });

        const englishOnly = { en: 'Chickpeas', ar: '' };
        expect(displayName(englishOnly, 'ar')).toEqual({
            value: 'Chickpeas',
            isFallback: true,
        });
        expect(isTranslationIncomplete(englishOnly)).toBe(true);
        expect(isTranslationIncomplete(both)).toBe(false);
    });

    it('quarantine is a warning, never the same tone as a draft', () => {
        expect(statusTone('review_required')).toBe('warning');
        expect(statusTone('published')).toBe('success');
        expect(statusTone('draft')).toBe('neutral');
    });

    it('never puts a mass unit and a volume unit in the same dimension', () => {
        expect(unitDimension('g')).toBe('mass');
        expect(unitDimension('kg')).toBe('mass');
        expect(unitDimension('ml')).toBe('volume');
        expect(unitDimension('portion')).toBe('serving');
        expect(unitDimension('piece')).toBe('count');
    });
});

describe('entity registry', () => {
    it('offers nothing to a state with no catalogue permission', () => {
        const state: AccessState = {
            mode: 'all-dev',
            session: 'authenticated',
            emailVerified: true,
            hasActiveMembership: true,
            permissions: new Set<string>(['organisation.view_current']),
            entitlements: new Set<string>(),
        };
        expect(permittedFamilies(state)).toEqual([]);
    });

    it('gates every family on a permission that the hub route also demands', () => {
        for (const family of ENTITY_FAMILIES) {
            expect(WORKSPACE_PERMISSIONS).toContain(family.permission);
        }
    });

    it('assigns every family to a known ops group', () => {
        for (const family of ENTITY_FAMILIES) {
            expect(['workbench', 'catalogue', 'commercial', 'operations']).toContain(family.group);
        }
    });
});

/* ------------------------------------------------------------------------------------------------
 * The hub
 * ---------------------------------------------------------------------------------------------- */

describe('the kitchen hub', () => {
    it('shows the families the kitchen manager may open, with counts read from the listing', async () => {
        // Four rows: two published, one draft, one quarantined. Every badge below is that
        // arithmetic and nothing else.
        const library = [
            ingredient(1, { meta: meta({ status: 'published' }) }),
            ingredient(2, { meta: meta({ status: 'published' }) }),
            ingredient(3),
            ingredient(4, { meta: meta({ status: 'review_required' }) }),
        ];

        await renderStubScreen(<KitchenHomeScreen />, {
            session: kitchenManagerSession(),
            repositories: hubRepositories(library),
        });

        await untilVisible('kitchen-home-screen');

        expect(screen.getByTestId('kitchen-family-ingredients')).toBeTruthy();
        expect(screen.getByTestId('kitchen-family-allergen-classes')).toBeTruthy();
        expect(screen.getByTestId('kitchen-home-section-catalogue')).toBeTruthy();
        expect(screen.getByTestId('kitchen-home-kpis')).toBeTruthy();

        await untilVisible('kitchen-family-ingredients-total');
        // The badge counts the library the repository actually answered with.
        expect(screen.getByTestId('kitchen-family-ingredients-total')).toHaveTextContent(
            new RegExp(String(library.length)),
        );
        expect(screen.getByTestId('kitchen-family-ingredients-drafts')).toHaveTextContent(/1/);
        expect(screen.getByTestId('kitchen-family-ingredients-quarantined')).toHaveTextContent(/1/);
        // A reference family says it is reference rather than inventing a draft count.
        expect(screen.getByTestId('kitchen-family-allergen-classes-reference')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-family-allergen-classes-drafts')).toBeNull();
    });

    it('refuses a signed-in person whose role carries no catalogue permission', async () => {
        // No repository overrides at all: the gate refuses before the grid can ask for anything, so
        // a screen that fetched here would fail loudly with StubNotConfiguredError.
        await renderStubScreen(<KitchenHomeScreen />, { session: organisationOwnerSession() });

        await untilVisible('kitchen-home-forbidden');
        expect(screen.queryByTestId('kitchen-home-grid')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

describe('the ingredient list', () => {
    it('renders skeletons, then the authored rows with their allergens and status', async () => {
        const mapped = ingredient(1, {
            meta: meta({ status: 'published' }),
            allergens: [mapping('gluten')],
        });
        const unmapped = ingredient(2);

        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a stub that resolves on a microtask.
        await renderStubScreen(<IngredientsScreen />, {
            session: kitchenManagerSession(),
            latencyMs: 40,
            repositories: {
                kitchenAdmin: { listIngredients: ingredientListing(() => [mapped, unmapped]) },
            },
        });

        await untilVisible('kitchen-ingredients-loading');
        await untilVisible('kitchen-ingredients-table');

        expect(screen.getByTestId(`kitchen-ingredient-${String(mapped.id)}-name`)).toBeTruthy();
        expect(
            screen.getByTestId(`kitchen-ingredient-${String(mapped.id)}-allergens`),
        ).toBeTruthy();
        expect(
            screen.getByTestId(`kitchen-ingredient-${String(mapped.id)}-status`),
        ).toHaveTextContent(/Published/);
        expect(
            screen.getByTestId(`kitchen-ingredient-${String(unmapped.id)}-allergens-none`),
        ).toBeTruthy();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderStubScreen(<IngredientsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: ingredientListing(() => [ingredient(1), ingredient(2)]),
                },
            },
        });
        await untilVisible('kitchen-ingredients-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredients-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-ingredients-empty');
        // The filtered branch is the one a person actually reaches, and it is the one that offers a
        // way back out of the filter.
        expect(screen.getByTestId('kitchen-ingredients-clear')).toBeTruthy();
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<IngredientsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: async () =>
                        throwFailure(apiFailure('server', { message: 'Boom.' })),
                },
            },
        });

        await untilVisible('kitchen-ingredients-error');
    });

    it('archives a row behind a confirmation, carrying the version it was based on', async () => {
        const target = ingredient(2, { meta: meta({ status: 'published', lockVersion: 3 }) });
        let library: readonly IngredientAdmin[] = [ingredient(1), target];

        const { repositories } = await renderStubScreen(<IngredientsScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: ingredientListing(() => library),
                    archiveIngredient: async (id, request) => {
                        const archived: IngredientAdmin = {
                            ...target,
                            meta: meta({
                                status: 'retired',
                                lockVersion: request.lockVersion + 1,
                            }),
                        };
                        library = library.map((row) => (row.id === id ? archived : row));
                        return archived;
                    },
                },
            },
        });
        await untilVisible('kitchen-ingredients-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-ingredient-${String(target.id)}-archive`));
        });

        await untilVisible('kitchen-ingredients-archive-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredients-archive-confirm'));
        });

        // The write is the assertion: this row, at the version the list was showing.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.archiveIngredient).toHaveBeenCalledWith(target.id, {
                lockVersion: 3,
            });
        });

        // …and the list refreshes rather than keeping the row at its old status.
        await waitFor(() => {
            expect(
                screen.getByTestId(`kitchen-ingredient-${String(target.id)}-status`),
            ).toHaveTextContent(/Archived/);
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The editor
 * ---------------------------------------------------------------------------------------------- */

describe('the ingredient editor', () => {
    it('writes each language in its own direction, whatever the interface does', async () => {
        await renderStubScreen(<IngredientEditScreen ingredient="new" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenAdmin: editorReads(() => []) },
        });

        await untilVisible('kitchen-ingredient-name-en-input');

        const english = screen.getByTestId('kitchen-ingredient-name-en-input');
        const arabic = screen.getByTestId('kitchen-ingredient-name-ar-input');

        expect(english.props.style).toEqual(
            expect.objectContaining({ writingDirection: 'ltr', textAlign: 'auto' }),
        );
        expect(arabic.props.style).toEqual(
            expect.objectContaining({ writingDirection: 'rtl', textAlign: 'auto' }),
        );
    });

    it('creates a draft and moves to its own address', async () => {
        const created = ingredient(9, {
            name: { en: 'Toasted burghul', ar: '' },
            reference: null,
            meta: meta({ status: 'draft' }),
        });

        const { repositories } = await renderStubScreen(<IngredientEditScreen ingredient="new" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...editorReads(() => [ingredient(1)]),
                    createIngredient: async () => created,
                },
            },
        });

        await untilVisible('kitchen-ingredient-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-name-en-input'),
                'Toasted burghul',
            );
        });

        // The category is required, and the Select is the only way to answer it. Its vocabulary is
        // derived from the codes in use, so this option exists because the library above carries it.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-category-trigger'));
        });
        await untilVisible('kitchen-ingredient-category-list');
        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-ingredient-category-option-store-cupboard'),
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-save'));
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/ingredients/${String(created.id)}`,
            );
        });

        // Exactly this request and nothing else. `CreateIngredientRequest` carries no status field
        // at all, and the equality above is what proves the screen invents none: a catalogue that
        // published a row the moment it was typed would be the opposite of the publication safety
        // this phase exists to build.
        expect(repositories.kitchenAdmin.createIngredient).toHaveBeenCalledWith({
            name: { en: 'Toasted burghul', ar: '' },
            categoryCode: 'store-cupboard',
            measurementUnit: 'g',
        });
    });

    it('keeps platform-library details read-only and leaves allergen mapping as the writable path', async () => {
        const record = platformIngredient(5, {
            meta: meta({ status: 'published' }),
            allergens: [mapping('gluten')],
        });

        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...editorReads(() => [record]),
                    getIngredient: async () => record,
                },
            },
        });

        await untilVisible('kitchen-ingredient-platform-library');
        expect(screen.queryByTestId('kitchen-ingredient-editor-screen-save')).toBeNull();
        expect(screen.queryByTestId('kitchen-ingredient-archive')).toBeNull();
        expect(screen.queryByTestId('kitchen-ingredient-alias-input-input')).toBeNull();

        await untilVisible('kitchen-ingredient-mapping-save');
    });

    it('saves a rename and rebases onto the version the write produced', async () => {
        const id = ingredientId(3);
        let stored = ingredient(3, {
            name: { en: 'Rename me', ar: '' },
            meta: meta({ lockVersion: 4 }),
        });

        const { repositories } = await renderStubScreen(
            <IngredientEditScreen ingredient={String(id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => [stored]),
                        getIngredient: async () => stored,
                        updateIngredient: async (_id, request) => {
                            // The server's rule, stated once: an accepted write answers with the
                            // record at its *next* version.
                            stored = {
                                ...stored,
                                ...(request.name === undefined ? {} : { name: request.name }),
                                meta: {
                                    ...stored.meta,
                                    lockVersion: request.lockVersion + 1,
                                },
                            };
                            return stored;
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-ingredient-name-ar-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-name-ar-input'),
                'اسم عربي جديد',
            );
        });
        expect(screen.getByTestId('kitchen-ingredient-editor-screen-dirty')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateIngredient).toHaveBeenCalledWith(
                id,
                expect.objectContaining({
                    lockVersion: 4,
                    name: { en: 'Rename me', ar: 'اسم عربي جديد' },
                }),
            );
        });

        // Saved is clean: the unsaved badge goes, so navigating away asks nothing.
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-ingredient-editor-screen-dirty')).toBeNull();
        });

        // …and the editor rebased: the *next* save carries the version the first write produced,
        // not the one it opened with.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-ingredient-name-ar-input'), 'اسم آخر');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateIngredient).toHaveBeenNthCalledWith(
                2,
                id,
                expect.objectContaining({ lockVersion: 5 }),
            );
        });
    });

    it('asks before discarding unsaved changes, and leaves when told to', async () => {
        const record = ingredient(3, { name: { en: 'Discard me', ar: 'اتركني' } });

        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...editorReads(() => [record]),
                    getIngredient: async () => record,
                },
            },
        });

        await untilVisible('kitchen-ingredient-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-name-en-input'),
                'Half typed',
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-back'));
        });

        await untilVisible('kitchen-ingredient-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-unsaved-discard'));
        });

        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/ingredients');
        });
    });

    it('adds and removes an alias, and can take the removal back', async () => {
        const record = ingredient(3, { name: { en: 'Alias me', ar: 'سمّني' } });

        const { repositories } = await renderStubScreen(
            <IngredientEditScreen ingredient={String(record.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => [record]),
                        getIngredient: async () => record,
                        updateIngredient: async (_id, request) => ({
                            ...record,
                            aliases: request.aliases ?? record.aliases,
                            meta: { ...record.meta, lockVersion: request.lockVersion + 1 },
                        }),
                    },
                },
            },
        );

        await untilVisible('kitchen-ingredient-alias-input-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-alias-input-input'),
                'Chuck',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-alias-add'));
        });

        expect(screen.getByTestId('kitchen-ingredient-alias-Chuck')).toBeTruthy();

        // Removing offers an explicit undo rather than only a toast that scrolls away.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-alias-Chuck-remove'));
        });
        expect(screen.queryByTestId('kitchen-ingredient-alias-Chuck')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-alias-undo'));
        });
        expect(screen.getByTestId('kitchen-ingredient-alias-Chuck')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-save'));
        });

        // Aliases are a *field*, not a sub-resource: the whole list travels with the next save.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateIngredient).toHaveBeenCalledWith(
                record.id,
                expect.objectContaining({ aliases: ['Chuck'] }),
            );
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Allergen mapping
 * ---------------------------------------------------------------------------------------------- */

describe('the allergen mapping editor', () => {
    it('marks a platform baseline row and refuses to weaken it', async () => {
        const record = platformIngredient(5, {
            meta: meta({ status: 'published' }),
            allergens: [mapping('gluten', { containment: 'contains' })],
        });

        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...editorReads(() => [record]),
                    getIngredient: async () => record,
                },
            },
        });

        const baselineKey = 'kitchen-ingredient-mapping-baseline-gluten';

        await untilVisible(baselineKey);
        expect(screen.getByTestId(`${baselineKey}-baseline`)).toBeTruthy();

        // The authored determination is `contains`; asking for `may_contain` is a downgrade.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${baselineKey}-containment-may_contain`));
        });

        await waitFor(() => {
            expect(screen.getByTestId(`${baselineKey}-error`)).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-ingredient-mapping-blocked')).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-ingredient-mapping-save').props.accessibilityState.disabled,
        ).toBe(true);

        // Putting it back clears the refusal — the rule is upgrade-only, not immutable.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${baselineKey}-containment-contains`));
        });
        await waitFor(() => {
            expect(screen.queryByTestId(`${baselineKey}-error`)).toBeNull();
        });
    });

    it('adds a mapping and saves the whole set', async () => {
        const record = ingredient(6, { allergens: [] });

        const { repositories } = await renderStubScreen(
            <IngredientEditScreen ingredient={String(record.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => [record]),
                        getIngredient: async () => record,
                        setIngredientAllergens: async (_id, request) => ({
                            ...record,
                            allergens: request.mappings,
                            meta: { ...record.meta, lockVersion: request.lockVersion + 1 },
                        }),
                    },
                },
            },
        );

        await untilVisible('kitchen-ingredient-allergen-empty');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-mapping-add'));
        });

        const rowId = 'kitchen-ingredient-mapping-overlay-1';
        await untilVisible(rowId);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${rowId}-class-trigger`));
        });
        await untilVisible(`${rowId}-class-list`);
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${rowId}-class-option-gluten`));
        });

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId(`${rowId}-evidence-input`),
                'Supplier sheet 4.',
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-mapping-save'));
        });

        // Wholesale, at the version the editor opened with: an allergen determination is judged as
        // a set, and applying half of one would leave a label nobody meant to publish.
        await waitFor(() => {
            expect(repositories.kitchenAdmin.setIngredientAllergens).toHaveBeenCalledWith(
                record.id,
                {
                    lockVersion: record.meta.lockVersion,
                    mappings: [
                        {
                            allergenCode: 'gluten',
                            containment: 'contains',
                            marketScope: [],
                            verification: 'unverified',
                            sourceNote: 'Supplier sheet 4.',
                        },
                    ],
                },
            );
        });
    });

    it('renders the quarantine the server answers with when a determination is dropped', async () => {
        // The store quarantines an ingredient whose dropped allergen a *published* recipe derives
        // from it — the burghul/pita contradiction the master plan calls out. That derivation is a
        // server decision, so the honest thing for a test to assert is the half the screen owns:
        // the quarantine comes back inside a *successful* write, and the editor renders it rather
        // than swallowing it.
        const record = ingredient(7, {
            meta: meta({ status: 'published' }),
            allergens: [mapping('gluten')],
        });

        // Stateful on purpose: the save invalidates the editor's reads, and a refetch that still
        // answered with the pre-save record would race the assertion back to `published`.
        let current = record;

        await renderStubScreen(<IngredientEditScreen ingredient={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...editorReads(() => [current]),
                    getIngredient: async () => current,
                    setIngredientAllergens: async (_id, request) => {
                        current = {
                            ...record,
                            allergens: request.mappings,
                            meta: meta({
                                status: 'review_required',
                                lockVersion: request.lockVersion + 1,
                            }),
                        };
                        return current;
                    },
                },
            },
        });

        const rowId = 'kitchen-ingredient-mapping-baseline-gluten';
        await untilVisible(rowId);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${rowId}-remove`));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-mapping-save'));
        });

        await untilVisible('kitchen-ingredient-quarantine');
        expect(screen.getByTestId('kitchen-ingredient-editor-screen-status')).toHaveTextContent(
            /Awaiting review/,
        );
    });
});

/* ------------------------------------------------------------------------------------------------
 * Optimistic concurrency
 * ---------------------------------------------------------------------------------------------- */

describe('optimistic concurrency', () => {
    it('offers reload-or-keep when somebody else has moved the record on', async () => {
        const id = ingredientId(8);
        // The record as the server holds it. The test moves this on mid-flight, exactly as another
        // tab would, and the write rule below is the server's own: a stale `lockVersion` is refused.
        let stored = ingredient(8, {
            name: { en: 'Conflict me', ar: 'تعارض' },
            meta: meta({ lockVersion: 1 }),
        });

        const { repositories } = await renderStubScreen(
            <IngredientEditScreen ingredient={String(id)} />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenAdmin: {
                        ...editorReads(() => [stored]),
                        getIngredient: async () => stored,
                        updateIngredient: async (_id, request) => {
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
                                meta: {
                                    ...stored.meta,
                                    lockVersion: request.lockVersion + 1,
                                },
                            };
                            return stored;
                        },
                    },
                },
            },
        );

        await untilVisible('kitchen-ingredient-name-en-input');

        // Somebody else saves the same row. The editor is now holding a version the server has
        // already superseded — which is exactly the state `If-Match` exists to detect.
        stored = {
            ...stored,
            notes: 'Changed by the other tab.',
            meta: { ...stored.meta, lockVersion: 2 },
        };

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-name-en-input'),
                'My version',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-save'));
        });

        await untilVisible('kitchen-ingredient-editor-screen-conflict-dialog');

        // The record was not overwritten: one attempt, refused, and the other tab's write stands.
        expect(repositories.kitchenAdmin.updateIngredient).toHaveBeenCalledTimes(1);
        expect(stored.name.en).toBe('Conflict me');
        expect(stored.notes).toBe('Changed by the other tab.');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-conflict-reload'));
        });

        await waitFor(() => {
            expect(
                screen.queryByTestId('kitchen-ingredient-editor-screen-conflict-dialog-title'),
            ).toBeNull();
        });
        // Reloading takes the other version, local edits and all.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-name-en-input').props.value).toBe(
                'Conflict me',
            );
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The allergen reference
 * ---------------------------------------------------------------------------------------------- */

describe('the allergen class reference', () => {
    it('lists the fourteen classes and offers no way to change one', async () => {
        await renderStubScreen(<AllergenClassesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: { listAllergenClasses: async () => ALLERGEN_CLASSES },
            },
        });

        await untilVisible('kitchen-allergen-classes-list');

        expect(ALLERGEN_CLASSES).toHaveLength(14);
        expect(screen.getByTestId('kitchen-allergen-classes-count')).toHaveTextContent(/14/);
        expect(screen.getByTestId('kitchen-allergen-classes-governance')).toBeTruthy();

        for (const entry of ALLERGEN_CLASSES) {
            expect(screen.getByTestId(`kitchen-allergen-class-${String(entry.code)}`)).toBeTruthy();
        }

        // Sulphites carry a stated threshold; most classes carry none, and that is printed.
        const sulphites = ALLERGEN_CLASSES.find((entry) => entry.declarationThreshold !== null);
        expect(sulphites).toBeDefined();
        expect(
            screen.getByTestId(`kitchen-allergen-class-${String(sulphites?.code)}-threshold`),
        ).toHaveTextContent(new RegExp(String(sulphites?.declarationThreshold?.value)));
    });
});
