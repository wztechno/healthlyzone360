import type { KitchenOrder } from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';

import type { BasketLine } from './order-desk/basket.ts';
import {
    MAX_LINE_QUANTITY,
    addItem,
    addQuantity,
    basketKey,
    basketLineCount,
    isQuotableBasket,
    isSellableQuantity,
    lineKey,
    quantityAsNumber,
    quantityFromNumber,
    removeLine,
    setQuantity,
    toWire,
} from './order-desk/basket.ts';
import type { SaleState } from './order-desk/sale-state.ts';
import {
    defaultPaymentMethodFor,
    firstOpenDay,
    initialSaleState,
    isCounterPaymentComplete,
    needsAddress,
    needsCustomer,
    offeredDeskWindows,
    paymentMethodsFor,
    saleShortfall,
    saleStateFromOrder,
    scheduleFor,
    windowsOverAt,
    withCustomer,
    withFulfilmentType,
    withPaymentMethod,
} from './order-desk/sale-state.ts';

/**
 * The desk sale's two pure models.
 *
 * These are tested apart from the screen deliberately. Every rule here is a **refusal the wire would
 * otherwise return** — a payment block on a delivery, an address on a counter sale, a line the
 * server merges differently from the basket on screen — and a rule proved only through a rendered
 * component is one that gets quietly lost the next time the layout changes.
 */

const ITEM = 'item-0001';
const OTHER_ITEM = 'item-0002';
const PACK = 'variant-0001';

function line(overrides: Partial<BasketLine> = {}): BasketLine {
    return {
        catalogueItemId: ITEM,
        catalogueItemVariantId: null,
        quantity: '1',
        name: { en: 'Flat white', ar: 'فلات وايت' },
        variantLabel: null,
        ...overrides,
    };
}

function counterState(overrides: Partial<SaleState> = {}): SaleState {
    return { ...initialSaleState(), ...overrides };
}

/* ------------------------------------------------------------------------------------------------
 * Shape
 * ---------------------------------------------------------------------------------------------- */

describe('desk sale — what each kind of sale asks for', () => {
    it('asks a counter sale for nobody and nowhere', () => {
        expect(needsCustomer('counter')).toBe(false);
        expect(needsAddress('counter')).toBe(false);
    });

    it('asks a collection whose it is, but not where it goes', () => {
        expect(needsCustomer('pickup')).toBe(true);
        expect(needsAddress('pickup')).toBe(false);
    });

    it('asks a delivery for both', () => {
        expect(needsCustomer('delivery')).toBe(true);
        expect(needsAddress('delivery')).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Clearing — every one of these is a 422 or a 409 the wire would answer
 * ---------------------------------------------------------------------------------------------- */

describe('desk sale — what changing the kind clears', () => {
    it('drops the customer and the address when a delivery becomes a counter sale', () => {
        const delivery = withFulfilmentType(counterState(), 'delivery');
        const named = {
            ...withCustomer(delivery, 'account-1'),
            customerAddressId: 'address-1',
        };

        const counter = withFulfilmentType(named, 'counter');

        // A counter body carrying an address is refused `address_not_applicable`, and the page has
        // no card on which the agent could see the customer it was still sending.
        expect(counter.customerAddressId).toBeNull();
        expect(counter.customerAccountId).toBeNull();
    });

    it('drops only the address when a delivery becomes a pickup', () => {
        const named = {
            ...withCustomer(withFulfilmentType(counterState(), 'delivery'), 'account-1'),
            customerAddressId: 'address-1',
        };

        const pickup = withFulfilmentType(named, 'pickup');

        expect(pickup.customerAddressId).toBeNull();
        // A pickup needs exactly the customer a delivery does — re-searching would be a punishment
        // for changing one's mind.
        expect(pickup.customerAccountId).toBe('account-1');
    });

    it('creates the payment block on a counter sale and destroys it on the other two', () => {
        const counter = counterState();
        expect(counter.payment).not.toBeNull();
        expect(counter.paymentMethod).toBe('cash_at_counter');

        const delivery = withFulfilmentType(counter, 'delivery');
        // Prohibited on a delivery: sending it is a 422.
        expect(delivery.payment).toBeNull();
        expect(delivery.paymentMethod).toBe('cash_on_delivery');

        const back = withFulfilmentType(delivery, 'counter');
        // Required on a counter sale: omitting it is also a 422.
        expect(back.payment).not.toBeNull();
    });

    it('re-defaults the method to one that names something real about the new shape', () => {
        // A collection is settled at the counter when the customer arrives, not at a door.
        const pickup = withFulfilmentType(counterState(), 'pickup');
        expect(pickup.paymentMethod).toBe('cash_at_counter');
        expect(paymentMethodsFor('pickup')).toEqual(['cash_at_counter', 'wish']);

        // And "cash at the counter" is not a thing that can happen to a delivery.
        expect(paymentMethodsFor('delivery')).toEqual(['cash_on_delivery', 'wish']);
        expect(paymentMethodsFor('counter')).toEqual(['cash_at_counter', 'wish']);

        // The default is always the first offered, so the two can never drift apart.
        for (const type of ['counter', 'pickup', 'delivery'] as const) {
            expect(paymentMethodsFor(type)).toContain(defaultPaymentMethodFor(type));
        }
    });

    it('never clears the basket, because the same food is being sold either way', () => {
        const withLines = { ...counterState(), lines: [line()] };
        expect(withFulfilmentType(withLines, 'delivery').lines).toHaveLength(1);
        expect(
            withFulfilmentType(withFulfilmentType(withLines, 'pickup'), 'counter').lines,
        ).toHaveLength(1);
    });

    it('returns the same object when the kind has not moved', () => {
        const state = counterState();
        expect(withFulfilmentType(state, 'counter')).toBe(state);
    });

    it('drops an address that belonged to the previous customer', () => {
        const state = {
            ...withCustomer(withFulfilmentType(counterState(), 'delivery'), 'account-1'),
            customerAddressId: 'address-1',
        };

        // An address must belong to the named account — one that does not is a 404, deliberately
        // indistinguishable from "no such address".
        expect(withCustomer(state, 'account-2').customerAddressId).toBeNull();
        expect(withCustomer(state, 'account-1')).toBe(state);
    });

    it('moves the till receipt with the method on a counter sale, keeping a typed reference', () => {
        const wish = withPaymentMethod(counterState(), 'wish');
        expect(wish.paymentMethod).toBe('wish');
        expect(wish.payment?.method).toBe('wish');

        const typed = {
            ...wish,
            payment: { method: 'wish' as const, reference: 'WSH-1', notes: '' },
        };
        expect(
            withPaymentMethod(withPaymentMethod(typed, 'cash_at_counter'), 'wish').payment,
        ).toEqual({ method: 'wish', reference: 'WSH-1', notes: '' });

        // No receipt appears on a sale that forbids one.
        expect(
            withPaymentMethod(withFulfilmentType(counterState(), 'pickup'), 'wish').payment,
        ).toBeNull();
    });

    it('keeps the driver only on a delivery, which is the only sale with a run', () => {
        const delivery = {
            ...withFulfilmentType(counterState(), 'delivery'),
            driverUserId: 'user-1',
        };

        // The wire refuses `driver_user_id` on anything but a delivery.
        expect(withFulfilmentType(delivery, 'pickup').driverUserId).toBeNull();
        expect(withFulfilmentType(delivery, 'counter').driverUserId).toBeNull();
        expect(initialSaleState().driverUserId).toBeNull();
    });

    it('keeps the day and slot between pickup and delivery and drops them on a counter sale', () => {
        const delivery = {
            ...withFulfilmentType(counterState(), 'delivery'),
            requestedDeliveryDate: '2026-10-09',
            deliveryWindowCode: 'evening',
        };

        const pickup = withFulfilmentType(delivery, 'pickup');
        expect(pickup.requestedDeliveryDate).toBe('2026-10-09');
        expect(pickup.deliveryWindowCode).toBe('evening');

        // A counter sale is handed over now and is never slotted.
        const counter = withFulfilmentType(delivery, 'counter');
        expect(counter.requestedDeliveryDate).toBeNull();
        expect(counter.deliveryWindowCode).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Schedule
 * ---------------------------------------------------------------------------------------------- */

describe('desk sale — the schedule a sale is placed for', () => {
    const TODAY = '2026-10-07';

    it('sends nothing on a counter sale', () => {
        expect(scheduleFor(counterState(), TODAY, ['midday'])).toBeNull();
    });

    it('defaults to today and the checkout’s midday slot when the kitchen offers it', () => {
        const pickup = withFulfilmentType(counterState(), 'pickup');

        expect(scheduleFor(pickup, TODAY, ['morning', 'midday', 'evening'])).toEqual({
            requestedDeliveryDate: TODAY,
            deliveryWindowCode: 'midday',
        });
        // No midday: the kitchen's first window, in its own display order.
        expect(scheduleFor(pickup, TODAY, ['evening', 'morning'])?.deliveryWindowCode).toBe(
            'evening',
        );
        // No windows at all: no slot is sent, rather than a code nothing answers to.
        expect(scheduleFor(pickup, TODAY, [])?.deliveryWindowCode).toBeNull();
    });

    it('keeps what the agent chose, unless the kitchen no longer offers that slot', () => {
        const delivery = {
            ...withFulfilmentType(counterState(), 'delivery'),
            requestedDeliveryDate: '2026-10-09',
            deliveryWindowCode: 'evening',
        };

        expect(scheduleFor(delivery, TODAY, ['midday', 'evening'])).toEqual({
            requestedDeliveryDate: '2026-10-09',
            deliveryWindowCode: 'evening',
        });
        expect(scheduleFor(delivery, TODAY, ['midday'])?.deliveryWindowCode).toBe('midday');
    });

    it('never defaults to a slot that is already over today', () => {
        const pickup = withFulfilmentType(counterState(), 'pickup');

        // Midday is over: the next open window instead.
        expect(
            scheduleFor(
                pickup,
                TODAY,
                ['morning', 'midday', 'evening'],
                new Set(['morning', 'midday']),
            ),
        ).toEqual({ requestedDeliveryDate: TODAY, deliveryWindowCode: 'evening' });
        // Everything today is over: tomorrow, at the default.
        const tomorrow = scheduleFor(
            pickup,
            '2026-10-12',
            ['morning', 'midday'],
            new Set(['morning', 'midday']),
        );
        expect(tomorrow).toEqual({
            requestedDeliveryDate: '2026-10-13',
            deliveryWindowCode: 'midday',
        });
    });

    it('drops a chosen slot that is over today, but keeps it on another day', () => {
        // Breakfast chosen, then the clock passed 10:00 — 3 PM, only Snack and Dinner are left.
        const breakfast = {
            ...withFulfilmentType(counterState(), 'delivery'),
            deliveryWindowCode: 'morning',
        };
        const offered = ['morning', 'midday', 'afternoon', 'evening'];
        const over = new Set(['morning', 'midday']);

        expect(scheduleFor(breakfast, TODAY, offered, over)).toEqual({
            requestedDeliveryDate: TODAY,
            deliveryWindowCode: 'afternoon',
        });
        // Tomorrow's Breakfast has not ended.
        expect(
            scheduleFor(
                { ...breakfast, requestedDeliveryDate: '2026-10-08' },
                TODAY,
                offered,
                over,
            ),
        ).toEqual({ requestedDeliveryDate: '2026-10-08', deliveryWindowCode: 'morning' });
    });

    it('moves a sale the agent set for today to tomorrow once every slot today is over', () => {
        const today = {
            ...withFulfilmentType(counterState(), 'pickup'),
            requestedDeliveryDate: TODAY,
        };

        expect(
            scheduleFor(today, TODAY, ['morning', 'midday'], new Set(['morning', 'midday'])),
        ).toEqual({ requestedDeliveryDate: '2026-10-08', deliveryWindowCode: 'midday' });
    });

    it('starts the date picker tomorrow only when no slot is left today', () => {
        expect(firstOpenDay(TODAY, ['morning', 'evening'], new Set(['morning']))).toBe(TODAY);
        expect(firstOpenDay(TODAY, ['morning', 'evening'], new Set(['morning', 'evening']))).toBe(
            '2026-10-08',
        );
        // A kitchen with no slots never closes the day.
        expect(firstOpenDay(TODAY, [], new Set())).toBe(TODAY);
    });

    it('reads which windows have ended from their end time', () => {
        const at = new Date(2026, 9, 12, 21, 50);
        const over = windowsOverAt(
            [
                { code: 'midday', endsAt: '15:00:00' },
                { code: 'evening', endsAt: '22:00:00' },
                { code: 'open', endsAt: null },
            ],
            at,
        );
        expect([...over]).toEqual(['midday']);
    });

    it('lists the slots in the order of the day, whatever order the kitchen created them in', () => {
        // The kitchen's own order: Snack was added after Dinner.
        const windows = [
            { code: 'morning', startsAt: '08:00:00' },
            { code: 'midday', startsAt: '12:00:00' },
            { code: 'open', startsAt: null },
            { code: 'evening', startsAt: '18:00:00' },
            { code: 'afternoon', startsAt: '15:00:00' },
        ];

        expect(offeredDeskWindows(windows, null).map((window) => window.code)).toEqual([
            'morning',
            'midday',
            'afternoon',
            'evening',
            'open',
        ]);
        // Narrowed to the zone's slots, still in that order.
        expect(
            offeredDeskWindows(windows, ['evening', 'afternoon', 'morning']).map(
                (window) => window.code,
            ),
        ).toEqual(['morning', 'afternoon', 'evening']);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Completeness
 * ---------------------------------------------------------------------------------------------- */

describe('desk sale — what still stands between the page and the place button', () => {
    it('asks a counter sale only for something to sell', () => {
        expect(saleShortfall(counterState())).toBe('items');
        expect(saleShortfall({ ...counterState(), lines: [line()] })).toBeNull();
        // A zero-quantity row would be a 422 the agent cannot act on.
        expect(saleShortfall({ ...counterState(), lines: [line({ quantity: '0' })] })).toBe(
            'items',
        );
    });

    it('asks for the customer, then the address, in the order the page shows them', () => {
        const delivery = { ...withFulfilmentType(counterState(), 'delivery'), lines: [line()] };
        expect(saleShortfall(delivery)).toBe('customer');

        const named = withCustomer(delivery, 'account-1');
        expect(saleShortfall(named)).toBe('address');

        expect(saleShortfall({ ...named, customerAddressId: 'address-1' })).toBeNull();

        // A collection is done once it is named.
        const pickup = withCustomer(
            { ...withFulfilmentType(counterState(), 'pickup'), lines: [line()] },
            'account-1',
        );
        expect(saleShortfall(pickup)).toBeNull();
    });

    it('requires a transfer reference for WISH at the till and nothing extra for cash', () => {
        const cash = { ...counterState(), lines: [line()] };
        expect(saleShortfall(cash)).toBeNull();

        const wish = withPaymentMethod(cash, 'wish');
        // The agent is asserting they watched a transfer land. An assertion with no transfer
        // identifier is one nobody can check afterwards — a stricter rule than the wire's.
        expect(saleShortfall(wish)).toBe('reference');
        expect(
            saleShortfall({
                ...wish,
                payment: { method: 'wish', reference: 'WSH-1', notes: '' },
            }),
        ).toBeNull();

        // WISH on a collection is an intent for later: there is no transfer to name yet.
        const pickupWish = withPaymentMethod(
            withCustomer(withFulfilmentType(cash, 'pickup'), 'account-1'),
            'wish',
        );
        expect(saleShortfall(pickupWish)).toBeNull();

        expect(isCounterPaymentComplete(null)).toBe(false);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The basket
 * ---------------------------------------------------------------------------------------------- */

describe('desk basket — aggregation', () => {
    it('sums a second tap into the existing line rather than appending one', () => {
        const once = addItem([], {
            catalogueItemId: ITEM,
            catalogueItemVariantId: null,
            name: { en: 'Flat white', ar: 'فلات وايت' },
            variantLabel: null,
        });
        const twice = addItem(once, {
            catalogueItemId: ITEM,
            catalogueItemVariantId: null,
            name: { en: 'Flat white', ar: 'فلات وايت' },
            variantLabel: null,
        });

        expect(twice).toHaveLength(1);
        expect(twice[0]?.quantity).toBe('2');
    });

    it('holds the merged line in its first-seen position', () => {
        const lines = addItem(
            addItem([], {
                catalogueItemId: ITEM,
                catalogueItemVariantId: null,
                name: { en: 'A', ar: 'أ' },
                variantLabel: null,
            }),
            {
                catalogueItemId: OTHER_ITEM,
                catalogueItemVariantId: null,
                name: { en: 'B', ar: 'ب' },
                variantLabel: null,
            },
        );

        const merged = addItem(lines, {
            catalogueItemId: ITEM,
            catalogueItemVariantId: null,
            name: { en: 'A', ar: 'أ' },
            variantLabel: null,
        });

        // The row must not jump to the bottom under a finger tapping the same button.
        expect(merged.map((entry) => entry.catalogueItemId)).toEqual([ITEM, OTHER_ITEM]);
        expect(merged[0]?.quantity).toBe('2');
    });

    it('keeps an article and the same article in a pack as two lines', () => {
        const plain = addItem([], {
            catalogueItemId: ITEM,
            catalogueItemVariantId: null,
            name: { en: 'Cold brew', ar: 'قهوة باردة' },
            variantLabel: null,
        });
        const packed = addItem(plain, {
            catalogueItemId: ITEM,
            catalogueItemVariantId: PACK,
            name: { en: 'Cold brew', ar: 'قهوة باردة' },
            variantLabel: '500 ml',
        });

        // `order_lines` is unique on `(order, item, variant) NULLS NOT DISTINCT` — these are two
        // rows there, and they are two things to sell here.
        expect(packed).toHaveLength(2);
        expect(basketKey(ITEM, null)).not.toBe(basketKey(ITEM, PACK));
        // The absent variant is spelled, so no identifier can collide with a real one.
        expect(basketKey(ITEM, null)).toBe(`${ITEM}|-`);
    });

    it('removes a line when its quantity is stepped to nothing', () => {
        const lines = [line()];
        const key = lineKey(line());

        expect(setQuantity(lines, key, '0')).toHaveLength(0);
        expect(setQuantity(lines, key, '')).toHaveLength(0);
        expect(setQuantity(lines, key, '4')[0]?.quantity).toBe('4');
        expect(removeLine(lines, key)).toHaveLength(0);
        expect(basketLineCount(lines)).toBe(1);
    });

    it('sends only the three wire fields, dropping anything unsellable', () => {
        const wire = toWire([
            line({ quantity: '2' }),
            line({ catalogueItemId: OTHER_ITEM, quantity: '0' }),
        ]);

        expect(wire).toEqual([
            { catalogueItemId: ITEM, catalogueItemVariantId: null, quantity: '2' },
        ]);
    });

    it('says an empty or broken basket is not quotable', () => {
        expect(isQuotableBasket([])).toBe(false);
        expect(isQuotableBasket([line({ quantity: 'x' })])).toBe(false);
        expect(isQuotableBasket([line()])).toBe(true);
    });
});

describe('desk basket — decimal quantities', () => {
    it('adds decimal strings exactly, without a float round trip', () => {
        expect(addQuantity('0.1', '0.2')).toBe('0.3');
        expect(addQuantity('0.35', '0.35')).toBe('0.7');
        expect(addQuantity('1', '2')).toBe('3');
        // 0.1 + 0.2 as floats is 0.30000000000000004; scaled integers are not.
        expect(addQuantity('0.1', '0.2')).not.toBe(String(0.1 + 0.2));
    });

    it('treats an unreadable operand as nothing rather than poisoning the sum', () => {
        expect(addQuantity('2', 'not a number')).toBe('2');
        expect(addQuantity('1e3', '1')).toBe('1');
    });

    it('refuses zero, negatives and exponents as quantities', () => {
        expect(isSellableQuantity('0')).toBe(false);
        expect(isSellableQuantity('-1')).toBe(false);
        expect(isSellableQuantity('1e3')).toBe(false);
        expect(isSellableQuantity('  2  ')).toBe(true);
        expect(isSellableQuantity('0.000001')).toBe(true);
    });

    it('caps a line rather than letting a held stepper run away with it', () => {
        expect(addQuantity(String(MAX_LINE_QUANTITY), '50')).toBe(String(MAX_LINE_QUANTITY));
        expect(quantityFromNumber(MAX_LINE_QUANTITY + 500)).toBe(String(MAX_LINE_QUANTITY));
        expect(isSellableQuantity(String(MAX_LINE_QUANTITY + 1))).toBe(false);
    });

    it('round-trips through the number a stepper control can hold', () => {
        expect(quantityAsNumber('3')).toBe(3);
        expect(quantityAsNumber('0.35')).toBe(0.35);
        expect(quantityAsNumber('nonsense')).toBeNull();
        // An emptied stepper answers null, which is not a quantity.
        expect(quantityFromNumber(null)).toBe('0');
        expect(quantityFromNumber(2)).toBe('2');
    });
});

/* ------------------------------------------------------------------------------------------------
 * Editing a placed order
 * ---------------------------------------------------------------------------------------------- */

describe('desk sale — an existing order as the sale it is', () => {
    const order: KitchenOrder = {
        id: OrderId.unsafe('order-0001'),
        orderNumber: 'H360-2026-0148',
        branchId: null,
        status: 'placed',
        currencyCode: 'AED',
        subtotalMinor: 6_400,
        deliveryFeeMinor: 1_000,
        totalMinor: 7_400,
        paymentMethod: 'cash_on_delivery',
        fulfilmentType: 'delivery',
        delivery: {
            label: null,
            lineOne: 'Villa 12',
            lineTwo: null,
            city: null,
            areaNameEn: 'Al Quoz 1',
            areaNameAr: 'القوز ١',
            areaId: null,
            windowCode: 'morning',
            requestedDate: '2026-08-16',
            zoneId: null,
        },
        placedAt: '2026-08-15T09:00:00.000Z',
        confirmedAt: null,
        fulfilledAt: null,
        cancelledAt: null,
        cancellationReason: null,
        lockVersion: 3,
        customerAccountId: 'account-1',
        amendable: true,
        lineCount: 1,
        lines: [
            {
                id: 'line-1',
                catalogueItemId: ITEM,
                catalogueItemVariantId: PACK,
                nameEn: 'Flat white',
                nameAr: 'فلات وايت',
                variantLabel: 'Box of 6',
                quantity: '2.000',
                unitPriceMinor: 3_200,
                lineTotalMinor: 6_400,
                currencyCode: 'AED',
                allergens: [],
                packSummary: null,
                priceListId: null,
                priceListItemId: null,
            },
        ],
    };

    it('carries the lines, the customer, the stored slot and the method, and no new address', () => {
        const state = saleStateFromOrder(order);
        expect(state).toEqual({
            fulfilmentType: 'delivery',
            customerAccountId: 'account-1',
            // `null` on an edit is "keep the stored destination".
            customerAddressId: null,
            lines: [
                {
                    catalogueItemId: ITEM,
                    catalogueItemVariantId: PACK,
                    // Normalised, so the stepper steps from 2 rather than from "2.000".
                    quantity: '2',
                    name: { en: 'Flat white', ar: 'فلات وايت' },
                    variantLabel: 'Box of 6',
                },
            ],
            paymentMethod: 'cash_on_delivery',
            payment: null,
            requestedDeliveryDate: '2026-08-16',
            deliveryWindowCode: 'morning',
            driverUserId: null,
        });
    });

    it('does not ask an edited delivery for an address it already has', () => {
        const state = saleStateFromOrder(order);
        expect(saleShortfall(state)).toBe('address');
        expect(saleShortfall(state, true)).toBeNull();
    });
});
