import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { apiFailure, throwFailure } from '@healthy360/api-client/contracts';
import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import type { AccessState } from '@healthy360/permissions';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { displayName, isTranslationIncomplete, statusTone, unitDimension } from './format.ts';
import { ENTITY_FAMILIES, WORKSPACE_PERMISSIONS, permittedFamilies } from './entity-registry.ts';
import { AllergenClassesScreen } from './screens/allergen-classes-screen.tsx';
import { IngredientEditScreen } from './screens/ingredient-edit-screen.tsx';
import { IngredientsScreen } from './screens/ingredients-screen.tsx';
import { KitchenHomeScreen } from './screens/kitchen-home-screen.tsx';

/**
 * The kitchen workspace, against the real mock repositories.
 *
 * Nothing here stubs a hook. Four things this file exists to prove, in rough order of how badly it
 * would matter if they were wrong:
 *
 * 1. **The permission boundary is real on both sides.** The kitchen manager sees the workspace; a
 *    clinic owner with an organisation, a branch and no catalogue permission gets the forbidden page
 *    rather than an empty grid. A test that only checked the positive half would pass just as
 *    happily if the gate had been left off.
 * 2. **A write really writes.** Creating, renaming, archiving and re-mapping all go through the
 *    contract into the mutable store, and the assertions read the store back rather than trusting
 *    the screen's own optimism.
 * 3. **The two safety mechanisms fire.** A stale `lockVersion` produces the conflict dialog rather
 *    than a silent overwrite, and weakening a platform baseline allergen determination is refused
 *    per row before anything is sent.
 * 4. **Both languages are editable in their own direction.** The bilingual field pins each input's
 *    `writingDirection` to the language it holds, in either interface direction — which is the
 *    whole reason it exists.
 */

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;
const CLINIC_OWNER = MOCK_SCENARIOS['single-org-owner'].primaryEmail;

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
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

interface Harness {
    readonly repositories: MockRepositories;
}

/**
 * Signs in and applies an organisation context before rendering.
 *
 * The kitchen area requires an organisation *and* a branch (`ROUTE_REQUIREMENTS.kitchen`), so a
 * screen rendered without one would answer with the picker redirect rather than with itself. The
 * mock server applies the only branch automatically when a membership has exactly one, which is the
 * same behaviour the branch picker relies on.
 */
async function renderKitchen(
    node: ReactNode,
    options: {
        readonly email?: string;
        readonly organisationSlug?: string;
        readonly latencyMs?: number;
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

/**
 * Fixture facts come from a throwaway bundle rather than by rendering a tree and scraping it:
 * rendering a second tree inside a test leaves `screen` pointing at one the test then unmounts.
 */
const scratch = createMockRepositories({ scenario: 'multi-org-dietitian', latencyMs: 0 });

let seededIngredients: readonly IngredientAdmin[];
/** A seeded platform-library row that already carries an allergen determination. */
let mappedIngredient: IngredientAdmin;
/** A seeded row with no allergens at all, so an added mapping is unambiguous. */
let unmappedIngredient: IngredientAdmin;

beforeAll(async () => {
    const page = await scratch.kitchenAdmin.listIngredients({ limit: 100 });
    seededIngredients = page.items;

    const mapped = page.items.find((row) => row.allergens.length > 0);
    const unmapped = page.items.find((row) => row.allergens.length === 0);
    if (mapped === undefined || unmapped === undefined) {
        throw new Error('The seeded library carries neither a mapped nor an unmapped ingredient.');
    }
    mappedIngredient = mapped;
    unmappedIngredient = unmapped;
});

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
});

/* ------------------------------------------------------------------------------------------------
 * The hub
 * ---------------------------------------------------------------------------------------------- */

describe('the kitchen hub', () => {
    it('shows the families the kitchen manager may open, with real counts', async () => {
        await renderKitchen(<KitchenHomeScreen />);

        await untilVisible('kitchen-home-screen');

        expect(screen.getByTestId('kitchen-family-ingredients')).toBeTruthy();
        expect(screen.getByTestId('kitchen-family-allergen-classes')).toBeTruthy();

        await untilVisible('kitchen-family-ingredients-total');
        // The badge counts the library the repository actually answers with.
        expect(screen.getByTestId('kitchen-family-ingredients-total')).toHaveTextContent(
            new RegExp(String(seededIngredients.length)),
        );
        // A reference family says it is reference rather than inventing a draft count.
        expect(screen.getByTestId('kitchen-family-allergen-classes-reference')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-family-allergen-classes-drafts')).toBeNull();
    });

    it('refuses a signed-in person whose role carries no catalogue permission', async () => {
        await renderKitchen(<KitchenHomeScreen />, {
            email: CLINIC_OWNER,
            organisationSlug: 'cedar-clinic',
        });

        await untilVisible('kitchen-home-forbidden');
        expect(screen.queryByTestId('kitchen-home-grid')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

describe('the ingredient list', () => {
    it('renders skeletons, then the seeded rows with their allergens and status', async () => {
        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a mock that resolves on a microtask.
        await renderKitchen(<IngredientsScreen />, { latencyMs: 40 });

        await untilVisible('kitchen-ingredients-loading');
        await untilVisible('kitchen-ingredients-table');

        const row = mappedIngredient;
        expect(screen.getByTestId(`kitchen-ingredient-${row.id}-name`)).toBeTruthy();
        expect(screen.getByTestId(`kitchen-ingredient-${row.id}-allergens`)).toBeTruthy();
        expect(screen.getByTestId(`kitchen-ingredient-${row.id}-status`)).toHaveTextContent(
            /Published/,
        );
        expect(
            screen.getByTestId(`kitchen-ingredient-${unmappedIngredient.id}-allergens-none`),
        ).toBeTruthy();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderKitchen(<IngredientsScreen />);
        await untilVisible('kitchen-ingredients-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredients-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-ingredients-empty');
        // The *unfiltered* empty state is unreachable in this world — the seed always carries the
        // library — so the copy is asserted through the filtered branch, which is the one a person
        // actually reaches.
        expect(screen.getByTestId('kitchen-ingredients-clear')).toBeTruthy();
    });

    it('renders the error state when the listing fails', async () => {
        const tokenStore = createMemoryTokenStore();
        const repositories = createMockRepositories({
            scenario: 'multi-org-dietitian',
            latencyMs: 1,
            tokenStore,
        });
        await repositories.auth.login({ email: KITCHEN_MANAGER, password: 'password' });
        const me = await repositories.session.me();
        const membership = me.memberships.find(
            (candidate) =>
                candidate.organisation.slug === 'verdant-kitchen' && candidate.status === 'active',
        );
        await repositories.context.setContext({ organisationId: membership!.organisation.id });

        // The real bundle with one method replaced: the mock world has no way to *make* a listing
        // fail, and a screen that never renders `ErrorState` is a screen whose error path is a
        // guess. Everything else on this bundle stays the real repository.
        const failing = repositories.kitchenAdmin as unknown as {
            listIngredients: () => Promise<never>;
        };
        failing.listIngredients = () =>
            Promise.reject(throwFailure(apiFailure('server', { message: 'Boom.' })));

        await render(
            <AppProviders
                initialMetrics={TEST_METRICS}
                repositories={repositories}
                tokenStore={tokenStore}
                queryClient={createTestQueryClient()}
                initialOnline
            >
                <IngredientsScreen />
            </AppProviders>,
        );

        await untilVisible('kitchen-ingredients-error');
    });

    it('archives a row behind a confirmation, and the store agrees', async () => {
        const { repositories } = await renderKitchen(<IngredientsScreen />);
        await untilVisible('kitchen-ingredients-table');

        const target = unmappedIngredient;
        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-ingredient-${target.id}-archive`));
        });

        await untilVisible('kitchen-ingredients-archive-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredients-archive-confirm'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getIngredient(target.id);
            expect(after.meta.status).toBe('retired');
        });

        // The list refreshes rather than keeping the row at its old status.
        await waitFor(() => {
            expect(screen.getByTestId(`kitchen-ingredient-${target.id}-status`)).toHaveTextContent(
                /Archived/,
            );
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The editor
 * ---------------------------------------------------------------------------------------------- */

describe('the ingredient editor', () => {
    it('writes each language in its own direction, whatever the interface does', async () => {
        await renderKitchen(<IngredientEditScreen ingredient="new" />);

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
        const { repositories } = await renderKitchen(<IngredientEditScreen ingredient="new" />);

        await untilVisible('kitchen-ingredient-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-name-en-input'),
                'Toasted burghul',
            );
        });

        // The category is required, and the Select is the only way to answer it.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-category-trigger'));
        });
        await untilVisible('kitchen-ingredient-category-list');
        const category = seededIngredients[0]!.categoryCode;
        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-ingredient-category-option-${category}`));
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-save'));
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalled();
        });

        const page = await repositories.kitchenAdmin.listIngredients({
            limit: 100,
            query: 'Toasted burghul',
        });
        expect(page.items).toHaveLength(1);
        // Created as a draft: a catalogue that published a row the moment it was typed would be the
        // opposite of the publication safety this phase exists to build.
        expect(page.items[0]!.meta.status).toBe('draft');
    });

    it('saves a rename and rebases onto the version the write produced', async () => {
        const target = unmappedIngredient;
        const { repositories } = await renderKitchen(
            <IngredientEditScreen ingredient={String(target.id)} />,
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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getIngredient(target.id);
            expect(after.name.ar).toBe('اسم عربي جديد');
            expect(after.meta.lockVersion).toBe(target.meta.lockVersion + 1);
        });

        // Saved is clean: the unsaved badge goes, so navigating away asks nothing.
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-ingredient-editor-screen-dirty')).toBeNull();
        });
    });

    it('asks before discarding unsaved changes, and leaves when told to', async () => {
        await renderKitchen(<IngredientEditScreen ingredient={String(unmappedIngredient.id)} />);

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
        const target = unmappedIngredient;
        const { repositories } = await renderKitchen(
            <IngredientEditScreen ingredient={String(target.id)} />,
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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getIngredient(target.id);
            expect(after.aliases).toContain('Chuck');
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Allergen mapping
 * ---------------------------------------------------------------------------------------------- */

describe('the allergen mapping editor', () => {
    it('marks a platform baseline row and refuses to weaken it', async () => {
        await renderKitchen(<IngredientEditScreen ingredient={String(mappedIngredient.id)} />);

        const baselineKey = `kitchen-ingredient-mapping-baseline-${String(
            mappedIngredient.allergens[0]!.allergenCode,
        )}`;

        await waitFor(() => {
            expect(screen.getByTestId(baselineKey)).toBeTruthy();
        });
        expect(screen.getByTestId(`${baselineKey}-baseline`)).toBeTruthy();

        // The seeded determination is `contains`; asking for `may_contain` is a downgrade.
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
        const target = unmappedIngredient;
        const { repositories } = await renderKitchen(
            <IngredientEditScreen ingredient={String(target.id)} />,
        );

        await untilVisible('kitchen-ingredient-allergen-empty');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-mapping-add'));
        });

        const rowId = 'kitchen-ingredient-mapping-overlay-1';
        await waitFor(() => {
            expect(screen.getByTestId(rowId)).toBeTruthy();
        });

        const classes = await repositories.kitchenAdmin.listAllergenClasses();
        const chosen = classes[0]!;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${rowId}-class-trigger`));
        });
        await waitFor(() => {
            expect(screen.getByTestId(`${rowId}-class-list`)).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${rowId}-class-option-${String(chosen.code)}`));
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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getIngredient(target.id);
            expect(after.allergens).toHaveLength(1);
            expect(after.allergens[0]!.allergenCode).toBe(chosen.code);
            expect(after.allergens[0]!.sourceNote).toBe('Supplier sheet 4.');
        });
    });

    it('renders the quarantine when dropping a determination a published recipe relies on', async () => {
        // The store quarantines an ingredient whose dropped allergen a *published* recipe derives
        // from it — the burghul/pita contradiction the master plan calls out. Find such a row
        // rather than assuming one, so the assertion still means something if the seed changes.
        const recipes = await scratch.kitchenAdmin.listRecipes({ limit: 100 });
        let victim: IngredientAdmin | null = null;
        for (const summary of recipes.items) {
            const recipe = await scratch.kitchenAdmin.getRecipe(summary.id);
            if (recipe.currentVersion.status !== 'published') continue;
            const declaration = recipe.currentVersion.allergens.find(
                (entry) => entry.sourceIngredientIds.length > 0,
            );
            if (declaration === undefined) continue;
            const ingredientId = declaration.sourceIngredientIds[0]!;
            victim = await scratch.kitchenAdmin.getIngredient(ingredientId);
            break;
        }
        if (victim === null) {
            throw new Error('No published recipe derives an allergen from an ingredient.');
        }

        await renderKitchen(<IngredientEditScreen ingredient={String(victim.id)} />);

        const rowId = `kitchen-ingredient-mapping-baseline-${String(
            victim.allergens[0]!.allergenCode,
        )}`;
        await waitFor(() => {
            expect(screen.getByTestId(rowId)).toBeTruthy();
        });

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
        const target = unmappedIngredient;
        const { repositories } = await renderKitchen(
            <IngredientEditScreen ingredient={String(target.id)} />,
        );

        await untilVisible('kitchen-ingredient-name-en-input');

        // Somebody else saves the same row. The editor is now holding a version the server has
        // already superseded — which is exactly the state `If-Match` exists to detect.
        repositories.prototypeStore.kitchenCatalogue.updateIngredient(target.id, {
            lockVersion: target.meta.lockVersion,
            notes: 'Changed by the other tab.',
        });

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-name-en-input'),
                'My version',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ingredient-editor-screen-save'));
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-ingredient-editor-screen-conflict-dialog'),
            ).toBeTruthy();
        });
        // The record was not overwritten.
        const untouched = await repositories.kitchenAdmin.getIngredient(target.id);
        expect(untouched.name.en).toBe(target.name.en);
        expect(untouched.notes).toBe('Changed by the other tab.');

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
                target.name.en,
            );
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The allergen reference
 * ---------------------------------------------------------------------------------------------- */

describe('the allergen class reference', () => {
    it('lists the fourteen classes and offers no way to change one', async () => {
        await renderKitchen(<AllergenClassesScreen />);

        await untilVisible('kitchen-allergen-classes-list');

        const classes = await scratch.kitchenAdmin.listAllergenClasses();
        expect(classes).toHaveLength(14);
        expect(screen.getByTestId('kitchen-allergen-classes-count')).toHaveTextContent(/14/);
        expect(screen.getByTestId('kitchen-allergen-classes-governance')).toBeTruthy();

        for (const entry of classes) {
            expect(screen.getByTestId(`kitchen-allergen-class-${String(entry.code)}`)).toBeTruthy();
        }

        // Sulphites carry a stated threshold; most classes carry none, and that is printed.
        const sulphites = classes.find((entry) => entry.declarationThreshold !== null);
        if (sulphites !== undefined) {
            expect(
                screen.getByTestId(`kitchen-allergen-class-${String(sulphites.code)}-threshold`),
            ).toHaveTextContent(new RegExp(String(sulphites.declarationThreshold!.value)));
        }
    });
});
