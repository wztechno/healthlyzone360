import type {
    DishOptionDraft,
    KitchenDishOption,
    RecipeAdminSummary,
} from '@healthy360/api-client/contracts';
import { RecipeId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { DishOptionsSection } from './dish-options-section.tsx';

/*
 * Owner, 3 Nov 2026: a sauce or side choice links the recipe it is and takes its allergens from it.
 * The editor picks the recipe, shows the saved recipe's allergens as badges, and will not save a
 * choice with no recipe.
 */

const AIOLI_RECIPE = RecipeId.unsafe('recipe-aioli');

const AIOLI = {
    id: AIOLI_RECIPE,
    name: { en: 'Aioli', ar: 'أيولي' },
    slug: 'aioli',
} as RecipeAdminSummary;

function choice(overrides: Partial<KitchenDishOption> = {}): KitchenDishOption {
    return {
        id: 'option-1',
        kind: 'choice',
        groupEn: 'Sauce',
        groupAr: 'صلصة',
        nameEn: 'Aioli',
        nameAr: 'أيولي',
        recipeId: null,
        allergenCodes: null,
        ...overrides,
    };
}

async function render(options: readonly KitchenDishOption[], replace = jest.fn()) {
    await renderStubScreen(<DishOptionsSection itemId="item-1" canManage />, {
        session: kitchenManagerSession(),
        repositories: {
            orderDesk: {
                listDishOptions: async () => options,
                replaceDishOptions: replace,
            },
            kitchenAdmin: { listRecipes: async () => page([AIOLI]) },
        },
    });
}

describe('the dish options editor', () => {
    it('shows a linked choice’s recipe allergens as badges', async () => {
        await render([choice({ recipeId: AIOLI_RECIPE, allergenCodes: ['egg'] })]);

        expect(await screen.findByTestId('kitchen-dish-option-0-allergens-egg')).toBeTruthy();
    });

    it('says an unlinked choice is not offered, and saves it only once a recipe is picked', async () => {
        const replace = jest.fn(async (_itemId: string, rows: readonly DishOptionDraft[]) =>
            rows.map((row) => ({ ...choice(), ...row, id: row.id ?? 'option-1' })),
        );
        await render([choice()], replace);

        expect(await screen.findByTestId('kitchen-dish-option-0-allergens-unlinked')).toBeTruthy();

        fireEvent.press(screen.getByTestId('kitchen-dish-options-save'));
        expect(replace).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(await screen.findByTestId('kitchen-dish-option-0-recipe-trigger'));
        });
        await act(async () => {
            fireEvent.press(
                await screen.findByTestId(`kitchen-dish-option-0-recipe-option-${AIOLI_RECIPE}`),
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-dish-options-save'));
        });

        await waitFor(() => {
            expect(replace).toHaveBeenCalledWith('item-1', [
                expect.objectContaining({ id: 'option-1', recipeId: AIOLI_RECIPE }),
            ]);
        });
    });

    it('says when a linked recipe has no published version', async () => {
        await render([choice({ recipeId: AIOLI_RECIPE, allergenCodes: null })]);

        expect(
            await screen.findByTestId('kitchen-dish-option-0-allergens-unpublished'),
        ).toBeTruthy();
    });
});
