import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { apiFailure, throwFailure } from '@healthy360/api-client/contracts';
import type {
    IngredientAdmin,
    RecipeAdmin,
    RecipeRollupDraft,
    RecipeRollupPreview,
} from '@healthy360/api-client/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { recipeRollupHash } from '../../data/kitchen-admin-hooks.ts';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { costPerServing, moveInList, parseQuantity, unitsInDimension } from './format.ts';
import { RecipeEditScreen } from './screens/recipe-edit-screen.tsx';
import { RecipesScreen } from './screens/recipes-screen.tsx';

/**
 * The recipe half of the kitchen workspace, against the real mock repositories (K1.2).
 *
 * Nothing here stubs a hook. Five things this file exists to prove:
 *
 * 1. **A version is a real thing.** A published version is read-only, opening a draft from it copies
 *    the lines rather than clearing them, and the store agrees about which one is current.
 * 2. **The line editor keeps its promises.** Stable keys across a move, an undo that restores a row
 *    to *its own position*, a live-region announcement that names where the row landed, and no
 *    silent de-duplication of an ingredient that legitimately appears twice.
 * 3. **The roll-up preview never lies while it is thinking.** A structural edit refreshes at once, a
 *    quantity being typed waits, and in both cases the previous allergen list stays on screen —
 *    dimmed and `aria-busy` — rather than blanking to "no allergens".
 * 4. **Publication is a gate, not a button.** The happy path flips the consumer projection; a
 *    quarantined recipe cannot be published however hard the button is pressed; and ingredients
 *    carrying no allergen determination are named, with a route to fix each one.
 * 5. **The two safety mechanisms fire here too.** A stale lock version produces the conflict dialog,
 *    and leaving with unsaved lines asks first.
 */

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;
const CLINIC_OWNER = MOCK_SCENARIOS['single-org-owner'].primaryEmail;

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
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

interface Harness {
    readonly repositories: MockRepositories;
}

/**
 * Signs in, applies the organisation context, lets a test arrange the world, then renders.
 *
 * `prepare` runs against the *same* store the screen will read, before the first request — which is
 * how a test starts from a state the UI cannot reach in one step (an already-open draft version, a
 * quarantined recipe, a wrapped repository method).
 */
async function renderKitchen(
    node: ReactNode | ((repositories: MockRepositories) => ReactNode),
    options: {
        readonly email?: string;
        readonly organisationSlug?: string;
        readonly latencyMs?: number;
        readonly prepare?: (repositories: MockRepositories) => void;
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

    options.prepare?.(repositories);

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {typeof node === 'function' ? node(repositories) : node}
        </AppProviders>,
    );

    return { repositories };
}

/** Waits for an element, with the same contention headroom the ingredient suite documents. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

const scratch = createMockRepositories({ scenario: 'multi-org-dietitian', latencyMs: 0 });

/** A seeded, published recipe that carries lines and a derived allergen label. */
let publishedRecipe: RecipeAdmin;
/** An allergen code the recipe's *own lines* prove, so the roll-up preview derives it too. */
let labelCode: string;
/** The ingredient behind that code — dropping its mapping is the quarantine trigger. */
let labelSourceId: IngredientAdmin['id'];
/** A seeded ingredient with no allergen determination at all. */
let unmappedIngredient: IngredientAdmin;
/** A seeded ingredient that does carry one, so a swap is unambiguous. */
let mappedIngredient: IngredientAdmin;

beforeAll(async () => {
    /*
     * The recipe under test has to satisfy one condition beyond "published with a label": the
     * declaration on its version must also be carried by the *ingredient's own* mapping set. The
     * fixture world derives the two from different sources — a recipe's allergens come from its
     * technical sheet, an ingredient's from the allergen fixture — so the intersection is what makes
     * the roll-up preview, the provenance chip and the quarantine path all speak about one code.
     */
    const page = await scratch.kitchenAdmin.listRecipes({ limit: 100 });
    outer: for (const summary of page.items) {
        const recipe = await scratch.kitchenAdmin.getRecipe(summary.id);
        if (recipe.currentVersion.status !== 'published') continue;
        if (recipe.currentVersion.lines.length === 0) continue;

        for (const declaration of recipe.currentVersion.allergens) {
            for (const ingredientId of declaration.sourceIngredientIds) {
                const ingredient = await scratch.kitchenAdmin.getIngredient(ingredientId);
                const carries = ingredient.allergens.some(
                    (mapping) => mapping.allergenCode === declaration.allergenCode,
                );
                if (!carries) continue;
                publishedRecipe = recipe;
                labelCode = String(declaration.allergenCode);
                labelSourceId = ingredientId;
                break outer;
            }
        }
    }
    if (publishedRecipe === undefined) {
        throw new Error('The seed carries no published recipe whose label its own lines prove.');
    }

    const library = await scratch.kitchenAdmin.listIngredients({ limit: 100 });
    const unmapped = library.items.find((row) => row.allergens.length === 0);
    const mapped = library.items.find((row) => row.allergens.length > 0);
    if (unmapped === undefined || mapped === undefined) {
        throw new Error('The seeded library carries neither a mapped nor an unmapped ingredient.');
    }
    unmappedIngredient = unmapped;
    mappedIngredient = mapped;
});

/** Opens the successor draft on the recipe under test, exactly as the contract does it. */
function openDraft(repositories: MockRepositories): void {
    const store = repositories.prototypeStore.kitchenCatalogue;
    const current = store.getRecipe(publishedRecipe.id);
    store.updateRecipe(publishedRecipe.id, { lockVersion: current.meta.lockVersion });
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
        expect(costPerServing({ amount: 12, currency: 'AED' }, 4)).toEqual({
            amount: 3,
            currency: 'AED',
        });
        expect(costPerServing({ amount: 12, currency: 'AED' }, 0)).toBeNull();
        expect(costPerServing(null, 4)).toBeNull();
    });

    it('fingerprints a draft by its line order, so a reorder is acknowledged', () => {
        const lines = [
            { ingredientId: mappedIngredient.id, quantity: 100, unit: 'g' as const },
            { ingredientId: unmappedIngredient.id, quantity: 50, unit: 'g' as const },
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
    it('renders skeletons, then the seeded rows with their version and derived label', async () => {
        await renderKitchen(<RecipesScreen />, { latencyMs: 40 });

        await untilVisible('kitchen-recipes-loading');
        await untilVisible('kitchen-recipes-table');

        const base = `kitchen-recipe-${String(publishedRecipe.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-version`)).toHaveTextContent(
            new RegExp(String(publishedRecipe.currentVersionNumber)),
        );
        // The version's own state is not on the summary; it is read per row and rendered when it
        // arrives rather than guessed from the recipe's status.
        await waitFor(() => {
            expect(screen.getByTestId(`${base}-version-status`)).toHaveTextContent(/Published/);
        });
        await untilVisible(`${base}-allergens`);
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderKitchen(<RecipesScreen />);
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
        await renderKitchen(<RecipesScreen />, {
            prepare: (repositories) => {
                const failing = repositories.kitchenAdmin as unknown as {
                    listRecipes: () => Promise<never>;
                };
                failing.listRecipes = () =>
                    Promise.reject(throwFailure(apiFailure('server', { message: 'Boom.' })));
            },
        });

        await untilVisible('kitchen-recipes-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        await renderKitchen(<RecipesScreen />, {
            email: CLINIC_OWNER,
            organisationSlug: 'cedar-clinic',
        });

        await untilVisible('kitchen-recipes-forbidden');
        expect(screen.queryByTestId('kitchen-recipes-table')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Creating
 * ---------------------------------------------------------------------------------------------- */

describe('creating a recipe', () => {
    it('creates it as a draft at version one, and lands on its own address', async () => {
        const { repositories } = await renderKitchen(<RecipeEditScreen recipe="new" />);

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
            expect(routerMock.__replace).toHaveBeenCalled();
        });

        const page = await repositories.kitchenAdmin.listRecipes({
            limit: 100,
            query: 'Smoked labneh with zaatar',
        });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]!.meta.status).toBe('draft');
        expect(page.items[0]!.currentVersionNumber).toBe(1);
        expect(page.items[0]!.versionCount).toBe(1);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Versions
 * ---------------------------------------------------------------------------------------------- */

describe('versions', () => {
    it('renders a published version read-only and opens a draft that copies its lines', async () => {
        const { repositories } = await renderKitchen(
            <RecipeEditScreen recipe={String(publishedRecipe.id)} />,
        );

        await untilVisible('kitchen-recipe-versions');
        // Immutable: no way to add a line, and the one control offered is the successor draft.
        expect(screen.getByTestId('kitchen-recipe-immutable')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-lines-add')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-new-draft'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getRecipe(publishedRecipe.id);
            expect(after.currentVersion.status).toBe('draft');
            expect(after.currentVersion.versionNumber).toBe(
                publishedRecipe.currentVersion.versionNumber + 1,
            );
            // A copy, not a blank: the whole point of opening a draft *from* a version.
            expect(after.currentVersion.lines).toHaveLength(
                publishedRecipe.currentVersion.lines.length,
            );
        });

        // The editor rebases onto the new version and becomes editable.
        await untilVisible('kitchen-recipe-lines-add');
    });

    it('says plainly that an older version’s contents cannot be read', async () => {
        await renderKitchen(<RecipeEditScreen recipe={String(publishedRecipe.id)} />, {
            prepare: openDraft,
        });

        await untilVisible('kitchen-recipe-version-list');

        const olderVersionId = String(publishedRecipe.currentVersion.id);
        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-recipe-version-${olderVersionId}-select`));
        });

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
        const { repositories } = await renderKitchen(
            <RecipeEditScreen recipe={String(publishedRecipe.id)} />,
            { prepare: openDraft },
        );

        await untilVisible('kitchen-recipe-lines-add');

        const seededCount = publishedRecipe.currentVersion.lines.length;
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
                screen.getByTestId(`${added}-ingredient-option-${String(unmappedIngredient.id)}`),
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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getRecipe(publishedRecipe.id);
            expect(after.currentVersion.lines).toHaveLength(seededCount + 1);
            expect(after.currentVersion.lines[seededCount - 1]!.ingredientId).toBe(
                unmappedIngredient.id,
            );
            expect(after.currentVersion.lines[seededCount - 1]!.quantity).toBe(120);
        });
    });

    it('keeps two lines that name the same ingredient', async () => {
        const { repositories } = await renderKitchen(
            <RecipeEditScreen recipe={String(publishedRecipe.id)} />,
            { prepare: openDraft },
        );

        await untilVisible('kitchen-recipe-lines-add');
        const existing = publishedRecipe.currentVersion.lines[0]!;

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
                    screen.getByTestId(`${row}-ingredient-option-${String(existing.ingredientId)}`),
                );
            });
            await act(async () => {
                fireEvent.changeText(screen.getByTestId(`${row}-quantity-input`), '10');
            });
        }

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getRecipe(publishedRecipe.id);
            const sameIngredient = after.currentVersion.lines.filter(
                (line) => line.ingredientId === existing.ingredientId,
            );
            // The original plus the two just added: nothing was merged.
            expect(sameIngredient).toHaveLength(3);
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Outputs and steps
 * ---------------------------------------------------------------------------------------------- */

describe('the outputs editor', () => {
    it('refuses to save until exactly one output is the primary one', async () => {
        const { repositories } = await renderKitchen(
            <RecipeEditScreen recipe={String(publishedRecipe.id)} />,
            { prepare: openDraft },
        );

        await untilVisible('kitchen-recipe-outputs-add');

        for (const [key, ingredient] of [
            ['row-1', unmappedIngredient],
            ['row-2', mappedIngredient],
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
                fireEvent.press(
                    screen.getByTestId(`${row}-ingredient-option-${String(ingredient.id)}`),
                );
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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getRecipe(publishedRecipe.id);
            expect(after.currentVersion.outputs).toHaveLength(2);
            expect(after.currentVersion.outputs.filter((output) => output.isPrimary)).toHaveLength(
                1,
            );
            expect(
                after.currentVersion.outputs.find((output) => output.isPrimary)!.ingredientId,
            ).toBe(mappedIngredient.id);
        });
    });
});

describe('the method editor', () => {
    it('writes a step in both languages and orders by position', async () => {
        const { repositories } = await renderKitchen(
            <RecipeEditScreen recipe={String(publishedRecipe.id)} />,
            { prepare: openDraft },
        );

        await untilVisible('kitchen-recipe-steps-add');
        const seededSteps = publishedRecipe.currentVersion.steps.length;

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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getRecipe(publishedRecipe.id);
            const steps = after.currentVersion.steps;
            expect(steps).toHaveLength(seededSteps + 1);
            expect(steps[seededSteps]!.index).toBe(seededSteps + 1);
            expect(steps[seededSteps]!.instruction.ar).toBe('اتركه يرتاح عشر دقائق.');
            expect(steps[seededSteps]!.minutes).toBe(10);
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The roll-up preview
 * ---------------------------------------------------------------------------------------------- */

/** Records every preview request, and lets a test hold one open. */
function instrumentRollup(repositories: MockRepositories): {
    readonly calls: RecipeRollupDraft[];
    release: (() => void) | null;
    hold: boolean;
} {
    const state = {
        calls: [] as RecipeRollupDraft[],
        release: null as (() => void) | null,
        hold: false,
    };
    const admin = repositories.kitchenAdmin as unknown as {
        previewRecipeRollup: (draft: RecipeRollupDraft) => Promise<RecipeRollupPreview>;
    };
    const original = admin.previewRecipeRollup.bind(repositories.kitchenAdmin);

    admin.previewRecipeRollup = async (draft: RecipeRollupDraft) => {
        state.calls.push(draft);
        const answer = await original(draft);
        if (!state.hold) return answer;
        await new Promise<void>((resolve) => {
            state.release = resolve;
        });
        return answer;
    };
    return state;
}

describe('the roll-up preview', () => {
    it('waits out a quantity being typed and refreshes at once when the structure changes', async () => {
        let rollup: ReturnType<typeof instrumentRollup> | null = null;
        await renderKitchen(<RecipeEditScreen recipe={String(publishedRecipe.id)} />, {
            prepare: (repositories) => {
                openDraft(repositories);
                rollup = instrumentRollup(repositories);
            },
        });

        await untilVisible('kitchen-recipe-rollup-figures');
        const state = rollup!;
        const before = state.calls.length;
        expect(before).toBeGreaterThan(0);

        jest.useFakeTimers();

        // A quantity is a stream of intermediate values; nothing is requested for any of them.
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-recipe-lines-row-line-1-quantity-input'),
                '333',
            );
        });
        expect(state.calls.length).toBe(before);

        await act(async () => {
            jest.advanceTimersByTime(500);
        });
        expect(state.calls.length).toBe(before + 1);

        // A unit change is a completed decision and is not made to wait.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-row-line-1-unit-trigger'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-lines-row-line-1-unit-option-kg'));
        });
        expect(state.calls.length).toBe(before + 2);

        jest.useRealTimers();
    });

    it('keeps the previous allergen list on screen, dimmed, while the next one is fetched', async () => {
        let rollup: ReturnType<typeof instrumentRollup> | null = null;
        await renderKitchen(<RecipeEditScreen recipe={String(publishedRecipe.id)} />, {
            prepare: (repositories) => {
                openDraft(repositories);
                rollup = instrumentRollup(repositories);
            },
        });

        await untilVisible('kitchen-recipe-rollup-allergens');
        const figures = screen.getByTestId('kitchen-recipe-rollup-figures');
        expect(figures.props['aria-busy']).toBe(false);
        expect(screen.getByTestId(`kitchen-recipe-rollup-allergen-${labelCode}`)).toBeTruthy();

        // Hold the *next* answer open, then make a structural edit so one is requested at once.
        rollup!.hold = true;
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
        expect(screen.getByTestId(`kitchen-recipe-rollup-allergen-${labelCode}`)).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-rollup-allergens-none')).toBeNull();

        rollup!.hold = false;
        await act(async () => {
            rollup!.release?.();
        });
    });

    it('expands an allergen to the lines that put it there', async () => {
        await renderKitchen(<RecipeEditScreen recipe={String(publishedRecipe.id)} />, {
            prepare: openDraft,
        });

        await untilVisible('kitchen-recipe-rollup-allergens');
        const chip = `kitchen-recipe-rollup-allergen-${labelCode}`;

        expect(screen.queryByTestId(`${chip}-sources`)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${chip}-chip`));
        });

        await untilVisible(`${chip}-sources`);
        expect(screen.getByTestId(`${chip}-sources`)).toHaveTextContent(/from:/);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Publication
 * ---------------------------------------------------------------------------------------------- */

describe('publishing', () => {
    it('makes a new recipe visible to consumers, and not before', async () => {
        let recipeId: RecipeAdmin['id'] | null = null;

        const { repositories } = await renderKitchen((repos) => {
            // Arranged through the contract before the first render, so the editor opens on a
            // draft that already has a line — the state publication is actually about.
            const store = repos.prototypeStore.kitchenCatalogue;
            const created = store.createRecipe({
                name: { en: 'Smoked labneh', ar: 'لبنة مدخّنة' },
                description: { en: 'A spread.', ar: 'معجون.' },
                yieldQuantity: 4,
                yieldUnit: 'portion',
            });
            store.setRecipeLines(created.id, {
                lockVersion: created.meta.lockVersion,
                lines: [{ ingredientId: mappedIngredient.id, quantity: 200, unit: 'g' }],
            });
            recipeId = created.id;
            return <RecipeEditScreen recipe={String(created.id)} />;
        });

        const created = recipeId!;
        // A draft is invisible to every consumer read, which is the state publication changes.
        await expect(repositories.foods.getRecipe(created)).rejects.toBeDefined();

        await untilVisible('kitchen-recipe-publish');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish'));
        });

        await untilVisible('kitchen-recipe-publish-dialog');
        // The dialog states the label that is about to become public.
        expect(screen.getByTestId('kitchen-recipe-publish-consequence')).toBeTruthy();
        expect(screen.getByTestId('kitchen-recipe-publish-allergens')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish-confirm'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getRecipe(created);
            expect(after.meta.status).toBe('published');
            expect(after.currentVersion.status).toBe('published');
        });
        // The store flipped: the same world's consumer projection now answers for it.
        await expect(repositories.foods.getRecipe(created)).resolves.toBeDefined();
    });

    it('names the ingredients that carry no allergen determination', async () => {
        await renderKitchen(<RecipeEditScreen recipe={String(publishedRecipe.id)} />, {
            prepare: (repositories) => {
                const store = repositories.prototypeStore.kitchenCatalogue;
                const current = store.getRecipe(publishedRecipe.id);
                store.setRecipeLines(publishedRecipe.id, {
                    lockVersion: current.meta.lockVersion,
                    lines: [{ ingredientId: unmappedIngredient.id, quantity: 200, unit: 'g' }],
                });
            },
        });

        await untilVisible('kitchen-recipe-publish');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-publish'));
        });

        await untilVisible('kitchen-recipe-publish-allergen-unmapped');
        // Each offending ingredient is named and is a route to the record that fixes it.
        const link = screen.getByTestId(
            `kitchen-recipe-publish-unmapped-${String(unmappedIngredient.id)}`,
        );
        await act(async () => {
            fireEvent.press(link);
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith(
                `/kitchen/ingredients/${String(unmappedIngredient.id)}`,
            );
        });
    });

    it('refuses a quarantined recipe, however hard the button is pressed', async () => {
        await renderKitchen(<RecipeEditScreen recipe={String(publishedRecipe.id)} />, {
            prepare: (repositories) => {
                const store = repositories.prototypeStore.kitchenCatalogue;
                openDraft(repositories);

                // The burghul/pita contradiction: dropping a determination that this recipe's
                // published version derived from the ingredient quarantines both.
                const victim = store.getIngredient(labelSourceId);
                store.setIngredientAllergens(labelSourceId, {
                    lockVersion: victim.meta.lockVersion,
                    mappings: [],
                });
            },
        });

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
    });
});

/* ------------------------------------------------------------------------------------------------
 * Concurrency and the unsaved guard
 * ---------------------------------------------------------------------------------------------- */

describe('safety', () => {
    it('offers reload-or-keep when somebody else has moved the recipe on', async () => {
        const { repositories } = await renderKitchen(
            <RecipeEditScreen recipe={String(publishedRecipe.id)} />,
            { prepare: openDraft },
        );

        await untilVisible('kitchen-recipe-lines-add');
        const held = await repositories.kitchenAdmin.getRecipe(publishedRecipe.id);

        // Somebody else saves the same recipe. The editor is now holding a superseded version.
        repositories.prototypeStore.kitchenCatalogue.updateRecipe(publishedRecipe.id, {
            lockVersion: held.meta.lockVersion,
            description: { en: 'Changed by the other tab.', ar: 'غُيّر من التبويب الآخر.' },
        });

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-recipe-name-en-input'), 'My version');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-save'));
        });

        await untilVisible('kitchen-recipe-editor-screen-conflict-dialog');
        const untouched = await repositories.kitchenAdmin.getRecipe(publishedRecipe.id);
        expect(untouched.name.en).toBe(publishedRecipe.name.en);
        expect(untouched.description.en).toBe('Changed by the other tab.');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-recipe-editor-screen-conflict-reload'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-recipe-name-en-input').props.value).toBe(
                publishedRecipe.name.en,
            );
        });
    });

    it('asks before throwing away an unsaved line', async () => {
        await renderKitchen(<RecipeEditScreen recipe={String(publishedRecipe.id)} />, {
            prepare: openDraft,
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
