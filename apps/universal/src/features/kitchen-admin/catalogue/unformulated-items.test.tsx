import type { MealAdmin } from '@healthy360/api-client/contracts';
import { screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../../testing/session-fixtures.ts';
import { page } from '../../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../../testing/stub-screen.tsx';
import { UnformulatedItems } from './unformulated-items.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/recipes',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The menu items no recipe sells: all of them counted in the title, the first five offered as
 * buttons. Past five the buttons wrapped into a wall that pushed the recipe book off the screen.
 */

/** Only the two fields the notice reads; the rest of a meal is irrelevant here. */
function meal(index: number): MealAdmin {
    return {
        id: `meal-${String(index)}`,
        name: { en: `Meal ${String(index)}`, ar: `وجبة ${String(index)}` },
    } as unknown as MealAdmin;
}

const TEST_ID = 'unformulated';

async function renderItems(count: number) {
    const meals = Array.from({ length: count }, (_, index) => meal(index + 1));
    await renderStubScreen(<UnformulatedItems kind="meal" testID={TEST_ID} />, {
        session: kitchenManagerSession(),
        repositories: {
            kitchenAdmin: {
                listMeals: async () => page(meals),
                listProducts: async () => page([]),
            },
        },
    });
}

describe('UnformulatedItems', () => {
    it('counts every item but offers only the first five', async () => {
        await renderItems(7);

        await waitFor(() => {
            expect(screen.getByTestId(`${TEST_ID}-meal-1`)).toBeTruthy();
        });
        expect(screen.getByTestId(`${TEST_ID}-title`)).toHaveTextContent(/7 items/);
        for (const index of [1, 2, 3, 4, 5]) {
            expect(screen.getByTestId(`${TEST_ID}-meal-${String(index)}`)).toBeTruthy();
        }
        expect(screen.queryByTestId(`${TEST_ID}-meal-6`)).toBeNull();
        expect(screen.queryByTestId(`${TEST_ID}-meal-7`)).toBeNull();
    });

    it('offers every item when there are five or fewer', async () => {
        await renderItems(2);

        await waitFor(() => {
            expect(screen.getByTestId(`${TEST_ID}-meal-2`)).toBeTruthy();
        });
        expect(screen.getByTestId(`${TEST_ID}-title`)).toHaveTextContent(/2 items/);
    });
});
