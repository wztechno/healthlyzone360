import type { MealAdmin } from '@healthy360/api-client/contracts';
import { IssueTrayFrame } from '@healthy360/design-system';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import { withDeskWidth } from '../../../testing/desk-width.ts';
import { kitchenManagerSession } from '../../../testing/session-fixtures.ts';
import { page } from '../../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../../testing/stub-screen.tsx';
import { UnformulatedItems } from './unformulated-items.tsx';

/* `mock`-prefixed so the factory below may close over it — Jest's hoisting rule. */
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/recipes',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The menu items no recipe sells. In a page's issue tray every one is a card whose Fix opens its item
 * page; drawn on its own, all of them are counted in the title and the first five offered as
 * buttons — past five the buttons wrapped into a wall that pushed the recipe book off the screen.
 */

/** Only the two fields the notice reads; the rest of a meal is irrelevant here. */
function meal(index: number): MealAdmin {
    return {
        id: `meal-${String(index)}`,
        name: { en: `Meal ${String(index)}`, ar: `وجبة ${String(index)}` },
    } as unknown as MealAdmin;
}

const TEST_ID = 'unformulated';

async function renderItems(count: number, { inTray = false } = {}) {
    const meals = Array.from({ length: count }, (_, index) => meal(index + 1));
    const items = <UnformulatedItems kind="meal" testID={TEST_ID} />;
    await renderStubScreen(
        inTray ? (
            <IssueTrayFrame tray={{ title: 'To fix', testID: 'tray', groups: [] }}>
                {items}
            </IssueTrayFrame>
        ) : (
            items
        ),
        {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listMeals: async () => page(meals),
                    listProducts: async () => page([]),
                },
            },
        },
    );
}

describe('UnformulatedItems', () => {
    it('drawn on its own, counts every item but offers only the first five', async () => {
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

    it('drawn on its own, offers every item when there are five or fewer', async () => {
        await renderItems(2);

        await waitFor(() => {
            expect(screen.getByTestId(`${TEST_ID}-meal-2`)).toBeTruthy();
        });
        expect(screen.getByTestId(`${TEST_ID}-title`)).toHaveTextContent(/2 items/);
    });

    it('lists every item as a card of its own in a tray above it, each opening its item page', async () => {
        await withDeskWidth(async () => {
            await renderItems(7, { inTray: true });

            await waitFor(() => {
                expect(screen.getByTestId(`${TEST_ID}-meal-7`)).toBeTruthy();
            });
            // No strip on the page: the tray holds them, all seven, under the counted title.
            const tray = screen.getByTestId('tray');
            for (const index of [1, 2, 3, 4, 5, 6, 7]) {
                expect(
                    within(tray).getByTestId(`${TEST_ID}-meal-${String(index)}-label`),
                ).toHaveTextContent(`Meal ${String(index)}`);
            }
            expect(within(tray).getByTestId(TEST_ID)).toHaveTextContent(/7 items/);

            await act(async () => {
                fireEvent.press(screen.getByTestId(`${TEST_ID}-meal-6-fix`));
            });
            expect(mockPush).toHaveBeenCalledWith('/kitchen/recipes/item/meal-6?kind=meal');
        });
    });
});
