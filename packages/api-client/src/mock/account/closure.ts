import type {
    ClosureBlocker,
    ClosureBlockerCode,
    ClosurePreconditions,
} from '../../contracts/account.ts';

/**
 * The J2 blocker registry, as arithmetic.
 *
 * Seven checks, run in the backend's own order, each answering one of four statuses. Kept out of
 * `./store.ts` because none of it needs the mutable world — it is a function from "what else exists"
 * to "may this account close", and that is exactly the part worth asserting directly.
 *
 * ## Why `not_applicable` is a first-class answer
 *
 * Two of these checks have no module behind them. `wallet_balance` and `payment_methods` cannot be
 * evaluated because PAY1 is discovery-gated and there is no wallet and no stored instrument to look
 * at. A registry that answered `clear` for them would be telling somebody their balance is settled
 * on the strength of code nobody has written — and it would keep saying so, wrongly and silently,
 * on the day payments ship. So the check reports that it did not run, and the wizard prints that.
 *
 * The same rule covers a module that exists but is not *wired to this world*: an account world built
 * without a subscriptions port answers `subscriptions_module_absent`, not `clear`. The distinction
 * between "you have no subscriptions" and "nobody asked" is the whole point.
 *
 * ## Advisory is not a soft blocker
 *
 * An unsettled credit memo does not stop a closure and must not be drawn as though it might. It is
 * information somebody needs *before* the account it is attached to disappears — the memo is settled
 * by hand, and after closure there is no account to settle it against. The wizard acknowledges it;
 * it never resolves it.
 */

/**
 * What else exists in this world.
 *
 * Every member is optional. An absent member is not zero — it is "this module is not bound", which
 * the registry reports as `not_applicable` with the backend's own reason string. That is what makes
 * a mock world assembled without the prototype store honest rather than quietly reassuring.
 */
export interface ClosureWorldPorts {
    readonly openOrders?: (() => number) | undefined;
    readonly liveSubscriptions?: (() => number) | undefined;
    readonly upcomingDeliveries?: (() => number) | undefined;
    readonly unsettledCreditMemos?: (() => number) | undefined;
    readonly organisationMemberships?: (() => number) | undefined;
    readonly pendingB2bSignatures?: (() => number) | undefined;
}

/** Where a person goes to deal with a blocker. Client-side routing; the server owns only the fact. */
const RESOLVE_HREF: Readonly<Record<ClosureBlockerCode, string | null>> = {
    open_orders: '/customer/orders',
    active_subscriptions: '/customer/subscriptions',
    organisation_memberships: null,
    pending_b2b_signatures: '/apply/agreement',
    unsettled_credit_memos: '/customer/subscriptions',
    wallet_balance: null,
    payment_methods: null,
};

function blocker(
    code: ClosureBlockerCode,
    status: ClosureBlocker['status'],
    count: number,
    reason: string | null,
): ClosureBlocker {
    return { code, status, count, reason, resolveHref: RESOLVE_HREF[code] };
}

const clear = (code: ClosureBlockerCode): ClosureBlocker => blocker(code, 'clear', 0, null);
const absent = (code: ClosureBlockerCode, reason: string): ClosureBlocker =>
    blocker(code, 'not_applicable', 0, reason);

/**
 * What is retained after everything else is destroyed.
 *
 * Said up front rather than in a policy. Orders keep their amounts, dates and delivery area so the
 * business can still account for them; the delivery lines are redacted. A one-way fingerprint of the
 * email and the phone numbers is kept so "never contact me again" outlives the deletion of the
 * contact itself — which exists in the person's interest, and is why it is stated on the way in.
 *
 * The backend publishes no named vocabulary for this (its `ClosureReport` counts *actions*, not
 * retained categories), so these four codes are the application's own and are translated as such.
 */
export const RETAINED_RECORD_CODES: readonly string[] = [
    'orders_anonymised',
    'credit_memos',
    'contact_suppression',
    'closure_tombstone',
];

/** The seven checks, in the backend's registration order. */
export function evaluateClosureBlockers(ports: ClosureWorldPorts): readonly ClosureBlocker[] {
    const orders = ports.openOrders?.();
    const live = ports.liveSubscriptions?.();
    const upcoming = ports.upcomingDeliveries?.();
    const memos = ports.unsettledCreditMemos?.();
    const memberships = ports.organisationMemberships?.();
    const signatures = ports.pendingB2bSignatures?.();

    return [
        orders === undefined
            ? absent('open_orders', 'orders_module_absent')
            : orders > 0
              ? blocker('open_orders', 'blocking', orders, 'orders_in_flight')
              : clear('open_orders'),

        live === undefined && upcoming === undefined
            ? absent('active_subscriptions', 'subscriptions_module_absent')
            : (live ?? 0) > 0
              ? blocker('active_subscriptions', 'blocking', live ?? 0, 'subscriptions_live')
              : (upcoming ?? 0) > 0
                ? blocker('active_subscriptions', 'blocking', upcoming ?? 0, 'deliveries_upcoming')
                : clear('active_subscriptions'),

        memberships === undefined
            ? absent('organisation_memberships', 'organisations_module_absent')
            : memberships > 0
              ? blocker('organisation_memberships', 'blocking', memberships, 'memberships_live')
              : clear('organisation_memberships'),

        signatures === undefined
            ? absent('pending_b2b_signatures', 'b2b_module_absent')
            : signatures > 0
              ? blocker('pending_b2b_signatures', 'blocking', signatures, 'signatures_pending')
              : clear('pending_b2b_signatures'),

        // Advisory, never blocking. A memo is settled by hand, and after closure there is no
        // account to settle it against — so it is said, acknowledged, and does not stop anything.
        memos === undefined
            ? absent('unsettled_credit_memos', 'subscriptions_module_absent')
            : memos > 0
              ? blocker('unsettled_credit_memos', 'advisory', memos, 'credit_memos_unsettled')
              : clear('unsettled_credit_memos'),

        absent('wallet_balance', 'no_wallet_module'),
        absent('payment_methods', 'no_payment_module'),
    ];
}

export function closurePreconditions(ports: ClosureWorldPorts): ClosurePreconditions {
    const blockers = evaluateClosureBlockers(ports);
    return {
        // Only `blocking` stops a closure. `advisory` and `not_applicable` never do, and the
        // verdict is computed here — once — so no screen has to know that.
        canClose: !blockers.some((entry) => entry.status === 'blocking'),
        blockers,
        retainedRecordCodes: RETAINED_RECORD_CODES,
    };
}
