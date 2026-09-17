import type {
    CompleteProductionOrderRequest,
    ProductionOrder,
    ProductionOrderDetail,
    ProductionOrderLine,
    ProductionOrderPage,
    ProductionPlan,
    ProductionTechnicalSheet,
} from '@healthy360/api-client/contracts';
import type { ProductionOrderId, StockItemId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';

import {
    KITCHEN_MANAGER_PERMISSIONS,
    TEST_BRANCH_ID,
    kitchenManagerSession,
    testActiveContext,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { ProductionBatchScreen } from './screens/production-batch-screen.tsx';
import { ProductionBatchSheetScreen } from './screens/production-batch-sheet-screen.tsx';
import { ProductionBatchesScreen } from './screens/production-batches-screen.tsx';
import { ProductionDeskScreen } from './screens/production-desk-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kitchen/production-desk',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The internal production desk (PROD1), against a batch book this file writes.
 *
 * What is asserted throughout is the **refusal to answer**: a count over a page that is not the
 * whole queue, a unit cost the valuation could not complete, an expiry date nobody recorded, and a
 * shelf quantity nobody retyped. Each of those has a wrong answer that looks perfectly reasonable —
 * a number, a zero, a blank — and each one would be read as a fact about the kitchen.
 */

const BATCH_ID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0001' as ProductionOrderId;
const FLOUR = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0002' as StockItemId;
const TRAY = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0003' as StockItemId;

function batch(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
    return {
        id: BATCH_ID,
        reference: 'PB-7K3MQ9ZV',
        branchId: TEST_BRANCH_ID,
        recipeVersionId:
            '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0004' as ProductionOrder['recipeVersionId'],
        productionItemIngredientId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0005',
        productionItemNameEn: 'Caesar dressing',
        plannedYieldUnitCode: 'l',
        status: 'draft',
        batchFactor: '2.000000',
        plannedYield: '20.0000',
        plannedYieldUnitId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0007',
        producedQuantity: null,
        rejectedQuantity: null,
        usableYieldQuantity: null,
        yieldVarianceQuantity: null,
        productionDate: null,
        batchReference: null,
        storageLocation: null,
        expiryDate: null,
        isExpired: false,
        confirmedAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        abandonedAt: null,
        abandonReason: null,
        lockVersion: 1,
        notes: null,
        ...overrides,
    };
}

function line(overrides: Partial<ProductionOrderLine> = {}): ProductionOrderLine {
    return {
        id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0009',
        stockItemId: FLOUR,
        ingredientId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0006',
        lineKind: 'ingredient',
        unitId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0008',
        stockItemCode: 'FLOUR-00',
        stockItemNameEn: 'Flour, plain',
        unitCode: 'kg',
        requiredQuantity: '8.0000',
        reservedQuantity: '8.0000',
        consumedQuantity: null,
        wasteQuantity: null,
        sourceRecipeVersionId: null,
        displayOrder: 1,
        ...overrides,
    };
}

function plan(overrides: Partial<ProductionPlan> = {}): ProductionPlan {
    return {
        batchFactor: '2.000000',
        ingredients: [
            {
                stockItemId: FLOUR,
                ingredientId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0006',
                lineKind: 'ingredient',
                unitId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0008',
                stockItemCode: 'FLOUR-00',
                stockItemNameEn: 'Flour, plain',
                unitCode: 'kg',
                required: '8.0000',
                onHand: '10.0000',
                reserved: '9.0000',
                available: '1.0000',
                missing: '7.0000',
            },
        ],
        packaging: [],
        notComputable: [{ reasonCode: 'no_stock_item', detail: 'Lemon juice has no shelf.' }],
        shortLineCount: 1,
        isConfirmable: false,
        ...overrides,
    };
}

function page(orders: readonly ProductionOrder[], hasMore = false): ProductionOrderPage {
    return { orders, page: 1, perPage: 50, hasMore, costsVisible: true };
}

function detail(overrides: Partial<ProductionOrderDetail> = {}): ProductionOrderDetail {
    return { order: batch(), lines: [], plan: plan(), costsVisible: true, ...overrides };
}

/** The manager, minus the one code that decides whether money is in the payload at all. */
function chefSession() {
    return kitchenManagerSession({
        activeContext: testActiveContext({
            permissions: KITCHEN_MANAGER_PERMISSIONS.filter(
                (code) => code !== 'production.view_costs_organisation',
            ),
        }),
    });
}

describe('the production desk queue', () => {
    it('shows what each batch makes by name, never by identifier', async () => {
        await renderStubScreen(<ProductionDeskScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: { listProductionOrders: async () => page([batch()]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId(`kitchen-production-batch-${BATCH_ID}-makes`)).toBeTruthy();
        });
        expect(screen.getByTestId(`kitchen-production-batch-${BATCH_ID}-makes`)).toHaveTextContent(
            'Caesar dressing',
        );
    });

    it('states nothing at all about a queue it has only seen one page of', async () => {
        await renderStubScreen(<ProductionDeskScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: { listProductionOrders: async () => page([batch()], true) },
            },
        });

        // Two drafts on screen out of who knows how many. "1" would be a claim about the kitchen
        // that nobody earned, so the tile shows the em dash instead.
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-desk-summary')).toBeTruthy();
        });
        expect(
            within(screen.getByTestId('kitchen-production-desk-summary')).getAllByText('—'),
        ).toHaveLength(4);
    });

    it('advances a draft on the version it was read at', async () => {
        const confirmProductionOrder = jest.fn(async () => detail());

        await renderStubScreen(<ProductionDeskScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listProductionOrders: async () => page([batch({ lockVersion: 4 })]),
                    confirmProductionOrder,
                },
            },
        });

        // Jest renders below `md`, so the row's one edge is behind the overflow — which is exactly
        // the width at which a hand-rolled action column would have vanished entirely.
        const trigger = `kitchen-production-desk-table-row-${BATCH_ID}-actions-trigger`;
        await waitFor(() => {
            expect(screen.getByTestId(trigger)).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId(trigger));
        fireEvent.press(await screen.findByTestId(`kitchen-production-batch-${BATCH_ID}-confirm`));

        // Two people share this queue; the version is what stops the second press re-confirming a
        // batch the first already moved.
        await waitFor(() => {
            expect(confirmProductionOrder).toHaveBeenCalledWith(BATCH_ID, 4);
        });
    });

    it('offers no one-click complete, because completing needs what came out', async () => {
        await renderStubScreen(<ProductionDeskScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listProductionOrders: async () => page([batch({ status: 'in_production' })]),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId(`kitchen-production-batch-${BATCH_ID}-status`)).toBeTruthy();
        });
        // No overflow at all rather than a disabled item: a batch in production *has* an edge, and
        // it is a form. Offering a greyed-out Complete would say there is nothing left to do.
        expect(
            screen.queryByTestId(`kitchen-production-desk-table-row-${BATCH_ID}-actions-trigger`),
        ).toBeNull();
    });
});

describe('one batch', () => {
    it('shows a draft its live plan, holes and all', async () => {
        await renderStubScreen(<ProductionBatchScreen order={BATCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getProductionOrder: async () => detail() } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-plan')).toBeTruthy();
        });
        // "Need nothing for that" and "we could not work out what this needs" are opposite
        // statements; the hole is its own notice rather than a zero in the table.
        expect(
            within(screen.getByTestId('kitchen-production-batch-plan-holes')).getByText(
                'Lemon juice has no shelf.',
            ),
        ).toBeTruthy();
        expect(screen.queryByTestId('kitchen-production-batch-lines')).toBeNull();
    });

    it('shows a confirmed batch its lines rather than a plan', async () => {
        await renderStubScreen(<ProductionBatchScreen order={BATCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getProductionOrder: async () =>
                        detail({
                            order: batch({
                                status: 'confirmed',
                                confirmedAt: '2026-09-14T09:00:00Z',
                            }),
                            lines: [line()],
                            plan: null,
                        }),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-lines')).toBeTruthy();
        });
        expect(
            within(screen.getByTestId('kitchen-production-batch-lines')).getByText('Flour, plain'),
        ).toBeTruthy();
        expect(screen.queryByTestId('kitchen-production-batch-plan')).toBeNull();
    });

    it('withholds the unit cost of a batch whose valuation could not complete', async () => {
        await renderStubScreen(<ProductionBatchScreen order={BATCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getProductionOrder: async () =>
                        detail({
                            order: batch({
                                status: 'completed',
                                producedQuantity: '38.0000',
                                rejectedQuantity: '1.0000',
                                usableYieldQuantity: '37.0000',
                                actualCostAmount: '52.000000',
                                actualCostCurrencyCode: 'AED',
                                actualUnitCostAmount: null,
                                actualCostStatus: 'partial',
                                valuationNote: 'Salt carried no moving average.',
                            }),
                            lines: [line()],
                            plan: null,
                        }),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-cost-unit')).toBeTruthy();
        });
        // A partial total reads exactly like a whole one and is smaller. "Withheld" is the only
        // honest thing to print, and the reason sits beside it.
        expect(screen.getByTestId('kitchen-production-batch-cost-unit')).toHaveTextContent(
            'Withheld',
        );
        expect(
            within(screen.getByTestId('kitchen-production-batch-cost-status')).getByText(
                'Salt carried no moving average.',
            ),
        ).toBeTruthy();
    });

    it('shows a chef every quantity and no money at all', async () => {
        await renderStubScreen(<ProductionBatchScreen order={BATCH_ID} />, {
            session: chefSession(),
            repositories: {
                kitchenOps: {
                    getProductionOrder: async () =>
                        detail({
                            order: batch({
                                status: 'completed',
                                producedQuantity: '38.0000',
                                usableYieldQuantity: '38.0000',
                            }),
                            lines: [line()],
                            plan: null,
                            costsVisible: false,
                        }),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-costs-hidden')).toBeTruthy();
        });
        expect(screen.queryByTestId('kitchen-production-batch-cost')).toBeNull();
        // The quantities are still theirs to read — a 403 on the whole page would blank the desk
        // for the person actually running the batch.
        expect(screen.getByTestId('kitchen-production-batch-yield-produced')).toHaveTextContent(
            '38.0000 l',
        );
    });

    it('sends only the shelves the cook retyped', async () => {
        const completeProductionOrder = jest.fn(
            async (
                _id: ProductionOrderId,
                _version: number,
                _request: CompleteProductionOrderRequest,
            ) => detail(),
        );

        await renderStubScreen(<ProductionBatchScreen order={BATCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getProductionOrder: async () =>
                        detail({
                            order: batch({ status: 'in_production', lockVersion: 3 }),
                            lines: [
                                line(),
                                line({
                                    id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e000a',
                                    stockItemId: TRAY,
                                    lineKind: 'packaging',
                                    stockItemNameEn: 'Tray, 1 litre',
                                    unitCode: 'pcs',
                                    requiredQuantity: '20.0000',
                                    reservedQuantity: '20.0000',
                                }),
                            ],
                            plan: null,
                        }),
                    completeProductionOrder,
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-complete')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('kitchen-production-batch-complete'));

        const produced = await screen.findByTestId(
            'kitchen-production-batch-settlement-produced-input',
        );
        fireEvent.changeText(produced, '19.5');
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-production-batch-settlement-produced-input').props
                    .value,
            ).toBe('19.5');
        });

        fireEvent.changeText(
            screen.getByTestId(`kitchen-production-batch-settlement-waste-${FLOUR}-input`),
            '0.5',
        );
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-production-batch-settlement-submit').props
                    .accessibilityState?.disabled,
            ).toBe(false);
        });
        fireEvent.press(screen.getByTestId('kitchen-production-batch-settlement-submit'));

        await waitFor(() => {
            expect(completeProductionOrder).toHaveBeenCalled();
        });
        const [, version, request] = completeProductionOrder.mock.calls[0] ?? [];
        expect(version).toBe(3);
        // The tray was not retyped, so it is absent rather than zero: a `consumed` of zero would
        // say the batch was packed into nothing.
        expect(request).toEqual({
            producedQuantity: 19.5,
            waste: { [FLOUR]: 0.5 },
            productionDate: expect.any(String) as unknown as string,
        });
    });
});

describe('the batch register', () => {
    it('never reads a missing use-by date as safe', async () => {
        await renderStubScreen(<ProductionBatchesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listProductionOrders: async () =>
                        page([
                            batch({
                                status: 'completed',
                                producedQuantity: '20.0000',
                                usableYieldQuantity: '20.0000',
                                expiryDate: null,
                            }),
                        ]),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batches-table')).toBeTruthy();
        });
        // Not a blank. A blank in a use-by column reads as "it is fine".
        expect(
            within(screen.getByTestId('kitchen-production-batches-table')).getByText(
                'Nobody recorded one',
            ),
        ).toBeTruthy();
        expect(screen.queryByTestId(`kitchen-production-batch-${BATCH_ID}-expired`)).toBeNull();
    });

    it('flags a batch that is past its date', async () => {
        await renderStubScreen(<ProductionBatchesScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    listProductionOrders: async () =>
                        page([
                            batch({
                                status: 'completed',
                                producedQuantity: '20.0000',
                                usableYieldQuantity: '20.0000',
                                expiryDate: '2026-09-01',
                                isExpired: true,
                            }),
                        ]),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId(`kitchen-production-batch-${BATCH_ID}-expired`)).toBeTruthy();
        });
    });
});

describe('the batch technical sheet', () => {
    it('reads the snapshot and says that the recipe sheet is the other question', async () => {
        const sheet: ProductionTechnicalSheet = {
            order: batch({
                status: 'completed',
                confirmedAt: '2026-09-14T09:00:00Z',
                producedQuantity: '19.5000',
                usableYieldQuantity: '19.5000',
            }),
            lines: [line({ consumedQuantity: '7.5000', wasteQuantity: '0.5000' })],
            yield: {
                plannedQuantity: '20.0000',
                producedQuantity: '19.5000',
                rejectedQuantity: null,
                usableQuantity: '19.5000',
                varianceQuantity: '-0.5000',
                unitId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0007',
            },
            nutritionFacts: { energy_kcal: 412, sodium_mg: null },
            basis: {
                recipeVersionId:
                    '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0004' as ProductionOrder['recipeVersionId'],
                confirmedAt: '2026-09-14T09:00:00Z',
                weeklyPricePublicationId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e000b',
            },
            costsVisible: true,
        };

        await renderStubScreen(<ProductionBatchSheetScreen order={BATCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getProductionTechnicalSheet: async () => sheet } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-sheet-basis')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-production-batch-sheet-publication')).toHaveTextContent(
            '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e000b',
        );
        // A withheld nutrient stays withheld. Zero would say the food contains none of it.
        expect(
            screen.getByTestId('kitchen-production-batch-sheet-nutrient-sodium_mg'),
        ).toHaveTextContent('—');
    });

    it('says a draft has no sheet rather than inventing an empty one', async () => {
        await renderStubScreen(<ProductionBatchSheetScreen order={BATCH_ID} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getProductionTechnicalSheet: async () => ({
                        order: batch(),
                        lines: [],
                        yield: {
                            plannedQuantity: '20.0000',
                            producedQuantity: null,
                            rejectedQuantity: null,
                            usableQuantity: null,
                            varianceQuantity: null,
                            unitId: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0007',
                        },
                        nutritionFacts: null,
                        basis: {
                            recipeVersionId:
                                '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e0004' as ProductionOrder['recipeVersionId'],
                            confirmedAt: null,
                            weeklyPricePublicationId: null,
                        },
                        costsVisible: true,
                    }),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-production-batch-sheet-unconfirmed')).toBeTruthy();
        });
    });
});
