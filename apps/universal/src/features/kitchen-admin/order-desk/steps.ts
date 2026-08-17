import type {
    KitchenOrderPaymentMethod,
    OrderDeskFulfilmentType,
} from '@healthy360/api-client/contracts';

import type { BasketLine } from './basket.ts';
import { isQuotableBasket } from './basket.ts';

/**
 * The sale wizard's step machine — which steps this sale has, in what order, and what each one needs
 * before it may be left.
 *
 * ## Why this is a table and not a `switch` in the screen
 *
 * Exactly the argument `features/onboarding/steps.ts` makes. Progress, back, next and the review
 * summary all have to agree about which steps exist for *this* sale, and a second ordering — a
 * `switch` in the screen, a ternary in the footer — is how a wizard ends up able to reach the payment
 * step from the basket in one direction and not the other. `Stepper` is a **progress indicator
 * only**: it draws "Step 3 of 5" and a bar, and knows nothing about validity or navigation. That is
 * this module's job.
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
 * shape forbids**. A wizard that kept an address around after switching to counter would send it,
 * and the sale would be refused with a reason about a field the agent can no longer see.
 *
 * ## Counter sales skip the customer step entirely, and that is a v1 simplification
 *
 * The wire *permits* `customer_account_id` on a counter sale — "a regular is worth naming and a
 * stranger is not" — and this wizard does not offer it. The reason is that a counter sale's whole
 * appeal is that it is four taps with somebody waiting, and a customer search on the way to a coffee
 * is three of those taps spent on a field the sale does not need. The provenance is not lost:
 * `placed_on_behalf_by` records the agent on every desk placement, so a counter sale is always
 * attributable even when it is anonymous. Naming a regular at the counter is a later slice's, and it
 * arrives as an *optional* customer step for `counter` — the machine already has the seat for it.
 *
 * ## Where the payment method is chosen depends on when the money arrives
 *
 * `payment_method` is **required on every placement**, all three types. But it means two different
 * things:
 *
 * - On a **counter** sale it is a fact about money that is being handed over now, so it belongs on
 *   the Payment step beside the reference and the notes — one screen about one transaction.
 * - On a **delivery** or a **pickup** it is an *intent* recorded for later, and there is no
 *   transaction to describe. A whole step for one selector would be a step somebody presses Next
 *   through, so it sits on the Review step as a plain selector, defaulted to `cash_on_delivery`.
 *
 * ## The schedule is not asked for in v1
 *
 * `requested_delivery_date` and `delivery_window_code` are on the wire and on {@link SaleWizardState}
 * so both request bodies are shaped correctly, and this wizard leaves them `null`. An order with no
 * requested day is not scheduled for nothing — the server reads it as *as soon as possible* and the
 * queue's `due_at` falls through to `placedAt`, which is the honest answer for an order somebody just
 * took over the telephone. The consequence to know is that the schedule refusals (`cut_off_passed`,
 * `date_in_the_past`) cannot fire while nothing is sent, so a desk cannot yet take an order *for
 * Thursday*. That needs a slot picker over the kitchen's own delivery windows, which is its own
 * surface and its own endpoint; the state fields are here so it lands as a step rather than a rewrite.
 */

/**
 * Every step this wizard can show, in the only order they are ever shown in.
 *
 * A sale uses a *subset* — see {@link applicableSteps} — but never a reordering. "Which steps" is a
 * property of the sale; "in what order" is a property of the wizard.
 */
export const ORDER_DESK_SALE_STEPS = [
    'type',
    'customer',
    'address',
    'basket',
    'payment',
    'review',
] as const;
export type OrderDeskSaleStep = (typeof ORDER_DESK_SALE_STEPS)[number];

export const FIRST_SALE_STEP: OrderDeskSaleStep = 'type';

/** What the agent says they saw at the counter. Only ever present on a counter sale. */
export interface CounterPaymentDraft {
    /**
     * How the money actually turned up — deliberately **not** constrained to equal the order's
     * `payment_method`. A counter sale taken as cash and settled by a WISH transfer while the
     * customer was standing there is an ordinary evening, and the wire says so.
     */
    readonly method: KitchenOrderPaymentMethod;
    /** The transfer identifier on a WISH payment. Required by this wizard — see {@link canProceed}. */
    readonly reference: string;
    readonly notes: string;
}

export interface SaleWizardState {
    readonly fulfilmentType: OrderDeskFulfilmentType;
    /** Required for pickup and delivery; always `null` on a counter sale — see the module note. */
    readonly customerAccountId: string | null;
    /** Delivery only. Anything else carrying one is refused `address_not_applicable`. */
    readonly customerAddressId: string | null;
    readonly lines: readonly BasketLine[];
    /** The intent recorded on the order. Chosen on Payment (counter) or on Review (the other two). */
    readonly paymentMethod: KitchenOrderPaymentMethod;
    /** The receipt written at the till. Non-null **only** on a counter sale. */
    readonly payment: CounterPaymentDraft | null;
    /** `YYYY-MM-DD`. Always `null` in v1 — see the module note on the schedule. */
    readonly requestedDeliveryDate: string | null;
    /** Always `null` in v1 — see the module note on the schedule. */
    readonly deliveryWindowCode: string | null;
}

/**
 * Which of the three methods are offered for each shape of sale.
 *
 * The wire constrains none of this — `payment_method` takes any of the three on any sale, and the
 * counter receipt's own `method` is deliberately allowed to disagree with it. The narrowing is this
 * screen's, and it is about what the words mean rather than about what the server would accept:
 * "cash on delivery" is not a thing that can happen to a walk-in, and a collection is settled at the
 * counter when the customer arrives, not at a door nobody is driving to.
 *
 * WISH is offered on all three because a transfer is a transfer wherever the customer is standing.
 * Nothing here would refuse a value outside the list — the state simply never holds one.
 */
const METHODS_BY_TYPE: Readonly<
    Record<OrderDeskFulfilmentType, readonly KitchenOrderPaymentMethod[]>
> = {
    counter: ['cash_at_counter', 'wish'],
    pickup: ['cash_at_counter', 'wish'],
    delivery: ['cash_on_delivery', 'wish'],
};

/** The methods a sale of this shape may be taken on, in the order the selector draws them. */
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

/**
 * A fresh sale.
 *
 * Starts on `counter` because that is the sale with the fewest questions and the one a desk makes
 * most often — and because the Type step is explicit, so nothing is *assumed* about the sale, only
 * pre-selected. Every other field is empty rather than guessed.
 */
export function initialSaleWizardState(): SaleWizardState {
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
 * The steps this sale actually has.
 *
 * Derived by filtering {@link ORDER_DESK_SALE_STEPS} rather than by writing three lists, so a step
 * added to the wizard cannot be silently missing from one of the three shapes.
 */
export function applicableSteps(
    fulfilmentType: OrderDeskFulfilmentType,
): readonly OrderDeskSaleStep[] {
    return ORDER_DESK_SALE_STEPS.filter((step) => stepApplies(step, fulfilmentType));
}

/** Whether one step belongs to one shape of sale. The whole applicability rule, in one place. */
export function stepApplies(
    step: OrderDeskSaleStep,
    fulfilmentType: OrderDeskFulfilmentType,
): boolean {
    switch (step) {
        case 'customer':
            // A counter sale is anonymous in v1 — see the module note.
            return fulfilmentType !== 'counter';
        case 'address':
            // Only a delivery has somewhere to go.
            return fulfilmentType === 'delivery';
        case 'payment':
            // Only a counter sale has money in the room to describe.
            return fulfilmentType === 'counter';
        default:
            return true;
    }
}

/**
 * Record the chosen shape, and **clear what the new shape forbids**.
 *
 * Every clause here is a refusal the wire would otherwise return, on a screen where the field that
 * caused it is no longer visible:
 *
 * - to **counter**: the customer and the address both go (`address_not_applicable` on the address,
 *   and a customer this wizard has no step to show); a payment draft appears, because the placement
 *   is a `422` without one.
 * - to **pickup**: the address goes (`address_not_applicable`); the customer stays, because a pickup
 *   requires exactly the customer a delivery does and re-searching for them would be a punishment
 *   for changing one's mind.
 * - to **delivery**: nothing is cleared beyond the payment draft — an address chosen for a delivery
 *   that was briefly a pickup is gone already, by the clause above.
 * - away from **counter**: the payment draft goes, because the wire *forbids* the block on the other
 *   two (`422`).
 *
 * The method is always re-defaulted, because a method that made sense for the old shape may not name
 * anything real about the new one — "cash on delivery" carried onto a walk-in is a promise about a
 * door that nobody is driving to. See {@link paymentMethodsFor}.
 *
 * The basket is never cleared: the same food is being sold whichever way it leaves the kitchen, and
 * an agent who mis-tapped the type would otherwise lose the order they had just rung up.
 */
export function withFulfilmentType(
    state: SaleWizardState,
    fulfilmentType: OrderDeskFulfilmentType,
): SaleWizardState {
    if (state.fulfilmentType === fulfilmentType) return state;

    const toCounter = fulfilmentType === 'counter';
    const method = defaultPaymentMethodFor(fulfilmentType);

    return {
        ...state,
        fulfilmentType,
        customerAccountId: toCounter ? null : state.customerAccountId,
        customerAddressId: fulfilmentType === 'delivery' ? state.customerAddressId : null,
        paymentMethod: method,
        payment: toCounter ? { method, reference: '', notes: '' } : null,
    };
}

/**
 * Choose the customer, and **drop the address that belonged to somebody else**.
 *
 * An address must belong to `customer_account_id` — one that does not is a `404`, deliberately the
 * same answer as "no such address" — so an agent who picks the wrong caller, chooses their address,
 * then corrects the caller must not carry the first caller's street into the second caller's order.
 */
export function withCustomer(state: SaleWizardState, customerAccountId: string): SaleWizardState {
    if (state.customerAccountId === customerAccountId) return state;
    return { ...state, customerAccountId, customerAddressId: null };
}

/**
 * True when the step is answered well enough to leave.
 *
 * **State only.** Two gates this cannot see live on the screen: the basket step is additionally
 * gated on `quote.quotable`, which is the server's answer and arrives over the network; and the
 * review step's primary action is gated on the same. Putting a quote in here would make a pure
 * model depend on a request, and the wizard's own rules would stop being testable without one.
 */
export function canProceed(state: SaleWizardState, step: OrderDeskSaleStep): boolean {
    switch (step) {
        case 'type':
            return true;
        case 'customer':
            return state.customerAccountId !== null;
        case 'address':
            return state.customerAddressId !== null;
        case 'basket':
            return isQuotableBasket(state.lines);
        case 'payment':
            return isCounterPaymentComplete(state.payment);
        case 'review':
            // Everything the sale needs, gathered — the last step has nothing of its own to answer
            // beyond the payment method, which always holds a value.
            return applicableSteps(state.fulfilmentType)
                .filter((candidate) => candidate !== 'review')
                .every((candidate) => canProceed(state, candidate));
    }
}

/**
 * Whether the till's receipt is ready to send.
 *
 * A WISH payment must carry a **reference**, and that is this wizard's rule rather than the wire's
 * (which accepts a null one). WISH is manually confirmed: the agent is asserting that they watched a
 * transfer land, and an assertion with no transfer identifier attached is one nobody can check
 * afterwards — which is the entire value of writing it down. Cash needs no reference: the cash is in
 * the drawer, and the drawer is the record.
 */
export function isCounterPaymentComplete(payment: CounterPaymentDraft | null): boolean {
    if (payment === null) return false;
    return payment.method !== 'wish' || payment.reference.trim() !== '';
}

/** The step after `step` for this sale, or `null` on the last one. */
export function nextStep(
    state: SaleWizardState,
    step: OrderDeskSaleStep,
): OrderDeskSaleStep | null {
    const steps = applicableSteps(state.fulfilmentType);
    const index = steps.indexOf(step);
    return index < 0 ? null : (steps[index + 1] ?? null);
}

/** The step before `step` for this sale, or `null` on the first one. */
export function previousStep(
    state: SaleWizardState,
    step: OrderDeskSaleStep,
): OrderDeskSaleStep | null {
    const steps = applicableSteps(state.fulfilmentType);
    const index = steps.indexOf(step);
    return index <= 0 ? null : (steps[index - 1] ?? null);
}

/**
 * Where `step` sits in *this* sale, for the progress indicator.
 *
 * One-based, and `position` is `1` for a step this sale does not have — which happens for exactly
 * one frame, between {@link withFulfilmentType} dropping a step and {@link clampStep} moving off it.
 */
export function stepProgress(
    state: SaleWizardState,
    step: OrderDeskSaleStep,
): { readonly position: number; readonly total: number } {
    const steps = applicableSteps(state.fulfilmentType);
    const index = steps.indexOf(step);
    return { position: index < 0 ? 1 : index + 1, total: steps.length };
}

/**
 * The step to actually be on, given the sale's shape.
 *
 * Changing the type can delete the step somebody is standing on — switching to counter while on the
 * Address step is the ordinary case. Rather than leave the screen rendering a step that no longer
 * exists, the wizard falls back to the **last applicable step at or before** where it was, so the
 * agent lands on the nearest thing they had already answered instead of being thrown to the start.
 */
export function clampStep(state: SaleWizardState, step: OrderDeskSaleStep): OrderDeskSaleStep {
    if (stepApplies(step, state.fulfilmentType)) return step;

    const all = ORDER_DESK_SALE_STEPS;
    const wanted = all.indexOf(step);
    for (let index = wanted - 1; index >= 0; index -= 1) {
        const candidate = all[index];
        if (candidate !== undefined && stepApplies(candidate, state.fulfilmentType))
            return candidate;
    }
    return FIRST_SALE_STEP;
}
