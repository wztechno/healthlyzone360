import type { DuplicateStockGroup } from '@healthy360/api-client/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { StockDuplicatesScreen } from './screens/stock-duplicates-screen.tsx';

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/kitchen/stock-duplicates',
    }),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

beforeEach(() => {
    routerMock.__reset();
});

/** Two shelves of rice that both have history, and both still hold stock: Merge is blocked. */
const BLOCKED: DuplicateStockGroup = {
    name: 'Basmati rice',
    reason: 'both_have_history',
    shelves: [
        { id: 'shelf-1', code: 'RICE-1', unitCode: 'kg', quantity: '3.0000', hasHistory: true },
        { id: 'shelf-2', code: 'RICE-2', unitCode: 'kg', quantity: '1.5000', hasHistory: true },
    ],
};

describe('the duplicate stock list', () => {
    it('offers to count a blocked shelf to zero on Stock, and keeps Merge disabled', async () => {
        await renderStubScreen(<StockDuplicatesScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { listDuplicateStock: async () => [BLOCKED] } },
        });

        const trigger = 'kitchen-stock-duplicates-table-row-Basmati rice-actions-trigger';
        await waitFor(() => {
            expect(screen.getByTestId(trigger)).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(trigger));
        });

        const row = 'kitchen-stock-duplicates-row-shelf-1';
        // Keeping RICE-1 needs RICE-2 counted out first: the merge says so and cannot be chosen.
        expect(screen.getByTestId(`${row}-merge-into-shelf-1`)).toBeDisabled();
        expect(screen.getByTestId(`${row}-merge-into-shelf-1`)).toHaveTextContent(
            /Count RICE-2 to zero to merge it/,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-count-shelf-2`));
        });
        expect(routerMock.__push).toHaveBeenCalledWith(
            '/kitchen/stock?shelf=shelf-2&direction=count&returnTo=%252Fkitchen%252Fstock-duplicates',
        );
    });
});
