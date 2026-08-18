import type {
    CursorPage,
    PurchaseLedgerLine,
    SpendSummary,
    SpendSummaryCurrencyTotals,
    SpendSummaryPeriod,
    StockItem,
    Supplier,
} from '@healthy360/api-client/contracts';
import { GoodsReceiptId, StockItemId, SupplierId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { PurchasesLedgerScreen } from './screens/purchases-ledger-screen.tsx';

/**
 * The purchases ledger and its two summary modes (INV1.1, SUP6), against a world this file authors.
 *
 * Nothing here stubs a hook: every row below is declared in this file and handed to
 * `renderStubScreen`, so a repository method the screen reaches for and this file did not declare
 * rejects with `StubNotConfiguredError` naming it rather than rendering an empty state over a hole.
 *
 * Six things this file exists to prove:
 *
 * 1. **Only the visible mode fetches.** Two modes of one screen must not cost two requests.
 * 2. **Switching modes keeps the filters.** A manager who narrowed to one supplier and then asked
 *    for the monthly total should not have to say "this supplier" twice.
 * 3. **A complete period and an incomplete one look different**, and the difference is a badge with
 *    its own icon plus a sentence — never colour alone.
 * 4. **Two currencies are two rows**, and there is no figure anywhere adding them.
 * 5. **A period with nothing priced shows no money at all.** §3.7: an unpriced line contributes to
 *    quantity history and not to money, and a zero there would read as a quiet week.
 * 6. **An empty range is a good state**, not an error and not a blank card.
 */

/*
 * The screen renders inside `Gate`, which imports `Redirect` from `expo-router`, which pulls in
 * `standard-navigation` — untranspiled ESM that this app's `transformIgnorePatterns` does not let
 * through, so the whole suite failed to load with "Cannot use import statement outside a module"
 * before a single test ran. Every other screen suite in the repo mocks the router for the same
 * reason; this one was the only one that did not.
 */
jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        setParams: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/kitchen/purchases',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
}));

const SUPPLIER_A = SupplierId.unsafe('01935f6d-0000-7000-8000-0000000000a1');
const ITEM_A = StockItemId.unsafe('01935f6d-0000-7000-8000-0000000000b1');

function supplier(): Supplier {
    return {
        id: SUPPLIER_A,
        code: 'SUP-A',
        name: { en: 'Gulf Fresh', ar: 'الخليج الطازج' },
        currencyCode: 'USD',
        contactEmail: null,
        contactPhone: null,
        address: null,
        paymentTerms: null,
        leadTimeDays: null,
        notes: null,
        archivedAt: null,
        contactCount: 0,
        suppliedItemCount: 1,
        primaryContact: null,
    };
}

function stockItem(): StockItem {
    return {
        id: ITEM_A,
        code: 'FLR-1',
        nameEn: 'Flour',
        unitCode: 'kg',
        ingredientId: null,
        catalogueItemId: null,
        backing: 'ingredient',
        isStocked: true,
        hasHistory: true,
    };
}

function ledgerLine(): PurchaseLedgerLine {
    return {
        id: '01935f6d-0000-7000-8000-0000000000c1',
        goodsReceiptId: GoodsReceiptId.unsafe('01935f6d-0000-7000-8000-0000000000d1'),
        receivedAt: '2026-07-27T09:00:00Z',
        receivedOn: '2026-07-27',
        supplier: { id: SUPPLIER_A, code: 'SUP-A', nameEn: 'Gulf Fresh' },
        documentRef: 'DN-1',
        purchaseOrderId: null,
        costStatus: 'complete',
        stockItemId: ITEM_A,
        itemCode: 'FLR-1',
        itemNameEn: 'Flour',
        ingredientId: null,
        quantity: '10.0000',
        unitId: null,
        unitPriceAmount: '2.500000',
        lineTotalAmount: '25.000000',
        costCurrencyCode: 'USD',
        valuationPendingFx: false,
        costsRedacted: false,
    };
}

function totals(overrides: Partial<SpendSummaryCurrencyTotals> = {}): SpendSummaryCurrencyTotals {
    return {
        currencyCode: 'USD',
        receiptCount: 1,
        receivedLineCount: 2,
        itemSubtotal: '30.000000',
        discountTotal: '2.000000',
        taxTotal: '1.500000',
        deliveryTotal: '5.000000',
        otherChargesTotal: '0.500000',
        invoiceTotal: '35.000000',
        invoicedReceiptCount: 1,
        bySupplier: null,
        byStockItem: null,
        ...overrides,
    };
}

function period(overrides: Partial<SpendSummaryPeriod> = {}): SpendSummaryPeriod {
    return {
        period: '2026-W31',
        periodStart: '2026-07-27',
        periodEnd: '2026-08-02',
        receiptCount: 1,
        unpricedReceiptCount: 0,
        unpricedLineCount: 0,
        valuationPendingLineCount: 0,
        isComplete: true,
        totalsByCurrency: [totals()],
        ...overrides,
    };
}

function summary(periods: readonly SpendSummaryPeriod[]): SpendSummary {
    return { groupBy: 'week', from: '2025-08-18', to: '2026-08-18', periods };
}

function ledgerPage(): CursorPage<PurchaseLedgerLine> {
    return { items: [ledgerLine()], nextCursor: null, hasMore: false, totalCount: null };
}

function overrides(extra: RepositoryOverrides['kitchenOps'] = {}): RepositoryOverrides {
    return {
        kitchenOps: {
            listSuppliers: async () => [supplier()],
            listStockItems: async () => [stockItem()],
            listPurchasesLedger: async () => ledgerPage(),
            ...extra,
        },
    };
}

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

describe('purchases ledger detail mode', () => {
    it('lists the lines and never asks the summary endpoint for a page it is not showing', async () => {
        const harness = await renderStubScreen(<PurchasesLedgerScreen />, {
            session: kitchenManagerSession(),
            repositories: overrides({ getSpendSummary: async () => summary([]) }),
        });

        await untilVisible('kitchen-purchases-ledger-table');

        expect(harness.repositories.kitchenOps.getSpendSummary).not.toHaveBeenCalled();
    });

    it('offers a price-completeness chip per state and asks the server for exactly one', async () => {
        const harness = await renderStubScreen(<PurchasesLedgerScreen />, {
            session: kitchenManagerSession(),
            repositories: overrides(),
        });

        await untilVisible('kitchen-purchases-ledger-table');

        // The three states are a closed set, so all three are offered and none is invented.
        expect(screen.getByTestId('kitchen-ledger-cost-status-unpriced')).toBeTruthy();
        expect(screen.getByTestId('kitchen-ledger-cost-status-partial')).toBeTruthy();
        expect(screen.getByTestId('kitchen-ledger-cost-status-complete')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ledger-cost-status-unpriced'));
        });

        await waitFor(() => {
            expect(harness.repositories.kitchenOps.listPurchasesLedger).toHaveBeenCalledWith(
                expect.objectContaining({ costStatus: 'unpriced' }),
            );
        });
    });
});

describe('purchases ledger summary modes', () => {
    it('shows a complete period with its money, and switching modes keeps the filters', async () => {
        const harness = await renderStubScreen(
            <PurchasesLedgerScreen supplier={String(SUPPLIER_A)} />,
            {
                session: kitchenManagerSession(),
                repositories: overrides({ getSpendSummary: async () => summary([period()]) }),
            },
        );

        await untilVisible('kitchen-purchases-ledger-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ledger-mode-weekly'));
        });

        await untilVisible('kitchen-ledger-period-2026-W31');

        // The deep-linked supplier survives the switch: one set of filters, two modes.
        await waitFor(() => {
            expect(harness.repositories.kitchenOps.getSpendSummary).toHaveBeenCalledWith(
                expect.objectContaining({ groupBy: 'week', supplierId: SUPPLIER_A }),
            );
        });

        // A regex, not a bare string: the badge carries its own icon glyph beside the word (which is
        // the point of §3 — never colour alone), and `toHaveTextContent` matches a string exactly.
        expect(screen.getByTestId('kitchen-ledger-period-2026-W31-state')).toHaveTextContent(
            /Complete/,
        );
        expect(screen.getByTestId('kitchen-ledger-period-2026-W31-USD-subtotal')).toHaveTextContent(
            '30.00 USD',
        );
        // Item spend and the invoiced total are two named figures, never one.
        expect(
            screen.getByTestId('kitchen-ledger-period-2026-W31-USD-invoice-total'),
        ).toHaveTextContent('35.00 USD');

        // The charges behind the difference are one press away, not on by default.
        expect(screen.queryByTestId('kitchen-ledger-period-2026-W31-USD-charges')).toBeNull();
        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-ledger-period-2026-W31-USD-charges-toggle'),
            );
        });
        await untilVisible('kitchen-ledger-period-2026-W31-USD-charges');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-ledger-mode-monthly'));
        });

        await waitFor(() => {
            expect(harness.repositories.kitchenOps.getSpendSummary).toHaveBeenCalledWith(
                expect.objectContaining({ groupBy: 'month', supplierId: SUPPLIER_A }),
            );
        });
    });

    it('opens straight into a summary from the deep link and separates two currencies', async () => {
        await renderStubScreen(<PurchasesLedgerScreen mode="monthly" />, {
            session: kitchenManagerSession(),
            repositories: overrides({
                getSpendSummary: async () =>
                    summary([
                        period({
                            period: '2026-07',
                            periodStart: '2026-07-01',
                            periodEnd: '2026-07-31',
                            totalsByCurrency: [
                                totals({ currencyCode: 'EUR', itemSubtotal: '12.000000' }),
                                totals({ currencyCode: 'USD', itemSubtotal: '30.000000' }),
                            ],
                        }),
                    ]),
            }),
        });

        await untilVisible('kitchen-ledger-period-2026-07');

        // Two rows, two figures, and nothing anywhere adding 12 and 30 — there is no
        // exchange rate in this system.
        expect(screen.getByTestId('kitchen-ledger-period-2026-07-EUR-subtotal')).toHaveTextContent(
            '12.00 EUR',
        );
        expect(screen.getByTestId('kitchen-ledger-period-2026-07-USD-subtotal')).toHaveTextContent(
            '30.00 USD',
        );
        expect(screen.queryByTestId('kitchen-purchases-ledger-table')).toBeNull();
    });

    it('shows an unpriced period as Incomplete with no money at all', async () => {
        await renderStubScreen(<PurchasesLedgerScreen mode="weekly" />, {
            session: kitchenManagerSession(),
            repositories: overrides({
                getSpendSummary: async () =>
                    summary([
                        period({
                            receiptCount: 1,
                            unpricedReceiptCount: 1,
                            unpricedLineCount: 2,
                            valuationPendingLineCount: 1,
                            isComplete: false,
                            totalsByCurrency: [],
                        }),
                    ]),
            }),
        });

        await untilVisible('kitchen-ledger-period-2026-W31');

        expect(screen.getByTestId('kitchen-ledger-period-2026-W31-state')).toHaveTextContent(
            /Incomplete/,
        );
        // The two counts are two different jobs and are said separately.
        expect(screen.getByTestId('kitchen-ledger-period-2026-W31-unpriced')).toBeTruthy();
        expect(screen.getByTestId('kitchen-ledger-period-2026-W31-pending-fx')).toBeTruthy();
        // No money row, rather than a zero that would read as a quiet week.
        expect(screen.getByTestId('kitchen-ledger-period-2026-W31-no-money')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-ledger-period-2026-W31-USD')).toBeNull();
    });

    it('treats a range with no deliveries as a good state', async () => {
        await renderStubScreen(<PurchasesLedgerScreen mode="weekly" />, {
            session: kitchenManagerSession(),
            repositories: overrides({ getSpendSummary: async () => summary([]) }),
        });

        await untilVisible('kitchen-purchases-ledger-summary-empty');

        expect(screen.queryByTestId('kitchen-purchases-ledger-error')).toBeNull();
    });
});
