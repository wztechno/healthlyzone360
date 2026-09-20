import type {
    AdminEntityMeta,
    ProductionOrderDetail,
    RecipeAdmin,
    RecipeAdminSummary,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import { KitchenId, RecipeId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { kitchenManagerSession, testActiveContext } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { PRODUCTION_MANAGE_PERMISSION } from './entity-registry.ts';
import { ProductionBatchNewScreen } from './screens/production-batch-new-screen.tsx';

/**
 * Planning a batch: a recipe is chosen by name and the screen finds the version.
 *
 * The three things that can go wrong here, and why each is worth a test of its own:
 *
 * 1. **The published version is not the current one.** Editing a published recipe opens a new
 *    draft, so the recipes a kitchen edits most are exactly the ones whose `currentVersion` is a
 *    draft. A screen that read `currentVersion.id` would plan batches against drafts on those and
 *    only those — which no assertion about a freshly published recipe can catch.
 * 2. **A recipe with nothing published must refuse, by name.** The endpoint would take the draft;
 *    the refusal has to happen here, and it has to say which recipe and what to do about it.
 * 3. **The unit is the output's, not the version's yield unit.** They differ, the server stamps the
 *    former, and a box labelled with the wrong one is worse than an unlabelled box.
 */

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/production-desk/new',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: ReactNode }) => children,
}));

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const RECIPE_ID = RecipeId.unsafe('01935f6d-0000-7000-8000-0000000b0011');
const PUBLISHED_VERSION = '01935f6d-0000-7000-8000-0000000e0011' as RecipeVersionId;
const DRAFT_VERSION = '01935f6d-0000-7000-8000-0000000e0012' as RecipeVersionId;
const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c011');

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'published',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function version(overrides: Partial<RecipeVersionAdmin> = {}): RecipeVersionAdmin {
    return {
        id: PUBLISHED_VERSION,
        recipeId: RECIPE_ID,
        versionNumber: 1,
        status: 'published',
        // Deliberately different from the output's unit below: the yield unit is the field the old
        // hint named, and reading it here would put "kg" on a box the server counts in litres.
        yieldQuantity: 4,
        yieldUnit: 'kg',
        yieldPieces: null,
        wastePercent: 3,
        b2bPrice: null,
        b2cPrice: null,
        lines: [],
        packaging: [],
        outputs: [
            {
                ingredientId: '01935f6d-0000-7000-8000-0000000a0011' as never,
                ingredientName: { en: 'Caesar dressing', ar: 'صلصة سيزر' },
                quantity: 20,
                unit: 'l',
                isPrimary: true,
            },
        ],
        steps: [],
        allergens: [],
        estimatedCost: null,
        derivationStale: false,
        publishedAt: '2026-08-01T09:00:00.000Z',
        ...overrides,
    };
}

function recipe(overrides: Partial<RecipeAdmin> = {}): RecipeAdmin {
    const current = overrides.currentVersion ?? version();
    return {
        id: RECIPE_ID,
        meta: meta({ status: current.status }),
        name: { en: 'Caesar dressing', ar: 'صلصة سيزر' },
        slug: 'caesar-dressing',
        reference: 'RC-0001',
        kitchenId: KITCHEN_ID,
        sourceKind: null,
        recipeCategory: null,
        currentVersionNumber: current.versionNumber,
        versionCount: 1,
        currentVersionStatus: current.status,
        allergenCodes: [],
        description: { en: 'A dressing.', ar: 'صلصة.' },
        currentVersion: current,
        versions: [
            {
                id: current.id,
                versionNumber: current.versionNumber,
                status: current.status,
                publishedAt: current.publishedAt,
                updatedAt: '2026-08-01T09:00:00.000Z',
                isCurrent: true,
            },
        ],
        ...overrides,
    };
}

/** A recipe edited since publishing: a draft is current, and version 1 is still the sellable one. */
function editedSincePublishing(): RecipeAdmin {
    const draft = version({
        id: DRAFT_VERSION,
        versionNumber: 2,
        status: 'draft',
        publishedAt: null,
    });

    return recipe({
        currentVersion: draft,
        versionCount: 2,
        versions: [
            {
                id: DRAFT_VERSION,
                versionNumber: 2,
                status: 'draft',
                publishedAt: null,
                updatedAt: '2026-08-02T09:00:00.000Z',
                isCurrent: true,
            },
            {
                id: PUBLISHED_VERSION,
                versionNumber: 1,
                status: 'published',
                publishedAt: '2026-08-01T09:00:00.000Z',
                updatedAt: '2026-08-01T09:00:00.000Z',
                isCurrent: false,
            },
        ],
    });
}

/** Never published at all: one draft, and nothing to produce against. */
function neverPublished(): RecipeAdmin {
    const draft = version({ versionNumber: 1, status: 'draft', publishedAt: null });
    return recipe({
        currentVersion: draft,
        versions: [
            {
                id: draft.id,
                versionNumber: 1,
                status: 'draft',
                publishedAt: null,
                updatedAt: '2026-08-01T09:00:00.000Z',
                isCurrent: true,
            },
        ],
    });
}

function summaryOf(record: RecipeAdmin): RecipeAdminSummary {
    const {
        description: _description,
        currentVersion: _currentVersion,
        versions: _versions,
        ...summary
    } = record;
    return summary;
}

function repositoriesFor(record: RecipeAdmin) {
    return {
        kitchenAdmin: {
            listRecipes: async () => page([summaryOf(record)]),
            getRecipe: async () => record,
        },
        kitchenOps: {
            createProductionOrder: async () =>
                ({ order: { id: 'order-1' } }) as unknown as ProductionOrderDetail,
        },
    };
}

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

/**
 * Open the picker, choose the one recipe the world holds, and wait for the version to resolve.
 *
 * The wait is part of the gesture rather than an artefact of the harness: the version is fetched
 * rather than typed, so there is a real moment when the form looks complete and has nothing to
 * send. The screen disables the button through it; a test that pressed straight through would be
 * asserting against a state a person cannot reach.
 */
async function pickTheRecipe() {
    await untilVisible('kitchen-production-batch-new-recipe-trigger');
    await act(async () => {
        fireEvent.press(screen.getByTestId('kitchen-production-batch-new-recipe-trigger'));
    });
    await untilVisible(`kitchen-production-batch-new-recipe-option-${String(RECIPE_ID)}`);
    await act(async () => {
        fireEvent.press(
            screen.getByTestId(`kitchen-production-batch-new-recipe-option-${String(RECIPE_ID)}`),
        );
    });

    await waitFor(() => {
        expect(screen.getByTestId('kitchen-production-batch-new-submit')).not.toBeDisabled();
    });
}

/* ------------------------------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------------------------------- */

describe('planning a batch', () => {
    it('offers recipes by name rather than asking for an identifier', async () => {
        await renderStubScreen(<ProductionBatchNewScreen />, {
            session: kitchenManagerSession(),
            repositories: repositoriesFor(recipe()),
        });

        await untilVisible('kitchen-production-batch-new-recipe-trigger');

        // The field it replaces is gone, not merely hidden: a screen offering both would still be
        // asking somebody to fetch a uuid.
        expect(screen.queryByTestId('kitchen-production-batch-new-version')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-production-batch-new-recipe-trigger'));
        });
        await untilVisible(`kitchen-production-batch-new-recipe-option-${String(RECIPE_ID)}`);

        expect(
            screen.getByTestId(`kitchen-production-batch-new-recipe-option-${String(RECIPE_ID)}`),
        ).toBeTruthy();
    });

    it('plans against the published version of a recipe that has since been edited', async () => {
        const { repositories } = await renderStubScreen(<ProductionBatchNewScreen />, {
            session: kitchenManagerSession(),
            repositories: repositoriesFor(editedSincePublishing()),
        });

        await pickTheRecipe();
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-production-batch-new-amount-input'),
                '40',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-production-batch-new-submit'));
        });

        // Version 1, not the draft that is current. This is the whole reason the screen reads
        // `versions` rather than `currentVersion`.
        await waitFor(() => {
            expect(repositories.kitchenOps.createProductionOrder).toHaveBeenCalledWith(
                expect.objectContaining({ recipeVersionId: PUBLISHED_VERSION, plannedYield: 40 }),
            );
        });
    });

    it('counts the planned yield in the output unit, not the version yield unit', async () => {
        await renderStubScreen(<ProductionBatchNewScreen />, {
            session: kitchenManagerSession(),
            repositories: repositoriesFor(recipe()),
        });

        await pickTheRecipe();

        // The fixture yields 4 kg and outputs 20 l. The server stamps the output's unit, so litres
        // is the only right answer and kilograms is the trap.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-new-amount')).toHaveTextContent(
                /L/,
            );
        });
        expect(screen.getByTestId('kitchen-production-batch-new-amount')).not.toHaveTextContent(
            /Kg/,
        );
    });

    it('refuses a recipe with nothing published, and names it', async () => {
        const { repositories } = await renderStubScreen(<ProductionBatchNewScreen />, {
            session: kitchenManagerSession(),
            repositories: repositoriesFor(neverPublished()),
        });

        await pickTheRecipe();
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-production-batch-new-amount-input'),
                '40',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-production-batch-new-submit'));
        });

        // Named, because "no published version" sends somebody to the picker when what they need is
        // the publish button on this particular recipe.
        await waitFor(() => {
            expect(screen.getByText(/Caesar dressing has no published version/)).toBeTruthy();
        });
        expect(repositories.kitchenOps.createProductionOrder).not.toHaveBeenCalled();
    });

    it('refuses a planner who may run production but not read the recipe book', async () => {
        // The picker is the only way in now, so a reader who cannot list recipes cannot use the
        // screen at all. It says so rather than rendering an empty dropdown.
        await renderStubScreen(<ProductionBatchNewScreen />, {
            session: kitchenManagerSession({
                activeContext: testActiveContext({ permissions: [PRODUCTION_MANAGE_PERMISSION] }),
            }),
            repositories: repositoriesFor(recipe()),
        });

        await untilVisible('kitchen-production-batch-new-forbidden');
    });
});
