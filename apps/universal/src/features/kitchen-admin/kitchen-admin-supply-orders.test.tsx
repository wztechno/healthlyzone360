import type {
    OrderProposal,
    OrderProposalItem,
    StockItem,
    Supplier,
    SupplyNeedsCount,
} from '@healthy360/api-client/contracts';
import { BranchId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { supplyOrderGroupTestId, supplyOrderRowTestId } from './ops-format.ts';
import { SupplyOrderBuilderScreen } from './screens/supply-order-builder-screen.tsx';
import { SupplyOrdersScreen } from './screens/supply-orders-screen.tsx';

/**
 * The supply-orders landing page and the builder (SUP3), against a world this file authors.
 *
 * Nothing here stubs a hook: every proposal row below is declared in this file and handed to
 * `renderStubScreen`, so a repository method a screen reaches for and this file did not declare
 * rejects with `StubNotConfiguredError` naming it rather than rendering an empty state over a hole.
 *
 * Seven things this file exists to prove:
 *
 * 1. **The union renders as one list in the server's order.** Out of stock first, then low, then
 *    requested — and a row that is both empty and below its threshold is one row wearing the Out
 *    badge, not two rows.
 * 2. **An empty queue is a good state.** "Nothing needs ordering" with the tick, and the secondary
 *    action stays so a manager can still order ahead of a busy weekend.
 * 3. **A suggestion is prefilled and a missing one is left blank.** The blank is the designed
 *    state for a shelf with no par, not an error, and it is emphatically not a zero.
 * 4. **The supplier cell has three states.** Named-and-preferred, choose-between-these, and
 *    nothing-on-file — the last of which is a different section with a different picker.
 * 5. **Remembering a link is its own write.** Choosing a supplier for an unlinked shelf with the
 *    box ticked fires `upsertSupplierLink` standalone; unticking it fires nothing.
 * 6. **The grouping preview follows what is typed**, one block per supplier.
 * 7. **Refresh asks first only when there is something to lose.**
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace,
            setParams: jest.fn(),
            back: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/supply-orders',
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

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const BRANCH = BranchId.unsafe(String(TEST_BRANCH_ID));

function itemId(ordinal: number): StockItemId {
    return StockItemId.unsafe(`01935f6d-0000-7000-8000-00000000e00${String(ordinal)}`);
}

function supplierId(ordinal: number): SupplierId {
    return SupplierId.unsafe(`01935f6d-0000-7000-8000-00000000f00${String(ordinal)}`);
}

function option(ordinal: number, isPreferred = false) {
    return {
        id: supplierId(ordinal),
        code: `SUP-0${String(ordinal)}`,
        nameEn: `Supplier ${String(ordinal)}`,
        nameAr: null,
        isPreferred,
        leadTimeDays: null,
    };
}

function proposalRow(
    ordinal: number,
    overrides: Partial<OrderProposalItem> = {},
): OrderProposalItem {
    return {
        stockItemId: itemId(ordinal),
        itemCode: `ITM-0${String(ordinal)}`,
        itemNameEn: `Item ${String(ordinal)}`,
        unitId: null,
        unitCode: 'kg',
        branchId: BRANCH,
        quantityOnHand: '0.0000',
        reorderThreshold: null,
        parLevel: null,
        isOutOfStock: true,
        isLow: false,
        origin: 'outOfStock',
        suggestedQuantity: null,
        suggestedQuantityBasis: 'none',
        supplierOptions: [],
        suggestedSupplierId: null,
        unassignedReason: null,
        ...overrides,
    };
}

function proposal(items: readonly OrderProposalItem[]): OrderProposal {
    return {
        items,
        branchId: BRANCH,
        outOfStockCount: items.filter((item) => item.origin === 'outOfStock').length,
        lowStockCount: items.filter((item) => item.origin === 'lowStock').length,
        unassignedCount: items.filter((item) => item.unassignedReason !== null).length,
        requestedItemCount: items.filter((item) => item.origin === 'requested').length,
    };
}

function counts(items: readonly OrderProposalItem[]): SupplyNeedsCount {
    const queue = items.filter((item) => item.origin !== 'requested');
    const outOfStock = queue.filter((item) => item.origin === 'outOfStock').length;
    return {
        count: queue.length,
        outOfStockCount: outOfStock,
        lowStockCount: queue.length - outOfStock,
    };
}

function supplierRecord(ordinal: number): Supplier {
    return {
        id: supplierId(ordinal),
        code: `SUP-0${String(ordinal)}`,
        name: { en: `Supplier ${String(ordinal)}`, ar: '' },
        currencyCode: null,
        contactEmail: null,
        contactPhone: null,
        address: null,
        paymentTerms: null,
        leadTimeDays: null,
        notes: null,
        archivedAt: null,
        contactCount: 0,
        suppliedItemCount: 0,
        primaryContact: null,
    };
}

function stockItem(ordinal: number): StockItem {
    return {
        id: itemId(ordinal),
        code: `ITM-0${String(ordinal)}`,
        nameEn: `Item ${String(ordinal)}`,
        unitCode: 'kg',
        ingredientId: null,
        catalogueItemId: null,
        backing: 'ingredient',
        isStocked: false,
        hasHistory: false,
    };
}

/** The queue the union produces: two empty shelves — one of them also below its threshold — and one low. */
const OUT_ONLY = proposalRow(1, { itemNameEn: 'Almonds', itemCode: 'ALM-1' });
const OUT_AND_LOW = proposalRow(2, {
    itemNameEn: 'Coriander',
    itemCode: 'COR-1',
    reorderThreshold: '3.0000',
    isLow: true,
});
const LOW_ONLY = proposalRow(3, {
    itemNameEn: 'Butter',
    itemCode: 'BUT-1',
    quantityOnHand: '5.0000',
    reorderThreshold: '5.0000',
    parLevel: '20.0000',
    isOutOfStock: false,
    isLow: true,
    origin: 'lowStock',
    suggestedQuantity: '15.0000',
    suggestedQuantityBasis: 'par',
    supplierOptions: [option(1, true), option(2)],
    suggestedSupplierId: supplierId(1),
});

function landingOverrides(items: readonly OrderProposalItem[]): RepositoryOverrides {
    return {
        kitchenOps: {
            countSupplyNeeds: async () => counts(items),
            getOrderProposal: async () => proposal(items),
        },
    };
}

function builderOverrides(
    items: readonly OrderProposalItem[],
    extra: RepositoryOverrides['kitchenOps'] = {},
): RepositoryOverrides {
    return {
        kitchenOps: {
            getOrderProposal: async () => proposal(items),
            listSuppliers: async () => [supplierRecord(1), supplierRecord(2), supplierRecord(7)],
            listStockItems: async () => [stockItem(1), stockItem(2), stockItem(3), stockItem(9)],
            ...extra,
        },
    };
}

/* ------------------------------------------------------------------------------------------------
 * Landing
 * ---------------------------------------------------------------------------------------------- */

describe('supply orders landing', () => {
    it('shows the two shortage metrics and previews the queue in the server order', async () => {
        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: landingOverrides([OUT_ONLY, OUT_AND_LOW, LOW_ONLY]),
        });

        await untilVisible('kitchen-supply-orders-preview');

        // Two of the three numbers, never a third claiming a total: they partition the count.
        expect(
            screen.getByTestId('kitchen-supply-orders-panel-metric-outOfStock'),
        ).toHaveTextContent('2');
        expect(screen.getByTestId('kitchen-supply-orders-panel-metric-low')).toHaveTextContent('1');

        const both = supplyOrderRowTestId(String(OUT_AND_LOW.stockItemId));
        // Both rules at once is one row wearing the Out badge — the label the server chose.
        expect(screen.getByTestId(`${both}-out`)).toBeTruthy();
        expect(screen.queryByTestId(`${both}-low`)).toBeNull();

        const low = supplyOrderRowTestId(String(LOW_ONLY.stockItemId));
        expect(screen.getByTestId(`${low}-low`)).toBeTruthy();
        expect(screen.getByTestId(`${low}-reorder-at`)).toHaveTextContent('5');
    });

    it('counts the rest of the queue rather than listing it', async () => {
        const many = Array.from({ length: 11 }, (_, index) => proposalRow(index + 1));

        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: landingOverrides(many),
        });

        await untilVisible('kitchen-supply-orders-and-more');

        // Eight shown, three counted — enough to tell "four things" from "forty" at a glance.
        expect(screen.getByTestId('kitchen-supply-orders-and-more')).toHaveTextContent('3');
        expect(screen.queryByTestId(supplyOrderRowTestId(String(itemId(9))))).toBeNull();
    });

    it('reads an empty queue as good news and still offers a way in', async () => {
        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: landingOverrides([]),
        });

        await untilVisible('kitchen-supply-orders-empty');

        // A fully stocked kitchen is not a screen with no content. The primary Prepare button steps
        // aside, because there is nothing to prepare — but the escape hatch stays.
        expect(screen.queryByTestId('kitchen-supply-orders-prepare')).toBeNull();

        fireEvent.press(screen.getByTestId('kitchen-supply-orders-order-anyway'));
        expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/supply-orders/new');
    });

    it('refuses to guess a branch it was not given', async () => {
        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession({
                activeContext: { ...kitchenManagerSession().activeContext!, branchId: null },
            }),
            repositories: { kitchenOps: {} },
        });

        await untilVisible('kitchen-supply-orders-branch-required');

        // Summing three branches' shortages would be the one mistake a buy list must never make,
        // so the screen does not fetch at all rather than spend a 422 to say "validation failed".
        expect(screen.queryByTestId('kitchen-supply-orders-preview')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Builder
 * ---------------------------------------------------------------------------------------------- */

describe('supply order builder', () => {
    it('prefills a par-based suggestion and leaves a row without one blank', async () => {
        await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([OUT_ONLY, LOW_ONLY]),
        });

        await untilVisible('kitchen-supply-order-rows');

        const suggested = screen.getByTestId(
            `${supplyOrderRowTestId(String(LOW_ONLY.stockItemId))}-quantity-input`,
        );
        expect(suggested.props.value).toBe('15.0000');

        // Blank, never "0". Zero is a decision; empty is the absence of one, and prefilling zero
        // would make "not ordering" the default for the rows that most need a human number.
        const manual = screen.getByTestId(
            `${supplyOrderRowTestId(String(OUT_ONLY.stockItemId))}-quantity-input`,
        );
        expect(manual.props.value).toBe('');
    });

    it('names a preferred supplier and asks for a choice when there is no preference', async () => {
        const undecided = proposalRow(4, {
            itemNameEn: 'Cumin',
            supplierOptions: [option(1), option(2)],
            suggestedSupplierId: null,
        });

        await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([LOW_ONLY, undecided]),
        });

        await untilVisible('kitchen-supply-order-rows');

        const preferred = supplyOrderRowTestId(String(LOW_ONLY.stockItemId));
        expect(screen.getByTestId(`${preferred}-supplier`)).toHaveTextContent('Supplier 1');
        expect(screen.getByTestId(`${preferred}-preferred`)).toBeTruthy();

        // Two candidates and no preference recorded: the system declines to guess and says so,
        // which is a different state from having nobody to choose from.
        const choose = supplyOrderRowTestId(String(undecided.stockItemId));
        expect(screen.getByTestId(`${choose}-choose-supplier`)).toBeTruthy();
        expect(screen.queryByTestId(`${choose}-supplier`)).toBeNull();
    });

    it('separates shelves with no supplier on file and names the archived case differently', async () => {
        const unlinked = proposalRow(5, { itemNameEn: 'Dill', unassignedReason: 'noSupplier' });
        const archived = proposalRow(6, {
            itemNameEn: 'Endive',
            unassignedReason: 'suppliersArchived',
        });

        await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([LOW_ONLY, unlinked, archived]),
        });

        await untilVisible('kitchen-supply-order-unlinked');

        // Different problems, different fixes — one empty dropdown for both would leave the person
        // guessing which they had.
        expect(
            screen.getByTestId(`${supplyOrderRowTestId(String(unlinked.stockItemId))}-reason`),
        ).toHaveTextContent('No supplier is linked');
        expect(
            screen.getByTestId(`${supplyOrderRowTestId(String(archived.stockItemId))}-reason`),
        ).toHaveTextContent('archived');

        // The linked row stays in region A rather than being dragged into region B.
        expect(
            screen.queryByTestId(`${supplyOrderRowTestId(String(LOW_ONLY.stockItemId))}-reason`),
        ).toBeNull();
    });

    it('writes the link standalone when remember is ticked, and not when it is cleared', async () => {
        const unlinked = proposalRow(5, { itemNameEn: 'Dill', unassignedReason: 'noSupplier' });
        const upsertSupplierLink = jest.fn(async () => ({
            supplierId: supplierId(7),
            stockItemId: unlinked.stockItemId,
            isPreferred: false,
            supplierItemRef: null,
        }));

        const { repositories } = await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([unlinked], { upsertSupplierLink }),
        });

        await untilVisible('kitchen-supply-order-unlinked');

        const testID = supplyOrderRowTestId(String(unlinked.stockItemId));

        // Ticked by default: somebody assigning a supplier to an unlinked shelf almost always
        // wants the link.
        fireEvent.press(screen.getByTestId(`${testID}-supplier-select`));
        fireEvent.press(
            await screen.findByTestId(`${testID}-supplier-select-option-${String(supplierId(7))}`),
        );

        await waitFor(() => {
            expect(repositories.kitchenOps.upsertSupplierLink).toHaveBeenCalledWith({
                supplierId: supplierId(7),
                stockItemId: unlinked.stockItemId,
            });
        });

        // Standalone, never folded into a create: §4 is explicit that ordering never changes links
        // implicitly, so the write happens here or not at all.
        (repositories.kitchenOps.upsertSupplierLink as jest.Mock).mockClear();

        fireEvent.press(screen.getByTestId(`${testID}-remember`));
        fireEvent.press(screen.getByTestId(`${testID}-supplier-select`));
        fireEvent.press(
            await screen.findByTestId(`${testID}-supplier-select-option-${String(supplierId(1))}`),
        );

        await waitFor(() => {
            expect(screen.getByTestId(`${testID}-supplier-select`)).toBeTruthy();
        });
        expect(repositories.kitchenOps.upsertSupplierLink).not.toHaveBeenCalled();
    });

    it('groups what has been typed by supplier and counts what is being left behind', async () => {
        const unlinked = proposalRow(5, { itemNameEn: 'Dill', unassignedReason: 'noSupplier' });

        await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([LOW_ONLY, OUT_ONLY, unlinked]),
        });

        await untilVisible('kitchen-supply-order-preview');

        // The suggested row is already in the preview: it opened with a quantity and a supplier.
        expect(screen.getByTestId(supplyOrderGroupTestId(String(supplierId(1))))).toBeTruthy();

        // The unlinked row has no quantity and no supplier, so it is excluded rather than
        // unassigned — and the two counts are reported separately.
        expect(screen.getByTestId('kitchen-supply-order-excluded')).toHaveTextContent('2');
        expect(screen.queryByTestId('kitchen-supply-order-unassigned-warning')).toBeNull();

        // Typing a quantity on a row with nobody to buy it from moves it into the warning.
        fireEvent.changeText(
            screen.getByTestId(
                `${supplyOrderRowTestId(String(unlinked.stockItemId))}-quantity-input`,
            ),
            '4',
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-supply-order-unassigned-warning')).toHaveTextContent(
                '1',
            );
        });
    });

    it('asks before refreshing only once something has been typed', async () => {
        await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([LOW_ONLY]),
        });

        await untilVisible('kitchen-supply-order-rows');

        // An untouched screen refreshes straight away: a confirmation with nothing to lose is a
        // dialog that teaches people to dismiss dialogs.
        fireEvent.press(screen.getByTestId('kitchen-supply-order-refresh'));
        expect(screen.queryByTestId('kitchen-supply-order-refresh-confirm')).toBeNull();

        fireEvent.changeText(
            screen.getByTestId(
                `${supplyOrderRowTestId(String(LOW_ONLY.stockItemId))}-quantity-input`,
            ),
            '9',
        );
        fireEvent.press(screen.getByTestId('kitchen-supply-order-refresh'));

        await untilVisible('kitchen-supply-order-refresh-confirm');
    });

    it('adds a manually chosen shelf by re-asking the server rather than inventing a row', async () => {
        const { repositories } = await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([LOW_ONLY]),
        });

        await untilVisible('kitchen-supply-order-add-select');

        fireEvent.press(screen.getByTestId('kitchen-supply-order-add-select'));
        fireEvent.press(
            await screen.findByTestId(
                `kitchen-supply-order-add-select-option-${String(itemId(9))}`,
            ),
        );

        // One place decides what a proposal row looks like, suppliers resolved and all — so a shelf
        // somebody typed in comes back the same shape as the shelf that ran out.
        await waitFor(() => {
            expect(repositories.kitchenOps.getOrderProposal).toHaveBeenCalledWith(BRANCH, [
                itemId(9),
            ]);
        });
    });
});
