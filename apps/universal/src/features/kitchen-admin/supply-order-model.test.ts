import type { OrderProposalItem } from '@healthy360/api-client/contracts';
import { BranchId, StockItemId, SupplierId } from '@healthy360/domain-types';

import {
    buildGroups,
    initialChoice,
    initialChoices,
    readQuantity,
    supplierChoices,
    toBatchPayload,
} from './supply-order-model.ts';
import type { SupplyOrderChoices, SupplyOrderSupplier } from './supply-order-model.ts';

/**
 * The supply-order builder's arithmetic and grouping (SUP3), tested without a screen.
 *
 * The distinction this file spends most of its length on is **blank is not an error**. A proposal
 * row with no usable par arrives with no suggestion, so the builder opens with an empty box on
 * every such row — that is the designed state. Blank and zero therefore exclude a row quietly;
 * a negative, a fifth decimal place or a typed word is a real mistake against that row. Getting
 * those two classes the wrong way round would either paint forty rows red on an ordinary queue or
 * silently swallow a quantity somebody meant.
 *
 * The other three claims: **quantities never become numbers** on the way through, **server order
 * survives grouping**, and **`toBatchPayload` is the same object the preview showed** — which is
 * the whole reason grouping is a function rather than JSX, and the seam slice 4 lands on.
 */

const BRANCH = BranchId.unsafe('01935f6d-0000-7000-8000-0000000ab001');

function itemId(ordinal: number): StockItemId {
    return StockItemId.unsafe(`01935f6d-0000-7000-8000-00000000e00${String(ordinal)}`);
}

function supplierId(ordinal: number): SupplierId {
    return SupplierId.unsafe(`01935f6d-0000-7000-8000-00000000f00${String(ordinal)}`);
}

function supplier(ordinal: number, isPreferred = false) {
    return {
        id: supplierId(ordinal),
        code: `SUP-0${String(ordinal)}`,
        nameEn: `Supplier ${String(ordinal)}`,
        nameAr: null,
        isPreferred,
        leadTimeDays: null,
    };
}

function row(ordinal: number, overrides: Partial<OrderProposalItem> = {}): OrderProposalItem {
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

describe('readQuantity', () => {
    it('treats a blank box and a typed zero as exclusions rather than mistakes', () => {
        // The single most consequential distinction in the model. Every row with no par opens
        // blank, so a blank that painted red would paint most of an ordinary queue red.
        expect(readQuantity('')).toEqual({ value: null, issue: 'blank', isError: false });
        expect(readQuantity('   ')).toEqual({ value: null, issue: 'blank', isError: false });
        expect(readQuantity('0')).toEqual({ value: null, issue: 'zero', isError: false });
        expect(readQuantity('0.0000')).toEqual({ value: null, issue: 'zero', isError: false });
    });

    it('refuses a negative, a word, a fifth decimal place and an overflowing quantity', () => {
        expect(readQuantity('-1')).toMatchObject({ issue: 'negative', isError: true });
        // Reported as negative rather than as too precise: the sign is the thing the person most
        // needs to know, so it is checked first.
        expect(readQuantity('-1.234567')).toMatchObject({ issue: 'negative', isError: true });
        expect(readQuantity('two')).toMatchObject({ issue: 'notANumber', isError: true });
        expect(readQuantity('1e3')).toMatchObject({ issue: 'notANumber', isError: true });
        expect(readQuantity('1.23456')).toMatchObject({ issue: 'tooPrecise', isError: true });
        // decimal(14,4) holds ten integer digits, so 1e10 is one too many.
        expect(readQuantity('10000000000')).toMatchObject({ issue: 'tooLarge', isError: true });
    });

    it('accepts a quantity at the precision boundary and hands back the typed string', () => {
        expect(readQuantity('0.1250')).toEqual({ value: '0.1250', issue: null, isError: false });
        // Never `Number()`d on the way through: a float round-trip is how 0.125 becomes
        // 0.12499999999999999, and a kitchen ordering an eighth of a kilo of saffron means it.
        expect(readQuantity(' 2.5 ').value).toBe('2.5');
        expect(typeof readQuantity('9999999999.9999').value).toBe('string');
        expect(readQuantity('9999999999.9999').issue).toBeNull();
    });
});

describe('initialChoices', () => {
    it('opens a row on its suggestion and its suggested supplier', () => {
        const suggested = row(1, {
            suggestedQuantity: '8.0000',
            suggestedQuantityBasis: 'par',
            suggestedSupplierId: supplierId(1),
        });

        expect(initialChoice(suggested)).toEqual({
            quantity: '8.0000',
            supplierId: supplierId(1),
            ordering: true,
        });
    });

    it('opens a row with no suggestion empty rather than at zero', () => {
        // Zero is a decision; empty is the absence of one. Prefilling zero would make "not
        // ordering" the default for exactly the rows that most need a human number.
        expect(initialChoice(row(2)).quantity).toBe('');
    });

    it('keeps what has already been typed when the proposal is re-read', () => {
        const first = row(1);
        const second = row(2);
        const typed: SupplyOrderChoices = {
            [String(first.stockItemId)]: { quantity: '4', supplierId: null, ordering: true },
        };

        const merged = initialChoices([first, second], typed);

        // What makes Add another item and Refresh non-destructive.
        expect(merged[String(first.stockItemId)]?.quantity).toBe('4');
        expect(merged[String(second.stockItemId)]?.quantity).toBe('');

        // A row that dropped out of the answer drops out of the state with it.
        expect(Object.keys(initialChoices([second], merged))).toEqual([String(second.stockItemId)]);
    });
});

describe('buildGroups', () => {
    it('groups by chosen supplier and preserves the order the server sent', () => {
        const one = row(1, { supplierOptions: [supplier(2)] });
        const two = row(2, { supplierOptions: [supplier(1)] });
        const three = row(3, { supplierOptions: [supplier(2)] });

        const choices: SupplyOrderChoices = {
            [String(one.stockItemId)]: { quantity: '1', supplierId: supplierId(2), ordering: true },
            [String(two.stockItemId)]: { quantity: '2', supplierId: supplierId(1), ordering: true },
            [String(three.stockItemId)]: {
                quantity: '3',
                supplierId: supplierId(2),
                ordering: true,
            },
        };

        const plan = buildGroups([one, two, three], choices);

        // Supplier 2 first because row 1 chose it first — never alphabetical, never by size. The
        // print sheet reads this order, and a person who worked the list top to bottom has to
        // recognise the document that comes out of it.
        expect(plan.groups.map((group) => String(group.supplier.id))).toEqual([
            String(supplierId(2)),
            String(supplierId(1)),
        ]);
        expect(plan.groups[0]?.lines.map((line) => line.row.itemCode)).toEqual([
            'ITM-01',
            'ITM-03',
        ]);
        expect(plan.groups[0]?.lines.map((line) => line.quantity)).toEqual(['1', '3']);
        expect(plan.lineCount).toBe(3);
        expect(plan.unassigned).toEqual([]);
        expect(plan.excluded).toEqual([]);
    });

    it('keeps rows with no supplier out of excluded, because they are a job left undone', () => {
        const assigned = row(1, { supplierOptions: [supplier(1)] });
        const noSupplier = row(2, { unassignedReason: 'noSupplier' });
        const switchedOff = row(3, { supplierOptions: [supplier(1)] });
        const blank = row(4, { supplierOptions: [supplier(1)] });
        const wrong = row(5, { supplierOptions: [supplier(1)] });

        const plan = buildGroups([assigned, noSupplier, switchedOff, blank, wrong], {
            [String(assigned.stockItemId)]: {
                quantity: '1',
                supplierId: supplierId(1),
                ordering: true,
            },
            [String(noSupplier.stockItemId)]: { quantity: '5', supplierId: null, ordering: true },
            [String(switchedOff.stockItemId)]: {
                quantity: '9',
                supplierId: supplierId(1),
                ordering: false,
            },
            [String(blank.stockItemId)]: {
                quantity: '',
                supplierId: supplierId(1),
                ordering: true,
            },
            [String(wrong.stockItemId)]: {
                quantity: '-3',
                supplierId: supplierId(1),
                ordering: true,
            },
        });

        // Two buckets, on purpose. Lumping "nobody to buy it from" in with "you switched it off"
        // would let somebody tick past four shelves they still need.
        expect(plan.unassigned.map((item) => item.itemCode)).toEqual(['ITM-02']);
        expect(plan.excluded).toEqual([
            { row: switchedOff, reason: 'notOrdering' },
            { row: blank, reason: 'noQuantity' },
            { row: wrong, reason: 'invalidQuantity' },
        ]);
        expect(plan.lineCount).toBe(1);
    });

    it('resolves a supplier the row was never linked to, from the book', () => {
        // Region B: a shelf with no links may still be assigned any active supplier.
        const unlinked = row(1, { unassignedReason: 'noSupplier' });
        const directory: readonly SupplyOrderSupplier[] = [
            { id: supplierId(7), code: 'SUP-07', nameEn: 'Book supplier', nameAr: null },
        ];

        const plan = buildGroups(
            [unlinked],
            {
                [String(unlinked.stockItemId)]: {
                    quantity: '2.5',
                    supplierId: supplierId(7),
                    ordering: true,
                },
            },
            directory,
        );

        expect(plan.groups).toHaveLength(1);
        expect(plan.groups[0]?.supplier.nameEn).toBe('Book supplier');
    });

    it('leaves a row unassigned when its chosen supplier cannot be named', () => {
        // A stale id — a supplier archived while the screen was open. Better unassigned than a
        // preview header naming a supplier it cannot describe.
        const stale = row(1);
        const plan = buildGroups([stale], {
            [String(stale.stockItemId)]: {
                quantity: '1',
                supplierId: supplierId(9),
                ordering: true,
            },
        });

        expect(plan.groups).toEqual([]);
        expect(plan.unassigned).toEqual([stale]);
    });

    it('falls back to the row default for a row it was given no choice for', () => {
        const defaulted = row(1, {
            suggestedQuantity: '6.0000',
            suggestedSupplierId: supplierId(1),
            supplierOptions: [supplier(1, true)],
        });

        const plan = buildGroups([defaulted], {});

        expect(plan.lineCount).toBe(1);
        expect(plan.groups[0]?.lines[0]?.quantity).toBe('6.0000');
    });
});

describe('supplierChoices', () => {
    it('puts the row’s own options first and dedupes the book behind them', () => {
        const linked = supplier(1, true);
        const target = row(1, { supplierOptions: [linked] });
        const directory: readonly SupplyOrderSupplier[] = [
            { id: supplierId(1), code: 'SUP-01', nameEn: 'Duplicate', nameAr: null },
            { id: supplierId(2), code: 'SUP-02', nameEn: 'Other', nameAr: null },
        ];

        const choices = supplierChoices(target, directory);

        // The linked entry wins the duplicate, because it is the one carrying the preferred flag.
        expect(choices.map((option) => option.nameEn)).toEqual(['Supplier 1', 'Other']);
    });
});

describe('toBatchPayload', () => {
    it('turns the preview into exactly the request slice 4 will send', () => {
        const one = row(1, { supplierOptions: [supplier(1)] });
        const two = row(2, { supplierOptions: [supplier(1)] });

        const plan = buildGroups([one, two], {
            [String(one.stockItemId)]: {
                quantity: '1.5',
                supplierId: supplierId(1),
                ordering: true,
            },
            [String(two.stockItemId)]: {
                quantity: '0.1250',
                supplierId: supplierId(1),
                ordering: true,
            },
        });

        expect(toBatchPayload(plan)).toEqual({
            orders: [
                {
                    supplierId: supplierId(1),
                    // Taken off the rows rather than passed in, so a payload whose branch
                    // disagreed with its lines is unrepresentable.
                    branchId: BRANCH,
                    lines: [
                        { stockItemId: itemId(1), quantity: '1.5' },
                        { stockItemId: itemId(2), quantity: '0.1250' },
                    ],
                },
            ],
        });
    });

    it('carries no price, cost or currency of any kind', () => {
        const only = row(1, { supplierOptions: [supplier(1)] });
        const payload = toBatchPayload(
            buildGroups([only], {
                [String(only.stockItemId)]: {
                    quantity: '2',
                    supplierId: supplierId(1),
                    ordering: true,
                },
            }),
        );

        // Structural: there will never be a price on a purchase order, because what a delivery
        // cost belongs to the receipt that recorded it.
        expect(JSON.stringify(payload)).not.toMatch(/price|cost|currency|amount|total/i);
    });
});
