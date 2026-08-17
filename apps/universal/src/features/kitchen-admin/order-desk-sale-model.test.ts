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
import type { SaleWizardState } from './order-desk/steps.ts';
import {
    applicableSteps,
    canProceed,
    clampStep,
    defaultPaymentMethodFor,
    initialSaleWizardState,
    isCounterPaymentComplete,
    nextStep,
    paymentMethodsFor,
    previousStep,
    stepApplies,
    stepProgress,
    withCustomer,
    withFulfilmentType,
} from './order-desk/steps.ts';

/**
 * The sale wizard's two pure models.
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

function counterState(overrides: Partial<SaleWizardState> = {}): SaleWizardState {
    return { ...initialSaleWizardState(), ...overrides };
}

/* ------------------------------------------------------------------------------------------------
 * Applicability
 * ---------------------------------------------------------------------------------------------- */

describe('sale wizard — which steps a sale has', () => {
    it('gives a counter sale the four steps it can answer, and no customer or address', () => {
        expect(applicableSteps('counter')).toEqual(['type', 'basket', 'payment', 'review']);
    });

    it('gives a pickup a customer but no address and no payment step', () => {
        // A collection needs to know whose it is; it has no destination, and the money arrives
        // when the customer does.
        expect(applicableSteps('pickup')).toEqual(['type', 'customer', 'basket', 'review']);
    });

    it('gives a delivery every step except the till', () => {
        expect(applicableSteps('delivery')).toEqual([
            'type',
            'customer',
            'address',
            'basket',
            'review',
        ]);
    });

    it('keeps one ordering for all three, so no step is reachable in one direction only', () => {
        for (const type of ['counter', 'pickup', 'delivery'] as const) {
            const steps = applicableSteps(type);
            const walked: string[] = [steps[0] ?? ''];
            let cursor = nextStep({ ...initialSaleWizardState(), fulfilmentType: type }, steps[0]!);
            while (cursor !== null) {
                walked.push(cursor);
                cursor = nextStep({ ...initialSaleWizardState(), fulfilmentType: type }, cursor);
            }
            expect(walked).toEqual([...steps]);
        }
    });

    it('answers the ends of the walk as null rather than wrapping round', () => {
        const state = counterState();
        expect(previousStep(state, 'type')).toBeNull();
        expect(nextStep(state, 'review')).toBeNull();
        // Skipped steps are not neighbours: counter's `basket` follows `type` directly.
        expect(nextStep(state, 'type')).toBe('basket');
        expect(previousStep(state, 'basket')).toBe('type');
    });

    it('counts progress against this sale rather than against the whole wizard', () => {
        expect(stepProgress(counterState(), 'review')).toEqual({ position: 4, total: 4 });
        expect(stepProgress({ ...counterState(), fulfilmentType: 'delivery' }, 'review')).toEqual({
            position: 5,
            total: 5,
        });
    });

    it('states applicability per step so a new step cannot be missing from one shape', () => {
        expect(stepApplies('customer', 'counter')).toBe(false);
        expect(stepApplies('address', 'pickup')).toBe(false);
        expect(stepApplies('payment', 'delivery')).toBe(false);
        expect(stepApplies('basket', 'counter')).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Clearing — every one of these is a 422 or a 409 the wire would answer
 * ---------------------------------------------------------------------------------------------- */

describe('sale wizard — what changing the type clears', () => {
    it('drops the customer and the address when a delivery becomes a counter sale', () => {
        const delivery = withFulfilmentType(counterState(), 'delivery');
        const named = {
            ...withCustomer(delivery, 'account-1'),
            customerAddressId: 'address-1',
        };

        const counter = withFulfilmentType(named, 'counter');

        // A counter body carrying an address is refused `address_not_applicable`, and this wizard
        // has no step on which the agent could see the customer it was still sending.
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

    it('returns the same object when the type has not moved', () => {
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

    it('lands the agent on the nearest step they had reached, not back at the start', () => {
        const delivery = withFulfilmentType(counterState(), 'delivery');
        const counter = withFulfilmentType(delivery, 'counter');

        // `address` does not exist for a counter sale; the step before it that does is `type`.
        expect(clampStep(counter, 'address')).toBe('type');
        expect(clampStep(counter, 'customer')).toBe('type');
        // A step this sale still has is left exactly where it is.
        expect(clampStep(counter, 'basket')).toBe('basket');
    });
});

/* ------------------------------------------------------------------------------------------------
 * Proceeding
 * ---------------------------------------------------------------------------------------------- */

describe('sale wizard — what each step needs before it may be left', () => {
    it('never blocks the type step, which always holds an answer', () => {
        expect(canProceed(counterState(), 'type')).toBe(true);
    });

    it('waits for a customer and then for an address', () => {
        const delivery = withFulfilmentType(counterState(), 'delivery');
        expect(canProceed(delivery, 'customer')).toBe(false);

        const named = withCustomer(delivery, 'account-1');
        expect(canProceed(named, 'customer')).toBe(true);
        expect(canProceed(named, 'address')).toBe(false);

        expect(canProceed({ ...named, customerAddressId: 'address-1' }, 'address')).toBe(true);
    });

    it('waits for a basket that holds something sellable', () => {
        expect(canProceed(counterState(), 'basket')).toBe(false);
        expect(canProceed({ ...counterState(), lines: [line()] }, 'basket')).toBe(true);
        // A zero-quantity row would be a 422 the agent cannot act on.
        expect(canProceed({ ...counterState(), lines: [line({ quantity: '0' })] }, 'basket')).toBe(
            false,
        );
    });

    it('requires a transfer reference for WISH and nothing extra for cash', () => {
        const cash = counterState();
        expect(canProceed(cash, 'payment')).toBe(true);

        const wish = {
            ...cash,
            payment: { method: 'wish' as const, reference: '', notes: '' },
        };
        // The agent is asserting they watched a transfer land. An assertion with no transfer
        // identifier is one nobody can check afterwards, which is the whole value of writing it
        // down — a stricter rule than the wire's, deliberately.
        expect(canProceed(wish, 'payment')).toBe(false);
        expect(
            canProceed({ ...wish, payment: { ...wish.payment, reference: 'WSH-1' } }, 'payment'),
        ).toBe(true);

        expect(isCounterPaymentComplete(null)).toBe(false);
    });

    it('lets review through only when every applicable step before it is answered', () => {
        const counter = { ...counterState(), lines: [line()] };
        expect(canProceed(counter, 'review')).toBe(true);

        const delivery = withFulfilmentType(counter, 'delivery');
        // Customer and address are now applicable and unanswered.
        expect(canProceed(delivery, 'review')).toBe(false);

        const ready = {
            ...withCustomer(delivery, 'account-1'),
            customerAddressId: 'address-1',
        };
        expect(canProceed(ready, 'review')).toBe(true);
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
