import type { WeeklyStockCheck } from '@healthy360/api-client/contracts';
import type { BranchId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { WeeklyStockCheckBanner } from './weekly-stock-check.tsx';

/**
 * The weekly stock check's notice speaks only when Monday's run found something short. An
 * all-clear is nothing to act on, so it draws nothing — like a branch that was never checked.
 */

const BRANCH = 'test-0000-branch-0001' as BranchId;

function check(overrides: Partial<WeeklyStockCheck> = {}): WeeklyStockCheck {
    return {
        id: 'check-0001',
        branchId: BRANCH,
        windowFrom: '2026-10-19',
        windowTo: '2026-10-25',
        checkedAt: '2026-10-19T04:00:00Z',
        requirementCount: 12,
        shortCount: 0,
        notComputableDays: 0,
        shortfalls: [],
        ...overrides,
    };
}

async function renderBanner(answer: WeeklyStockCheck | null, onShowWindow = jest.fn()) {
    const harness = await renderStubScreen(
        <WeeklyStockCheckBanner branchId={BRANCH} onShowWindow={onShowWindow} />,
        {
            session: kitchenManagerSession(),
            repositories: { orderDesk: { getWeeklyStockCheck: async () => answer } },
        },
    );
    await waitFor(() => {
        expect(
            harness.queryClient.getQueryState(['orderDesk', 'weekly-check', BRANCH])?.status,
        ).toBe('success');
    });
    return harness;
}

describe('WeeklyStockCheckBanner', () => {
    it('draws nothing when the check found nothing short', async () => {
        await renderBanner(check({ shortCount: 0 }));

        expect(screen.queryByTestId('kitchen-weekly-check')).toBeNull();
        expect(screen.queryByTestId('kitchen-weekly-check-show-window')).toBeNull();
    });

    it('draws nothing for a branch that was never checked', async () => {
        await renderBanner(null);

        expect(screen.queryByTestId('kitchen-weekly-check')).toBeNull();
    });

    it('names what was short and points the list at that week', async () => {
        const onShowWindow = jest.fn();
        await renderBanner(
            check({
                shortCount: 1,
                shortfalls: [
                    {
                        stockItemId: 'stock-0001',
                        code: 'sku-flour',
                        name: 'Flour',
                        unitCode: 'kg',
                        required: '10',
                        available: '2',
                        short: '8',
                        suggestedBuy: '8',
                    },
                ],
            }),
            onShowWindow,
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-weekly-check')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-weekly-check-short-sku-flour')).toHaveTextContent(
            /Flour/,
        );

        fireEvent.press(screen.getByTestId('kitchen-weekly-check-show-window'));
        expect(onShowWindow).toHaveBeenCalledWith('2026-10-19', '2026-10-25');
    });
});
