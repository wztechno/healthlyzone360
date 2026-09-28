import type {
    KitchenOrderPaymentMethod,
    OrderDeskFulfilmentType,
} from '@healthy360/api-client/contracts';

import type { BasketLine } from './basket.ts';
import { isQuotableBasket } from './basket.ts';

/**
 * The desk sale's state — what kind of sale it is, who it is for, where it goes, what is in it and
 * how it is paid — and the rules that keep those five consistent with each other.
 *
 * It used to be a step machine, because the sale used to be a six-step wizard. The sale is one page
 * now (`screens/order-desk-sale-screen.tsx`): the kind of sale sits above the menu, the customer and
 * the address open under it when the kind needs them, and the ticket beside the menu says what is
 * still missing. What survived is everything that was never about steps — the clearing rules and
 * the completeness rule — and that is all this module holds.
 *
 * ## The three sales are three different shapes, and the wire enforces it
 *
 * `fulfilment_type` decides which fields the placement requires, forbids or merely allows, and
 * getting it wrong is not a soft failure:
 *
 * - **counter** — no customer, no address, `payment` block **required** (a `422` without it). A
 *   counter body carrying `customer_address_id` is refused `address_not_applicable`.
 * - **pickup** — customer **required**, address **forbidden** (`address_not_applicable` again: a
 *   collection has no destination).
 * - **delivery** — customer and address both required, `payment` block **forbidden** (money arrives
 *   at the door, through the receipts operation, recorded by whoever actually took it).
 *
 * So {@link withFulfilmentType} does not merely record the choice — it **clears the state the new
 * shape forbids**. A page that kept an address around after switching to counter would send it, and
 * the sale would be refused with a reason about a field the agent can no longer see.
 *
 * ## Counter sales are anonymous, and that is a v1 simplification
 *
 * The wire *permits* `customer_account_id` on a counter sale — "a regular is worth naming and a
 * stranger is not" — and this page does not offer it: a counter sale's whole appeal is that it is a
 * few taps with somebody waiting. The provenance is not lost: `placed_on_behalf_by` records the agent
 * on every desk placement.
 *
 * ## The payment method means two things
 *
 * `payment_method` is **required on every placement**, all three types. On a **counter** sale it is
 * a fact about money being handed over now, and the receipt block travels with it. On a **delivery**
 * or a **pickup** it is an *intent* recorded for later, with no transaction to describe — so the same
 * control on the ticket records it, and nothing else is asked.
 *
 * ## The schedule is not asked for in v1
 *
 * `requested_delivery_date` and `delivery_window_code` are on {@link SaleState} so both request
 * bodies are shaped correctly, and this page leaves them `null`. An order with no requested day is
 * read by the server as *as soon as possible*, which is the honest answer for an order somebody just
 * took over the telephone. A desk cannot yet take an order *for Thursday*; that needs a slot picker
 * over the kitchen's delivery windows, and the fields are here so it lands as a section rather than a
 * rewrite.
 */

/** What the agent says they saw at the counter. Only ever present on a counter sale. */
export interface CounterPaymentDraft {
    /**
     * How the money actually turned up — deliberately **not** constrained to equal the order's
     * `payment_method`. A counter sale taken as cash and settled by a WISH transfer while the
     * customer was standing there is an ordinary evening, and the wire says so.
     */
    readonly method: KitchenOrderPaymentMethod;
    /** The transfer identifier on a WISH payment. Required here — see {@link saleShortfall}. */
    readonly reference: string;
    readonly notes: string;
}

export interface SaleState {
    readonly fulfilmentType: OrderDeskFulfilmentType;
    /** Required for pickup and delivery; always `null` on a counter sale — see the module note. */
    readonly customerAccountId: string | null;
    /** Delivery only. Anything else carrying one is refused `address_not_applicable`. */
    readonly customerAddressId: string | null;
    readonly lines: readonly BasketLine[];
    /** The intent recorded on the order. */
    readonly paymentMethod: KitchenOrderPaymentMethod;
    /** The receipt written at the till. Non-null **only** on a counter sale. */
    readonly payment: CounterPaymentDraft | null;
    /** `YYYY-MM-DD`. Always `null` in v1 — see the module note on the schedule. */
    readonly requestedDeliveryDate: string | null;
    /** Always `null` in v1 — see the module note on the schedule. */
    readonly deliveryWindowCode: string | null;
}

/**
 * Which methods are offered for each shape of sale.
 *
 * The wire constrains none of this — `payment_method` takes any of the three on any sale. The
 * narrowing is this page's, and it is about what the words mean: "cash on delivery" is not a thing
 * that can happen to a walk-in, and a collection is settled at the counter when the customer
 * arrives, not at a door nobody is driving to. WISH is offered on all three because a transfer is a
 * transfer wherever the customer is standing.
 */
const METHODS_BY_TYPE: Readonly<
    Record<OrderDeskFulfilmentType, readonly KitchenOrderPaymentMethod[]>
> = {
    counter: ['cash_at_counter', 'wish'],
    pickup: ['cash_at_counter', 'wish'],
    delivery: ['cash_on_delivery', 'wish'],
};

/** The methods a sale of this shape may be taken on, in the order the ticket draws them. */
export function paymentMethodsFor(
    fulfilmentType: OrderDeskFulfilmentType,
): readonly KitchenOrderPaymentMethod[] {
    return METHODS_BY_TYPE[fulfilmentType];
}

/** The one a sale of this shape starts on: the first offered, which is cash in every case. */
export function defaultPaymentMethodFor(
    fulfilmentType: OrderDeskFulfilmentType,
): KitchenOrderPaymentMethod {
    return METHODS_BY_TYPE[fulfilmentType][0] ?? 'cash_on_delivery';
}

/** Whether this shape of sale has to name somebody. */
export function needsCustomer(fulfilmentType: OrderDeskFulfilmentType): boolean {
    return fulfilmentType !== 'counter';
}

/** Whether this shape of sale has somewhere to go. */
export function needsAddress(fulfilmentType: OrderDeskFulfilmentType): boolean {
    return fulfilmentType === 'delivery';
}

/**
 * A fresh sale.
 *
 * Starts on `counter` because that is the sale with the fewest questions and the one a desk makes
 * most often. Every other field is empty rather than guessed.
 */
export function initialSaleState(): SaleState {
    const method = defaultPaymentMethodFor('counter');
    return {
        fulfilmentType: 'counter',
        customerAccountId: null,
        customerAddressId: null,
        lines: [],
        paymentMethod: method,
        payment: { method, reference: '', notes: '' },
        requestedDeliveryDate: null,
        deliveryWindowCode: null,
    };
}

/**
 * Record the chosen shape, and **clear what the new shape forbids**.
 *
 * Every clause here is a refusal the wire would otherwise return, on a page where the field that
 * caused it is no longer visible:
 *
 * - to **counter**: the customer and the address both go; a payment draft appears, because the
 *   placement is a `422` without one.
 * - to **pickup**: the address goes (`address_not_applicable`); the customer stays, because a pickup
 *   requires exactly the customer a delivery does and re-searching for them would be a punishment
 *   for changing one's mind.
 * - away from **counter**: the payment draft goes, because the wire *forbids* the block on the other
 *   two (`422`).
 *
 * The method is always re-defaulted, because a method that made sense for the old shape may not name
 * anything real about the new one. The basket is never cleared: the same food is being sold whichever
 * way it leaves the kitchen.
 */
export function withFulfilmentType(
    state: SaleState,
    fulfilmentType: OrderDeskFulfilmentType,
): SaleState {
    if (state.fulfilmentType === fulfilmentType) return state;
    const toCounter = fulfilmentType === 'counter';
    const method = defaultPaymentMethodFor(fulfilmentType);
    return {
        ...state,
        fulfilmentType,
        customerAccountId: toCounter ? null : state.customerAccountId,
        customerAddressId: needsAddress(fulfilmentType) ? state.customerAddressId : null,
        paymentMethod: method,
        payment: toCounter ? { method, reference: '', notes: '' } : null,
    };
}

/**
 * Choose the customer, and **drop the address that belonged to somebody else**.
 *
 * An address must belong to `customer_account_id` — one that does not is a `404` — so an agent who
 * picks the wrong caller, saves their address, then corrects the caller must not carry the first
 * caller's street into the second caller's order.
 */
export function withCustomer(state: SaleState, customerAccountId: string): SaleState {
    if (state.customerAccountId === customerAccountId) return state;
    return { ...state, customerAccountId, customerAddressId: null };
}

/**
 * Record the payment method. On a counter sale the receipt's method moves with it — the till is
 * describing the money it is taking — and a reference typed for WISH is kept in case the agent
 * switches back.
 */
export function withPaymentMethod(state: SaleState, method: KitchenOrderPaymentMethod): SaleState {
    return {
        ...state,
        paymentMethod: method,
        payment: state.payment === null ? null : { ...state.payment, method },
    };
}

/**
 * Whether the till's receipt is ready to send.
 *
 * A WISH payment must carry a **reference**, and that is this page's rule rather than the wire's
 * (which accepts a null one). WISH is manually confirmed: the agent is asserting that they watched a
 * transfer land, and an assertion with no transfer identifier is one nobody can check afterwards.
 * Cash needs no reference: the cash is in the drawer, and the drawer is the record.
 */
export function isCounterPaymentComplete(payment: CounterPaymentDraft | null): boolean {
    if (payment === null) return false;
    return payment.method !== 'wish' || payment.reference.trim() !== '';
}

/** The first thing this sale still needs, in the order the page asks for it. */
export type SaleShortfall = 'customer' | 'address' | 'items' | 'reference';

/**
 * What stands between this sale and the place button — `null` when nothing does.
 *
 * **State only.** The other gate, a fresh `quote.quotable`, is the server's answer and arrives over
 * the network; the page checks it beside this. Putting a quote in here would make a pure model
 * depend on a request, and its rules would stop being testable without one.
 *
 * Top to bottom, the way the page reads: the customer and the address sit above the menu, the items
 * are the menu, and the reference is the last thing on the ticket.
 */
export function saleShortfall(state: SaleState): SaleShortfall | null {
    if (needsCustomer(state.fulfilmentType) && state.customerAccountId === null) return 'customer';
    if (needsAddress(state.fulfilmentType) && state.customerAddressId === null) return 'address';
    if (!isQuotableBasket(state.lines)) return 'items';
    if (state.fulfilmentType === 'counter' && !isCounterPaymentComplete(state.payment)) {
        return 'reference';
    }
    return null;
}
