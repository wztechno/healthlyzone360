import type {
    CursorPage,
    OrderProposal,
    OrderProposalItem,
    PurchaseOrder,
    PurchaseOrderLine,
    RecipientSnapshot,
    StockItem,
    Supplier,
    SupplyNeedsCount,
} from '@healthy360/api-client/contracts';
import { BranchId, PurchaseOrderId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TEST_BRANCH_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    purchaseOrderLineTestId,
    purchaseOrderRowTestId,
    supplyOrderGroupTestId,
    supplyOrderRowTestId,
} from './ops-format.ts';
import { SupplyOrderBuilderScreen } from './screens/supply-order-builder-screen.tsx';
import { SupplyOrderDetailScreen } from './screens/supply-order-detail-screen.tsx';
import { SupplyOrdersScreen } from './screens/supply-orders-screen.tsx';

/**
 * The supply-orders landing page, the builder and one order's own page (SUP3, SUP4), against a
 * world this file authors.
 *
 * Nothing here stubs a hook: every proposal row below is declared in this file and handed to
 * `renderStubScreen`, so a repository method a screen reaches for and this file did not declare
 * rejects with `StubNotConfiguredError` naming it rather than rendering an empty state over a hole.
 *
 * Eleven things this file exists to prove:
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
 * 8. **The commit bar counts what is about to be created**, and the dialog it opens sends exactly
 *    the payload the preview was built from — the same pure function, so the two cannot drift.
 * 9. **A failed batch says nothing was saved**, in the dialog rather than as a toast, because the
 *    create is atomic and there is no partial state to explain.
 * 10. **The landing page lists the orders that exist**, with an Open action per row.
 * 11. **The order page is three screens wearing one layout**, and which one is decided by the
 *     closed capability records over all five statuses — including the two the receiving slice
 *     will start producing.
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

function purchaseOrderId(ordinal: number): PurchaseOrderId {
    return PurchaseOrderId.unsafe(`01935f6d-0000-7000-8000-00000000d00${String(ordinal)}`);
}

function orderLine(
    ordinal: number,
    quantity = '4.0000',
    received = '0.0000',
    outstanding?: string,
): PurchaseOrderLine {
    return {
        id: `01935f6d-0000-7000-8000-00000000c00${String(ordinal)}`,
        stockItemId: itemId(ordinal),
        itemCode: `ITM-0${String(ordinal)}`,
        itemNameEn: `Item ${String(ordinal)}`,
        itemNameAr: null,
        quantity,
        // SUP5: the three quantities on a row always add up, so a fixture that
        // states one has to state the other two.
        receivedQuantity: received,
        outstandingQuantity: outstanding ?? quantity,
        unitCode: 'kg',
        supplierItemRef: null,
        notes: null,
        displayOrder: ordinal - 1,
    };
}

/** One order, defaulting to a draft. `overrides` is how each status case states its own shape. */
function purchaseOrder(ordinal: number, overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
    return {
        id: purchaseOrderId(ordinal),
        number: `PO-ABCDEF0${String(ordinal)}`,
        status: 'draft',
        branch: { id: BRANCH, name: 'Main kitchen' },
        supplier: {
            id: supplierId(1),
            code: 'SUP-01',
            nameEn: 'Supplier 1',
            nameAr: null,
            archivedAt: null,
        },
        recipientSnapshot: null,
        notes: null,
        lineCount: 1,
        issuedAt: null,
        receivedAt: null,
        closedAt: null,
        closeShortReason: null,
        cancelledAt: null,
        createdAt: '2026-08-17T09:00:00+00:00',
        lines: [orderLine(1)],
        receipts: [],
        ...overrides,
    };
}

/** The frozen document an issued order carries — deliberately different from the live supplier. */
const SNAPSHOT: RecipientSnapshot = {
    supplierId: supplierId(1),
    code: 'SUP-01',
    nameEn: 'Supplier 1 as it was',
    nameAr: null,
    address: 'Gate 4, behind the cold store',
    paymentTerms: 'Net 30',
    leadTimeDays: 2,
    contactEmail: null,
    contactPhone: null,
    contacts: [
        {
            name: 'Samir',
            roleTitle: 'Sales',
            email: null,
            phone: '+96171111111',
            whatsappPhone: null,
            isPrimary: true,
        },
    ],
};

function page(orders: readonly PurchaseOrder[]): CursorPage<PurchaseOrder> {
    return { items: orders, nextCursor: null, hasMore: false, totalCount: null };
}

function landingOverrides(
    items: readonly OrderProposalItem[],
    orders: readonly PurchaseOrder[] = [],
): RepositoryOverrides {
    return {
        kitchenOps: {
            countSupplyNeeds: async () => counts(items),
            getOrderProposal: async () => proposal(items),
            listPurchaseOrders: async () => page(orders),
        },
    };
}

function detailOverrides(
    order: PurchaseOrder,
    extra: RepositoryOverrides['kitchenOps'] = {},
): RepositoryOverrides {
    return {
        kitchenOps: {
            getPurchaseOrder: async () => order,
            listStockItems: async () => [stockItem(1), stockItem(2), stockItem(9)],
            ...extra,
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

    it('counts what it is about to create and sends exactly the plan the preview shows', async () => {
        const unlinked = proposalRow(5, { itemNameEn: 'Dill', unassignedReason: 'noSupplier' });
        const createPurchaseOrders = jest.fn(async () => [purchaseOrder(1)]);

        const { repositories } = await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([LOW_ONLY, OUT_ONLY, unlinked], {
                createPurchaseOrders,
            }),
        });

        await untilVisible('kitchen-supply-order-commit');

        // One supplier, one line — LOW_ONLY opened with a suggestion and a preferred supplier, and
        // the other two rows carry no quantity.
        expect(screen.getByTestId('kitchen-supply-order-commit-orders')).toHaveTextContent('1');
        expect(screen.getByTestId('kitchen-supply-order-commit-lines')).toHaveTextContent('1');
        expect(screen.getByTestId('kitchen-supply-order-commit-left-behind')).toHaveTextContent(
            '2',
        );

        fireEvent.press(screen.getByTestId('kitchen-supply-order-create'));
        await untilVisible('kitchen-supply-order-create-confirm');

        // The two kinds of "left behind" are named apart in the confirmation (§4), because they
        // have different fixes and lumping them together hides the one that matters.
        expect(screen.getByTestId('kitchen-supply-order-create-excluded')).toHaveTextContent('2');

        fireEvent.press(screen.getByTestId('kitchen-supply-order-create-confirm-action'));

        // Exactly `toBatchPayload(plan)` — the same object the accordion above was built from.
        await waitFor(() => {
            expect(repositories.kitchenOps.createPurchaseOrders).toHaveBeenCalledWith({
                orders: [
                    {
                        supplierId: supplierId(1),
                        branchId: BRANCH,
                        lines: [{ stockItemId: LOW_ONLY.stockItemId, quantity: '15.0000' }],
                    },
                ],
            });
        });

        /*
         * The builder steps aside: leaving somebody on a form whose rows have just been ordered
         * invites a second batch. It carries the new identifiers with it (SUP7, §7) so the landing
         * page can offer **Print them** — a standing callout rather than a toast action, because
         * the design system's toast has no action slot and a control that vanishes on a timer is a
         * control a person loses by looking away.
         */
        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/kitchen/supply-orders?created=${encodeURIComponent(String(purchaseOrderId(1)))}`,
            );
        });
    });

    it('says nothing was saved when the batch fails, in the dialog rather than as a toast', async () => {
        const createPurchaseOrders = jest.fn(async () => {
            throw new Error('nope');
        });

        await renderStubScreen(<SupplyOrderBuilderScreen />, {
            session: kitchenManagerSession(),
            repositories: builderOverrides([LOW_ONLY], { createPurchaseOrders }),
        });

        await untilVisible('kitchen-supply-order-commit');

        fireEvent.press(screen.getByTestId('kitchen-supply-order-create'));
        await untilVisible('kitchen-supply-order-create-confirm');
        fireEvent.press(screen.getByTestId('kitchen-supply-order-create-confirm-action'));

        // The batch is atomic, so there is no partial state to explain — and the dialog stays open
        // because the honest offer is to try the same thing again.
        await untilVisible('kitchen-supply-order-create-failed');
        expect(screen.getByTestId('kitchen-supply-order-create-confirm')).toBeTruthy();
        expect(routerMock.__replace).not.toHaveBeenCalled();
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

/* ------------------------------------------------------------------------------------------------
 * The order book on the landing page
 * ---------------------------------------------------------------------------------------------- */

describe('supply orders book', () => {
    it('lists the orders that exist and opens one', async () => {
        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: landingOverrides(
                [LOW_ONLY],
                [purchaseOrder(1), purchaseOrder(2, { status: 'issued', lineCount: 3 })],
            ),
        });

        await untilVisible('kitchen-supply-orders-book-table');

        const first = purchaseOrderRowTestId(String(purchaseOrderId(1)));
        expect(screen.getByTestId(`${first}-number`)).toHaveTextContent('PO-ABCDEF01');
        expect(screen.getByTestId(`${first}-supplier`)).toHaveTextContent('Supplier 1');
        expect(screen.getByTestId(`${first}-lines`)).toHaveTextContent('1');

        // A word and a tone, never colour alone.
        expect(screen.getByTestId(`${first}-status`)).toHaveTextContent('Draft');
        expect(
            screen.getByTestId(`${purchaseOrderRowTestId(String(purchaseOrderId(2)))}-status`),
        ).toHaveTextContent('Issued');

        fireEvent.press(screen.getByTestId(`${first}-open`));
        expect(routerMock.__push).toHaveBeenCalledWith(
            `/kitchen/supply-orders/${String(purchaseOrderId(1))}`,
        );
    });

    /**
     * SUP7. The builder replaces itself with this page and hands over the identifiers it just
     * created; **Print them** lives in the callout that reads them.
     *
     * The count comes from the query string rather than from the book on purpose: the list is a
     * keyset page whose `totalCount` is null by contract, so counting the rows in hand would say
     * "2 orders created" whether two were created or twenty.
     */
    it('offers to print the batch the builder just created', async () => {
        const created = [purchaseOrderId(1), purchaseOrderId(2)].map(String);

        await renderStubScreen(<SupplyOrdersScreen created={created.join(',')} />, {
            session: kitchenManagerSession(),
            repositories: landingOverrides([LOW_ONLY], [purchaseOrder(1), purchaseOrder(2)]),
        });

        await untilVisible('kitchen-supply-orders-created');

        fireEvent.press(screen.getByTestId('kitchen-supply-orders-created-print'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            `/kitchen/supply-orders/print?orders=${encodeURIComponent(created.join(','))}`,
        );
    });

    it('shows no created notice when the page was not reached from the builder', async () => {
        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: landingOverrides([LOW_ONLY], [purchaseOrder(1)]),
        });

        await untilVisible('kitchen-supply-orders-book-table');
        expect(screen.queryByTestId('kitchen-supply-orders-created')).toBeNull();
    });

    it('dresses an empty book as a beginning rather than a failure', async () => {
        await renderStubScreen(<SupplyOrdersScreen />, {
            session: kitchenManagerSession(),
            repositories: landingOverrides([LOW_ONLY], []),
        });

        await untilVisible('kitchen-supply-orders-book-empty');

        // No "drafts" metric tile is derived from the page: the list is a keyset walk with a null
        // total, so a count from the rows in hand would be right only on short lists.
        expect(screen.queryByTestId('kitchen-supply-orders-panel-metric-drafts')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * One order's own page
 * ---------------------------------------------------------------------------------------------- */

describe('purchase order detail', () => {
    it('lets a draft be edited, adds and removes lines, and saves the whole set', async () => {
        const updatePurchaseOrder = jest.fn(async () => purchaseOrder(1));

        const { repositories } = await renderStubScreen(
            <SupplyOrderDetailScreen order={String(purchaseOrderId(1))} />,
            {
                session: kitchenManagerSession(),
                repositories: detailOverrides(
                    purchaseOrder(1, { lines: [orderLine(1), orderLine(2)], lineCount: 2 }),
                    { updatePurchaseOrder },
                ),
            },
        );

        await untilVisible('kitchen-supply-order-detail-lines-table');

        // A draft reads the live supplier, and says so: the order is still being addressed.
        expect(screen.getByTestId('kitchen-supply-order-detail-supplier-name')).toHaveTextContent(
            'Supplier 1',
        );
        expect(screen.getByTestId('kitchen-supply-order-detail-supplier-live')).toBeTruthy();

        fireEvent.press(screen.getByTestId(`${purchaseOrderLineTestId(String(itemId(2)))}-remove`));

        fireEvent.changeText(
            screen.getByTestId(`${purchaseOrderLineTestId(String(itemId(1)))}-quantity-input`),
            '7.5',
        );

        fireEvent.press(screen.getByTestId('kitchen-supply-order-detail-screen-save'));

        // A full replace: the body states the whole desired set, because the endpoint is a replace
        // and a diff would need an identity for a line the client does not name.
        await waitFor(() => {
            expect(repositories.kitchenOps.updatePurchaseOrder).toHaveBeenCalledWith(
                purchaseOrderId(1),
                { notes: null, lines: [{ stockItemId: itemId(1), quantity: '7.5' }] },
            );
        });
    });

    it('shows the frozen snapshot on an issued order and refuses every edit', async () => {
        await renderStubScreen(<SupplyOrderDetailScreen order={String(purchaseOrderId(1))} />, {
            session: kitchenManagerSession(),
            repositories: detailOverrides(
                purchaseOrder(1, {
                    status: 'issued',
                    issuedAt: '2026-08-17T10:00:00+00:00',
                    recipientSnapshot: SNAPSHOT,
                }),
            ),
        });

        await untilVisible('kitchen-supply-order-detail-issued-notice');

        // The document, not the live record (§3.5). A supplier that has since been renamed must not
        // rewrite the copy they are holding.
        expect(screen.getByTestId('kitchen-supply-order-detail-supplier-name')).toHaveTextContent(
            'Supplier 1 as it was',
        );
        expect(
            screen.getByTestId('kitchen-supply-order-detail-supplier-address'),
        ).toHaveTextContent('Gate 4');
        expect(screen.getByTestId('kitchen-supply-order-detail-contact-Samir')).toBeTruthy();

        // Frozen: no save, no quantity box, no add picker, no issue — and cancel survives, because
        // an issued order can still be called off.
        expect(screen.queryByTestId('kitchen-supply-order-detail-screen-save')).toBeNull();
        expect(
            screen.queryByTestId(`${purchaseOrderLineTestId(String(itemId(1)))}-quantity-input`),
        ).toBeNull();
        expect(screen.queryByTestId('kitchen-supply-order-detail-add-line')).toBeNull();
        expect(screen.queryByTestId('kitchen-supply-order-detail-issue')).toBeNull();
        expect(screen.getByTestId('kitchen-supply-order-detail-cancel')).toBeTruthy();
    });

    it.each([
        ['draft', { save: true, issue: true, cancel: true, print: true }],
        ['issued', { save: false, issue: false, cancel: true, print: true }],
        ['partially_received', { save: false, issue: false, cancel: false, print: true }],
        ['received', { save: false, issue: false, cancel: false, print: true }],
        ['cancelled', { save: false, issue: false, cancel: false, print: false }],
    ] as const)('offers exactly the controls a %s order permits', async (status, expected) => {
        await renderStubScreen(<SupplyOrderDetailScreen order={String(purchaseOrderId(1))} />, {
            session: kitchenManagerSession(),
            repositories: detailOverrides(
                purchaseOrder(1, {
                    status,
                    issuedAt: status === 'draft' ? null : '2026-08-17T10:00:00+00:00',
                    cancelledAt: status === 'cancelled' ? '2026-08-18T10:00:00+00:00' : null,
                    recipientSnapshot: status === 'draft' ? null : SNAPSHOT,
                }),
            ),
        });

        await untilVisible('kitchen-supply-order-detail-lines-table');

        // The closed capability records, read through the screen. The two receiving rows are filled
        // in ahead of the slice that produces them, and `cancel: false` on both is §3.5: an order
        // with deliveries against it is never cancelled as though nothing happened.
        const present = (testID: string) => screen.queryByTestId(testID) !== null;

        expect(present('kitchen-supply-order-detail-screen-save')).toBe(expected.save);
        expect(present('kitchen-supply-order-detail-issue')).toBe(expected.issue);
        expect(present('kitchen-supply-order-detail-cancel')).toBe(expected.cancel);
        /*
         * SUP7. Four of the five have a document worth putting on paper — a draft's is a preview
         * carrying a Draft marker. `cancelled` is the exception and it is the interesting one: the
         * sheet exists to be handed to a supplier, and handing over an order that was called off is
         * how a delivery nobody ordered turns up at the door.
         */
        expect(present('kitchen-supply-order-detail-print')).toBe(expected.print);
    });

    it('confirms before issuing, then opens the sheet it just froze', async () => {
        const issuePurchaseOrder = jest.fn(async () =>
            purchaseOrder(1, {
                status: 'issued',
                issuedAt: '2026-08-17T10:00:00+00:00',
                recipientSnapshot: SNAPSHOT,
            }),
        );

        const { repositories } = await renderStubScreen(
            <SupplyOrderDetailScreen order={String(purchaseOrderId(1))} />,
            {
                session: kitchenManagerSession(),
                repositories: detailOverrides(purchaseOrder(1), { issuePurchaseOrder }),
            },
        );

        await untilVisible('kitchen-supply-order-detail-issue');

        fireEvent.press(screen.getByTestId('kitchen-supply-order-detail-issue'));
        await untilVisible('kitchen-supply-order-detail-issue-confirm');
        fireEvent.press(screen.getByTestId('kitchen-supply-order-detail-issue-confirm-action'));

        await waitFor(() => {
            expect(repositories.kitchenOps.issuePurchaseOrder).toHaveBeenCalledWith(
                purchaseOrderId(1),
            );
        });

        /*
         * §7's **Issue and print**, and the order of the two halves is the claim. The navigation
         * happens inside `onSuccess`, so the sheet is only ever reached once the server has frozen
         * the document — printing first would put a Draft-marked preview in somebody's hand and
         * leave the real one unprinted.
         */
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith(
                `/kitchen/supply-orders/print?orders=${encodeURIComponent(String(purchaseOrderId(1)))}`,
            );
        });
    });

    it('answers an identifier that is not one with the not-found state rather than a failure', async () => {
        await renderStubScreen(<SupplyOrderDetailScreen order="not-an-identifier" />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: {} },
        });

        await untilVisible('kitchen-supply-order-detail-not-found');

        // Nothing was fetched: a hand-typed link is a client-side answer, not a round trip.
        expect(screen.queryByTestId('kitchen-supply-order-detail-lines-table')).toBeNull();
    });
});
