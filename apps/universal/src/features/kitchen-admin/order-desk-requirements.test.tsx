import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    OrderDeskRequirement,
    OrderDeskRequirements,
    OrderDeskRequirementsFilters,
} from '@healthy360/api-client/contracts';
import { screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession, testActiveContext } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { OrderDeskRequirementsScreen } from './screens/order-desk-requirements-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/order-desk/requirements',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The requirements screen: the buy list, and the three things it must never say.
 *
 * 1. **It must not ask without a branch.** Availability is a quantity on one shelf, so the screen
 *    states the reason rather than spending a `422` on a manager whose only mistake was holding an
 *    organisation-wide membership. The test asserts the *absence of the request*, not just the
 *    absence of the table — a screen that fetched anyway and hid the result would still be wrong.
 * 2. **A hole is not a zero.** `not_computable` renders as its own warning above the table, and the
 *    ingredients that could not be computed produce **no row at all**. A row with `0` next to it
 *    would read as "you have enough", which is the opposite of what happened.
 * 3. **An unknown is an em dash and a zero is a zero.** A shelf with no resolved unit renders `—`;
 *    a shelf holding nothing renders `0`. Both appear in one fixture below, because the difference
 *    is invisible in any single case.
 */

const SHELF_ID = 'stock-0000-0000-0001';
const SECOND_SHELF_ID = 'stock-0000-0000-0002';

function requirement(overrides: Partial<OrderDeskRequirement> = {}): OrderDeskRequirement {
    return {
        ingredientId: 'ingredient-0000-0001',
        stockItemId: SHELF_ID,
        code: 'sku-flour',
        nameEn: 'Flour',
        unitId: 'unit-0000-0001',
        unitCode: 'kg',
        required: '10.000000',
        available: '2.0000',
        short: '8.0000',
        suggestedBuy: '8.0000',
        ...overrides,
    };
}

function answer(
    rows: readonly OrderDeskRequirement[],
    notComputable: OrderDeskRequirements['notComputable'] = { days: 0, reasons: {} },
): OrderDeskRequirements {
    return {
        requirements: rows,
        notComputable,
        meta: {
            from: '2026-09-07',
            to: '2026-09-20',
            branchId: 'test-0000-branch-0001',
            maxWindowDays: 31,
        },
    };
}

async function renderRequirements(
    listRequirements: (filters: OrderDeskRequirementsFilters) => Promise<OrderDeskRequirements>,
) {
    return renderStubScreen(<OrderDeskRequirementsScreen />, {
        session: kitchenManagerSession(),
        repositories: { orderDesk: { listRequirements } },
    });
}

async function settled() {
    await waitFor(
        () => {
            expect(screen.getByTestId('kitchen-order-desk-requirements-table')).toBeTruthy();
        },
        { timeout: 5000 },
    );
}

describe('order desk requirements — the ladder', () => {
    it('shows skeletons, then the table', async () => {
        let release: (value: OrderDeskRequirements) => void = () => undefined;
        const held = new Promise<OrderDeskRequirements>((resolve) => {
            release = resolve;
        });

        await renderRequirements(async () => held);

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-requirements-loading')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-requirements-table')).toBeNull();

        release(answer([requirement()]));
        await settled();
    });

    it('shows the failure with a retry rather than an empty buy list', async () => {
        await renderRequirements(async () => {
            throw new ApiError(apiFailure('server'));
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-requirements-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-requirements-table')).toBeNull();
    });

    it('says a window the server answered and found nothing in, rather than drawing an empty table', async () => {
        await renderRequirements(async () => answer([]));

        await waitFor(
            () => {
                expect(screen.getByTestId('kitchen-order-desk-requirements-empty')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('kitchen-order-desk-requirements-table')).toBeNull();
    });
});

describe('order desk requirements — the branch gate', () => {
    /**
     * **Nothing is asked without a branch, and the `kitchen` area is what guarantees it.**
     *
     * `requiresBranch` names this area, so a member with no branch selected never reaches the
     * screen at all — the guard sends them to the branch picker first. The screen still carries its
     * own refusal (`…-branch-required`) as a belt-and-braces answer, because a data precondition
     * that lives only in a routing table is one refactor away from being nobody's, but the reachable
     * assertion is this one: no branch, no screen, and above all **no request**.
     */
    it('asks for nothing at all when no branch is selected', async () => {
        const harness = await renderStubScreen(<OrderDeskRequirementsScreen />, {
            session: kitchenManagerSession({
                activeContext: testActiveContext({ branchId: null }),
            }),
            repositories: { orderDesk: { listRequirements: async () => answer([]) } },
        });

        await waitFor(
            () => {
                expect(screen.queryByTestId('kitchen-order-desk-requirements-table')).toBeNull();
            },
            { timeout: 5000 },
        );

        expect(screen.queryByTestId('kitchen-order-desk-requirements-screen')).toBeNull();
        // The absent request is the point. A screen that asked anyway and hid the answer would be
        // learning its own preconditions from a `422`.
        expect(harness.repositories.orderDesk.listRequirements).not.toHaveBeenCalled();
    });
});

describe('order desk requirements — what the rows say', () => {
    it('renders an em dash for a shelf with no unit and a zero for a shelf holding none', async () => {
        await renderRequirements(async () =>
            answer([
                requirement({
                    stockItemId: SHELF_ID,
                    unitId: null,
                    unitCode: null,
                    available: '0.0000',
                }),
            ]),
        );

        await settled();

        // The unit is genuinely unknown; the quantity beside it genuinely is nothing.
        expect(
            screen.getByTestId(`kitchen-order-desk-requirement-${SHELF_ID}-unit`),
        ).toHaveTextContent('—');
        expect(
            screen.getByTestId(`kitchen-order-desk-requirement-${SHELF_ID}-available`),
        ).toHaveTextContent('0');
    });

    it('badges the rows the shelf cannot cover, and only those', async () => {
        await renderRequirements(async () =>
            answer([
                requirement({ stockItemId: SHELF_ID, short: '8.0000' }),
                requirement({
                    stockItemId: SECOND_SHELF_ID,
                    code: 'sku-rice',
                    nameEn: 'Rice',
                    available: '50.0000',
                    short: '0.0000',
                    suggestedBuy: '0.0000',
                }),
            ]),
        );

        await settled();

        // Emphasis is a badge carrying a word plus a tone — never colour alone.
        expect(
            screen.getByTestId(`kitchen-order-desk-requirement-${SHELF_ID}-short-badge`),
        ).toBeTruthy();
        expect(
            screen.queryByTestId(`kitchen-order-desk-requirement-${SECOND_SHELF_ID}-short-badge`),
        ).toBeNull();
    });

    it('reports what could not be computed beside the table rather than as a zero inside it', async () => {
        await renderRequirements(async () =>
            answer([requirement()], {
                days: 3,
                reasons: { plan_has_no_menu: 2, meal_has_no_recipe: 1 },
            }),
        );

        await settled();

        const callout = screen.getByTestId('kitchen-order-desk-requirements-not-computable');

        expect(callout).toHaveTextContent(/3 days could not be worked out/);
        expect(callout).toHaveTextContent(/Plan has no menu \(2\)/);
        expect(callout).toHaveTextContent(/Meal has no recipe \(1\)/);

        // And the table still carries exactly the one row that could be computed.
        expect(
            screen.getByTestId(`kitchen-order-desk-requirement-${SHELF_ID}-required`),
        ).toBeTruthy();
    });

    it('says nothing about holes when there are none', async () => {
        await renderRequirements(async () => answer([requirement()]));

        await settled();

        expect(screen.queryByTestId('kitchen-order-desk-requirements-not-computable')).toBeNull();
    });
});
