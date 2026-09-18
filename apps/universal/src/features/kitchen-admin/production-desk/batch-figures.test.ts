import type { ProductionOrder, ProductionOrderStatus } from '@healthy360/api-client/contracts';

import { isProductionOrderOpen, nextProductionEdge } from '../ops-format.ts';
import { countByStatus, countExpired, countUnvalued, yieldSummary } from './batch-figures.ts';

/**
 * The desk's arithmetic (PROD1).
 *
 * One idea runs through every case: a count over a page is not a count over the queue, and an
 * unknown is not a zero. What is asserted here is the refusal to answer.
 */

function batch(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
    return {
        id: 'order-1' as ProductionOrder['id'],
        reference: 'PB-7K3MQ9ZV',
        branchId: 'branch-1' as ProductionOrder['branchId'],
        recipeVersionId: 'version-1' as ProductionOrder['recipeVersionId'],
        productionItemIngredientId: 'ingredient-1',
        productionItemNameEn: 'Caesar dressing',
        plannedYieldUnitCode: 'l',
        status: 'confirmed',
        batchFactor: '2.000000',
        plannedYield: '40.0000',
        plannedYieldUnitId: 'unit-1',
        producedQuantity: null,
        rejectedQuantity: null,
        usableYieldQuantity: null,
        yieldVarianceQuantity: null,
        productionDate: null,
        batchReference: null,
        storageLocation: null,
        expiryDate: null,
        isExpired: false,
        confirmedAt: '2026-09-18T08:00:00+00:00',
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

describe('counts over a page', () => {
    it('counts a state when the page is the whole queue', () => {
        const rows = [batch(), batch({ status: 'draft' }), batch()];

        expect(countByStatus(rows, 'confirmed', false)).toBe(2);
        expect(countByStatus(rows, 'draft', false)).toBe(1);
    });

    it('refuses to count when the server says there is more', () => {
        const rows = [batch(), batch({ status: 'draft' })];

        // Two on this page is not two in the kitchen, and a tile that said so
        // would be a fact somebody acted on. The em dash is the honest render.
        expect(countByStatus(rows, 'confirmed', true)).toBeNull();
        expect(countExpired(rows, true)).toBeNull();
        expect(countUnvalued(rows, true)).toBeNull();
    });
});

describe('the unvalued count', () => {
    it('counts batches whose cost nobody could compute', () => {
        const rows = [
            batch({ status: 'completed', actualCostStatus: 'complete' }),
            batch({ status: 'completed', actualCostStatus: 'partial' }),
            batch({ status: 'abandoned', actualCostStatus: null }),
        ];

        // `partial` and `null` both mean the figure cannot be trusted; only
        // `complete` is a cost.
        expect(countUnvalued(rows, false)).toBe(2);
    });

    it('says nothing at all to a reader who may not see costs', () => {
        // Without `production.view_costs_organisation` the key is **absent**, not
        // null — so the tile shows an em dash rather than claiming every batch is
        // valued.
        const rows = [batch({ status: 'completed' }), batch({ status: 'completed' })];

        expect(countUnvalued(rows, false)).toBeNull();
    });
});

describe('the expiry count', () => {
    it('counts what is past its date', () => {
        const rows = [batch({ isExpired: true }), batch({ isExpired: false })];

        expect(countExpired(rows, false)).toBe(1);
    });

    it('never counts a batch nobody gave a date', () => {
        // "Nobody recorded one" is not "it is fine" and not "it has gone off".
        // The server answers `isExpired: false` for a null date, and treating
        // that as safe is the register's job to avoid — it shows the em dash in
        // the date column, which is where the unknown belongs.
        const rows = [batch({ expiryDate: null, isExpired: false })];

        expect(countExpired(rows, false)).toBe(0);
    });
});

describe('the yield summary', () => {
    it('says nothing before a batch has been settled', () => {
        // Null, not "0" — a batch mid-cook has produced nothing *yet*, which is a
        // different statement from a batch that produced nothing.
        expect(yieldSummary(batch())).toBeNull();
    });

    it('states one figure when nothing was rejected', () => {
        expect(
            yieldSummary(batch({ producedQuantity: '38.0000', usableYieldQuantity: '38.0000' })),
        ).toBe('38.0000 l');
    });

    it('states both when they differ, because that is when something was thrown away', () => {
        expect(
            yieldSummary(
                batch({
                    producedQuantity: '38.0000',
                    rejectedQuantity: '1.0000',
                    usableYieldQuantity: '37.0000',
                }),
            ),
        ).toBe('37.0000 / 38.0000 l');
    });
});

describe('what a row may do', () => {
    it('treats a draft as open work rather than filing it in the register', () => {
        // A batch nobody confirmed is still a decision waiting to be made.
        expect(isProductionOrderOpen('draft')).toBe(true);
        expect(isProductionOrderOpen('confirmed')).toBe(true);
        expect(isProductionOrderOpen('in_production')).toBe(true);
        expect(isProductionOrderOpen('completed')).toBe(false);
        expect(isProductionOrderOpen('cancelled')).toBe(false);
        expect(isProductionOrderOpen('abandoned')).toBe(false);
    });

    it('offers no one-click complete, because completing needs what came out', () => {
        expect(nextProductionEdge('draft')).toBe('confirm');
        expect(nextProductionEdge('confirmed')).toBe('start');
        // A one-click complete would have to invent a produced quantity.
        expect(nextProductionEdge('in_production')).toBeNull();
        expect(nextProductionEdge('completed')).toBeNull();
    });
});

describe('the status vocabulary is complete', () => {
    it('answers for every state the contract names', () => {
        const all: readonly ProductionOrderStatus[] = [
            'draft',
            'confirmed',
            'in_production',
            'completed',
            'cancelled',
            'abandoned',
        ];

        // A seventh state added upstream must break here rather than silently
        // render as neither open nor closed.
        for (const status of all) {
            expect(typeof isProductionOrderOpen(status)).toBe('boolean');
        }
    });
});
