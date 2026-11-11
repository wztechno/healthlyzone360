import type { KitchenOrder, KitchenOrderLine } from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';

import {
    compareSlotKeys,
    cookList,
    datesSpan,
    dueInstant,
    groupBySlot,
    isLateOrder,
    isToCollect,
    lastOfMonth,
    localToday,
    matchesQuick,
    matchesSearch,
    matchesSlot,
    monthGrid,
    needsDriver,
    nextStep,
    orderDay,
    owedMinor,
    shiftMonth,
    slotKeyOf,
    windowHours,
} from './order-book.ts';
import type { BookRow } from './order-book.ts';

/**
 * The Orders page's rules, pinned as arithmetic: which day an order is on (the calendar's own rule,
 * so lists and counts agree), which slot, when it is late, what its next step is, and what is still
 * owed on it.
 */

function line(ordinal: number, overrides: Partial<KitchenOrderLine> = {}): KitchenOrderLine {
    return {
        id: `line-${String(ordinal)}`,
        catalogueItemId: `item-${String(ordinal)}`,
        catalogueItemVariantId: null,
        nameEn: `Dish ${String(ordinal)}`,
        nameAr: `طبق ${String(ordinal)}`,
        variantLabel: null,
        quantity: '1.000',
        unitPriceMinor: 500,
        lineTotalMinor: 500,
        currencyCode: 'USD',
        allergens: [],
        packSummary: null,
        priceListId: null,
        priceListItemId: null,
        ...overrides,
    };
}

function order(
    overrides: Omit<Partial<BookRow>, 'delivery'> & {
        readonly delivery?: Partial<KitchenOrder['delivery']>;
    } = {},
): BookRow {
    const { delivery, ...rest } = overrides;
    return {
        id: 'order-1' as OrderId,
        orderNumber: 'ORD-K7M2Q9XW4P',
        branchId: null,
        status: 'placed',
        currencyCode: 'USD',
        subtotalMinor: 1400,
        deliveryFeeMinor: 200,
        totalMinor: 1600,
        paymentMethod: 'cash_on_delivery',
        fulfilmentType: 'delivery',
        delivery: {
            label: null,
            lineOne: null,
            lineTwo: null,
            city: null,
            areaNameEn: 'Achrafieh',
            areaNameAr: null,
            areaId: null,
            windowCode: 'lunch',
            requestedDate: '2026-11-10',
            zoneId: null,
            ...delivery,
        },
        placedAt: '2026-11-09T10:00:00Z',
        confirmedAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 1,
        customerAccountId: null,
        amendable: true,
        allergy: null,
        lineCount: 1,
        lines: [line(1)],
        ...rest,
    };
}

const PENDING_JOB = {
    id: 'job-1',
    status: 'pending' as const,
    trackingStatus: 'awaiting_assignment' as const,
    driverUserId: null,
    assignedAt: null,
    lockVersion: 1,
};

const WINDOWS = [
    { code: 'lunch', nameEn: 'Lunch', nameAr: '', startsAt: '12:00:00', endsAt: '14:00:00' },
    { code: 'evening', nameEn: 'Dinner', nameAr: '', startsAt: '19:00:00', endsAt: null },
];

describe('orders — the day an order is on', () => {
    it('is the day asked for, else the UTC day it was placed — the calendar’s rule', () => {
        expect(orderDay(order())).toBe('2026-11-10');
        expect(
            orderDay(
                order({ delivery: { requestedDate: null }, placedAt: '2026-11-08T23:30:00Z' }),
            ),
        ).toBe('2026-11-08');
    });

    it('reads today on the device clock', () => {
        expect(localToday(new Date(2026, 10, 10, 23, 59))).toBe('2026-11-10');
    });

    it('draws a month as whole Monday-first weeks', () => {
        const grid = monthGrid('2026-11');
        expect(grid[0]).toBe('2026-10-26');
        expect(grid[grid.length - 1]).toBe('2026-12-06');
        expect(grid.length % 7).toBe(0);
        expect(shiftMonth('2026-12', 1)).toBe('2027-01');
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
        expect(lastOfMonth('2026-02')).toBe('2026-02-28');
    });

    it('turns a Dates choice into a span', () => {
        expect(datesSpan('all', '2026-11-10')).toBeNull();
        expect(datesSpan('week', '2026-11-10')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
        expect(datesSpan('next7', '2026-11-10')).toEqual({ from: '2026-11-10', to: '2026-11-16' });
        expect(datesSpan('last7', '2026-11-10')).toEqual({ from: '2026-11-04', to: '2026-11-10' });
        expect(datesSpan('month', '2026-11-10')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    });
});

describe('orders — the slot', () => {
    it('reads either name of a sitting as the sitting', () => {
        expect(slotKeyOf(order({ delivery: { windowCode: 'midday' } }))).toBe('lunch');
        expect(slotKeyOf(order({ delivery: { windowCode: 'lunch' } }))).toBe('lunch');
        expect(slotKeyOf(order({ delivery: { windowCode: 'brunch' } }))).toBe('code:brunch');
        expect(slotKeyOf(order({ delivery: { windowCode: null } }))).toBe('none');
        expect(matchesSlot(order({ delivery: { windowCode: 'midday' } }), 'lunch')).toBe(true);
        expect(matchesSlot(order({ delivery: { windowCode: 'evening' } }), 'lunch')).toBe(false);
    });

    it('orders the slots the way a day runs, other codes then no slot last', () => {
        const keys = ['none', 'dinner', 'code:brunch', 'breakfast', 'snack', 'lunch'];
        expect([...keys].sort(compareSlotKeys)).toEqual([
            'breakfast',
            'lunch',
            'snack',
            'dinner',
            'code:brunch',
            'none',
        ]);
    });

    it('groups a day by slot, cancelled orders last within one', () => {
        const groups = groupBySlot([
            order({ id: 'a' as OrderId, delivery: { windowCode: 'evening' } }),
            order({ id: 'b' as OrderId, status: 'cancelled' }),
            order({ id: 'c' as OrderId }),
        ]);
        expect(groups.map((group) => group.key)).toEqual(['lunch', 'dinner']);
        expect(groups[0]?.rows.map((row) => row.id)).toEqual(['c', 'b']);
    });

    it('says a window’s hours', () => {
        expect(windowHours(WINDOWS[0] ?? null)).toBe('12:00–14:00');
        expect(windowHours(WINDOWS[1] ?? null)).toBe('19:00');
        expect(windowHours(null)).toBeNull();
    });
});

describe('orders — late', () => {
    it('is open and past the slot’s start; a closed order is never late', () => {
        const lunch = order();
        const noon = new Date(2026, 10, 10, 12, 30);
        const morning = new Date(2026, 10, 10, 9, 0);
        expect(isLateOrder(lunch, noon, WINDOWS)).toBe(true);
        expect(isLateOrder(lunch, morning, WINDOWS)).toBe(false);
        expect(isLateOrder(order({ status: 'fulfilled' }), noon, WINDOWS)).toBe(false);
    });

    it('takes the server’s due time where the read carried one', () => {
        const row = order({ dueAt: '2026-11-10T08:00:00Z' });
        expect(dueInstant(row, WINDOWS)).toBe(Date.parse('2026-11-10T08:00:00Z'));
    });
});

describe('orders — the next step', () => {
    it('confirms a placed order', () => {
        expect(nextStep(order())).toBe('confirm');
    });

    it('asks for a driver on a confirmed delivery nobody has', () => {
        const row = order({ status: 'confirmed', deliveryJob: PENDING_JOB });
        expect(needsDriver(row)).toBe(true);
        expect(nextStep(row)).toBe('driver');
    });

    it('marks a delivery ready, then delivered, unless its run has failed', () => {
        const assigned = { ...PENDING_JOB, status: 'assigned' as const, driverUserId: 'driver-1' };
        expect(nextStep(order({ status: 'confirmed', deliveryJob: assigned }))).toBe('ready');
        expect(nextStep(order({ status: 'confirmed', deliveryJob: null }))).toBe('ready');
        expect(
            nextStep(
                order({
                    status: 'confirmed',
                    deliveryJob: assigned,
                    readyAt: '2026-11-10T11:00:00Z',
                }),
            ),
        ).toBe('deliver');
        expect(
            nextStep(
                order({
                    status: 'confirmed',
                    deliveryJob: assigned,
                    readyAt: '2026-11-10T11:00:00Z',
                    deliveryRun: {
                        status: 'failed',
                        trackingStatus: 'en_route',
                        driverName: 'Hadi',
                        assignedAt: null,
                        pickedUpAt: null,
                        deliveredAt: null,
                    },
                }),
            ),
        ).toBeNull();
    });

    it('hands a pickup over', () => {
        expect(nextStep(order({ status: 'confirmed', fulfilmentType: 'pickup' }))).toBe('pickup');
    });

    it('takes the money still owed on a closed order', () => {
        const owing = order({
            status: 'fulfilled',
            payment: { method: 'wish', receivedMinor: 600, receipted: false },
        });
        expect(owedMinor(owing)).toBe(1000);
        expect(isToCollect(owing)).toBe(true);
        expect(nextStep(owing)).toBe('payment');
        expect(nextStep(order({ status: 'fulfilled' }))).toBeNull();
    });

    it('counts money owed on an open order as to collect, without making it the next step', () => {
        const open = order({
            status: 'confirmed',
            fulfilmentType: 'pickup',
            payment: { method: 'cash_on_delivery', receivedMinor: 0, receipted: false },
        });
        expect(isToCollect(open)).toBe(true);
        expect(nextStep(open)).toBe('pickup');
        expect(
            isToCollect(
                order({
                    status: 'cancelled',
                    payment: { method: 'cash_on_delivery', receivedMinor: 0, receipted: false },
                }),
            ),
        ).toBe(false);
    });

    it('owes nothing on a cancelled order, and does not guess when the read said nothing', () => {
        expect(owedMinor(order({ status: 'cancelled' }))).toBe(0);
        expect(owedMinor(order())).toBeNull();
    });
});

describe('orders — search and the figures', () => {
    const row = order({ customer: { displayName: 'Rania Haddad', phone: '+961 70 214 380' } });

    it('finds by order number, name, or three digits of the phone', () => {
        expect(matchesSearch(row, 'k7m2')).toBe(true);
        expect(matchesSearch(row, 'rania')).toBe(true);
        expect(matchesSearch(row, '214')).toBe(true);
        expect(matchesSearch(row, '21')).toBe(false);
        expect(matchesSearch(row, '')).toBe(true);
    });

    it('counts each figure on its own rule', () => {
        const now = new Date(2026, 10, 10, 13, 0);
        expect(matchesQuick(row, 'confirm', now, WINDOWS)).toBe(true);
        expect(matchesQuick(row, 'late', now, WINDOWS)).toBe(true);
        expect(matchesQuick(row, 'driver', now, WINDOWS)).toBe(false);
        expect(matchesQuick(row, 'collect', now, WINDOWS)).toBe(false);
    });
});

describe('orders — what to cook', () => {
    it('adds the dishes up across orders, leaving out cancelled orders and a plan day’s own line', () => {
        const cook = cookList([
            order({ lines: [line(1, { quantity: '2.000' }), line(2)] }),
            order({ lines: [line(1)] }),
            order({ status: 'cancelled', lines: [line(3)] }),
            order({
                lines: [line(9, { nameEn: 'Plan day' }), line(2)],
                planDay: { planLineId: 'line-9', meals: [] },
            }),
        ]);
        expect(cook.map((entry) => [entry.nameEn, entry.quantity])).toEqual([
            ['Dish 1', 3],
            ['Dish 2', 2],
        ]);
    });
});
