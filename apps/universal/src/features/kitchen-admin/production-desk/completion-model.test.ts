import type { ProductionOrderLine } from '@healthy360/api-client/contracts';

import {
    abandonRequest,
    completionErrors,
    completionRequest,
    emptyCompletionDraft,
    hasCompletionErrors,
    orderedLines,
    readNumber,
    withLineQuantity,
} from './completion-model.ts';

/**
 * The completion report (PROD1).
 *
 * Every case here is about a **blank**, because that is where the form can lie. A blank under "what
 * went in" means the cook followed the recipe; a blank under "what went in the bin" means nothing
 * was binned; and the difference between sending `{}` and sending `{ shelf: 0 }` is the difference
 * between a batch cooked from its claims and a batch cooked out of thin air.
 */

const FLOUR = 'stock-flour';
const TRAY = 'stock-tray';

function line(overrides: Partial<ProductionOrderLine> = {}): ProductionOrderLine {
    return {
        id: 'line-1',
        stockItemId: FLOUR as ProductionOrderLine['stockItemId'],
        ingredientId: 'ingredient-flour',
        lineKind: 'ingredient',
        unitId: 'unit-kg',
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

describe('reading what somebody typed', () => {
    it('answers null for a blank rather than zero', () => {
        // The whole asymmetry rests on this: a blank is an absence of an answer, and zero is an
        // answer. Collapsing them here would collapse them everywhere downstream.
        expect(readNumber('')).toBeNull();
        expect(readNumber('   ')).toBeNull();
        expect(readNumber('0')).toBe(0);
    });

    it('answers null for text that is not a number, rather than NaN', () => {
        expect(readNumber('about eight')).toBeNull();
        expect(readNumber('1.')).toBe(1);
    });
});

describe('per-shelf quantities', () => {
    it('forgets a shelf when its box is emptied', () => {
        const typed = withLineQuantity(emptyCompletionDraft(), 'consumed', FLOUR, '7.5');
        const cleared = withLineQuantity(typed, 'consumed', FLOUR, '');

        expect(typed.consumed).toEqual({ [FLOUR]: '7.5' });
        // Not `{ flour: '' }`. Clearing a mistake must put the field back to meaning "as claimed",
        // not to meaning "used none of it".
        expect(cleared.consumed).toEqual({});
    });

    it('keeps consumed and waste apart', () => {
        let draft = emptyCompletionDraft();
        draft = withLineQuantity(draft, 'consumed', FLOUR, '7.5');
        draft = withLineQuantity(draft, 'waste', FLOUR, '0.5');

        expect(draft.consumed).toEqual({ [FLOUR]: '7.5' });
        expect(draft.waste).toEqual({ [FLOUR]: '0.5' });
    });
});

describe('what the form refuses to send', () => {
    it('will not complete without a produced quantity', () => {
        const errors = completionErrors(emptyCompletionDraft(), 'complete');

        expect(errors.produced).toBe('kitchen:ops.production.producedRequired');
        expect(hasCompletionErrors(errors)).toBe(true);
    });

    it('accepts nothing produced, because a lost batch is a real answer', () => {
        const draft = { ...emptyCompletionDraft(), produced: '0' };

        expect(hasCompletionErrors(completionErrors(draft, 'complete'))).toBe(false);
    });

    it('refuses more rejected than produced, because rejected is inside produced', () => {
        const draft = { ...emptyCompletionDraft(), produced: '38', rejected: '39' };

        expect(completionErrors(draft, 'complete').rejected).toBe(
            'kitchen:ops.production.rejectedTooHigh',
        );
    });

    it('demands a reason to abandon and not to complete', () => {
        const draft = { ...emptyCompletionDraft(), produced: '38' };

        expect(completionErrors(draft, 'complete').reason).toBeUndefined();
        expect(completionErrors(draft, 'abandon').reason).toBe(
            'kitchen:ops.production.abandonReasonRequired',
        );
    });
});

describe('the request body', () => {
    it('omits the shelves nobody touched, rather than sending them as zero', () => {
        const request = completionRequest({ ...emptyCompletionDraft(), produced: '38' });

        // `consumed: {}` would say the batch used none of its claims; omitting it says the cook
        // followed the recipe, which is what an untouched form means.
        expect(request).toEqual({ producedQuantity: 38 });
    });

    it('sends only the shelves somebody typed', () => {
        let draft = { ...emptyCompletionDraft(), produced: '38', rejected: '1' };
        draft = withLineQuantity(draft, 'consumed', FLOUR, '7.5');
        draft = withLineQuantity(draft, 'waste', FLOUR, '0.5');

        expect(completionRequest(draft)).toEqual({
            producedQuantity: 38,
            rejectedQuantity: 1,
            consumed: { [FLOUR]: 7.5 },
            waste: { [FLOUR]: 0.5 },
        });
    });

    it('drops a half-typed quantity rather than reading it as zero', () => {
        const draft = withLineQuantity(
            { ...emptyCompletionDraft(), produced: '38' },
            'consumed',
            FLOUR,
            'sev',
        );

        expect(completionRequest(draft).consumed).toBeUndefined();
    });

    it('trims the record fields and leaves the empty ones off', () => {
        const request = completionRequest({
            ...emptyCompletionDraft('2026-09-16'),
            produced: '38',
            storageLocation: '  Chill 2  ',
            expiryDate: '2026-09-23',
            notes: '   ',
        });

        expect(request).toEqual({
            producedQuantity: 38,
            productionDate: '2026-09-16',
            storageLocation: 'Chill 2',
            expiryDate: '2026-09-23',
        });
    });

    it('carries the reason when abandoning, and nothing else changes', () => {
        const draft = { ...emptyCompletionDraft(), produced: '4', reason: '  Chiller failed  ' };

        expect(abandonRequest(draft)).toEqual({ producedQuantity: 4, reason: 'Chiller failed' });
    });
});

describe('the order the form asks about shelves', () => {
    it('puts every ingredient before every lid', () => {
        const rows = orderedLines([
            line({
                id: 'l3',
                lineKind: 'packaging',
                stockItemId: TRAY as ProductionOrderLine['stockItemId'],
                displayOrder: 1,
            }),
            line({ id: 'l2', displayOrder: 2 }),
            line({ id: 'l1', displayOrder: 1 }),
        ]);

        // Interleaving them by one sort key would put a tray between two spices.
        expect(rows.map((row) => row.id)).toEqual(['l1', 'l2', 'l3']);
    });
});
