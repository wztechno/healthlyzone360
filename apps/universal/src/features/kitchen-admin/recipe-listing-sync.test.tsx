import type { AdminEntityMeta, MealAdmin, ProductAdmin } from '@healthy360/api-client/contracts';
import { MealId, ProductId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { useRecipeListingSync } from './recipe-listing-sync.ts';
import type { ListingSeller } from './recipe-listing-sync.ts';

/**
 * The recipe page writes its sellers itself now that there is no Selling tab: Publish puts every
 * draft seller on sale, at the lock version it reads then, and leaves one already on sale alone.
 */

const SAUCE_ID = ProductId.unsafe('01935f6d-0000-7000-8000-0000000d0001');
const MEAL_ID = MealId.unsafe('01935f6d-0000-7000-8000-0000000f0001');

function meta(lockVersion: number): AdminEntityMeta {
    return {
        lockVersion,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
    };
}

const SELLERS: readonly ListingSeller[] = [
    {
        id: String(SAUCE_ID),
        itemType: 'sauce',
        status: 'draft',
        name: { en: 'Garlic sauce', ar: 'صلصة الثوم' },
    },
    {
        id: String(MEAL_ID),
        itemType: 'meal',
        status: 'published',
        name: { en: 'Toum bowl', ar: 'وعاء الثومية' },
    },
];

function Harness() {
    const sync = useRecipeListingSync();
    return (
        <Pressable
            testID="publish"
            onPress={() => {
                void sync.publish(SELLERS);
            }}
        >
            <Text>Publish</Text>
        </Pressable>
    );
}

describe('putting a recipe’s items on sale', () => {
    it('publishes each draft seller at its current lock version, and only those', async () => {
        const { repositories } = await renderStubScreen(<Harness />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getProduct: async () => ({ id: SAUCE_ID, meta: meta(9) }) as ProductAdmin,
                    publishProduct: async () => ({ id: SAUCE_ID, meta: meta(10) }) as ProductAdmin,
                    getMeal: async () => ({ id: MEAL_ID, meta: meta(4) }) as MealAdmin,
                },
            },
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('publish'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.publishProduct).toHaveBeenCalledWith(SAUCE_ID, {
                lockVersion: 9,
            });
        });
        // The meal is on sale already.
        expect(repositories.kitchenAdmin.publishMeal).not.toHaveBeenCalled();
    });
});
