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
        expect(screen.getByTestId(`${row}-merge-shelf-1-shelf-2`)).toBeDisabled();
        expect(screen.getByTestId(`${row}-merge-shelf-1-shelf-2`)).toHaveTextContent(
            /Count RICE-2 to zero to merge it/,
        );
        // The count is on every branch, because the merge needs every branch at zero.
        expect(screen.getByTestId(`${row}-count-shelf-2`)).toHaveTextContent(
            /Count RICE-2 to zero in every branch/,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-count-shelf-2`));
        });
        expect(routerMock.__push).toHaveBeenCalledWith(
            '/kitchen/stock?shelf=shelf-2&direction=count&returnTo=%252Fkitchen%252Fstock-duplicates',
        );
    });

    it('offers one Count per held shelf in a group of three, whatever the pairs', async () => {
        const three: DuplicateStockGroup = {
            ...BLOCKED,
            shelves: [
                ...BLOCKED.shelves,
                {
                    id: 'shelf-3',
                    code: 'RICE-3',
                    unitCode: 'kg',
                    quantity: '0.0000',
                    hasHistory: true,
                },
            ],
        };
        await renderStubScreen(<StockDuplicatesScreen />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { listDuplicateStock: async () => [three] } },
        });

        const trigger = 'kitchen-stock-duplicates-table-row-Basmati rice-actions-trigger';
        await waitFor(() => {
            expect(screen.getByTestId(trigger)).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(trigger));
        });

        const row = 'kitchen-stock-duplicates-row-shelf-1';
        // Six ordered pairs, each its own item: dropping the empty RICE-3 is offered, the rest wait.
        expect(screen.getByTestId(`${row}-merge-shelf-1-shelf-3`)).not.toBeDisabled();
        expect(screen.getByTestId(`${row}-merge-shelf-3-shelf-2`)).toBeDisabled();
        // RICE-2 is a drop under both RICE-1 and RICE-3, yet it gets one Count; RICE-3 holds nothing.
        expect(screen.getAllByTestId(`${row}-count-shelf-2`)).toHaveLength(1);
        expect(screen.getAllByTestId(`${row}-count-shelf-1`)).toHaveLength(1);
        expect(screen.queryByTestId(`${row}-count-shelf-3`)).toBeNull();
    });
});
