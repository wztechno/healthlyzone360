import type {
    OrderDeskCustomerContact,
    OrderDeskQueueMeta,
    OrderDeskQueueRow,
} from '../contracts/order-desk.ts';
import type {
    OrderDeskCustomerContact as WireOrderDeskCustomerContact,
    OrderDeskQueueEnvelope,
    OrderDeskRow as WireOrderDeskRow,
} from '../generated/types.ts';
import { mapKitchenOrder } from './kitchen-orders-repository.ts';

/**
 * The queue's two wire shapes, in domain terms.
 *
 * Its own file rather than functions at the top of `order-desk-repository.ts` — the naming follows
 * `driver-jobs-mappers.ts` / `kitchen-admin-mappers.ts` / `plan-mappers.ts`, and the split keeps the
 * repository about transport: the path, the query string and the one read.
 *
 * ## The row is composed, not copied
 *
 * `OrderDeskRow` is `KitchenOrder & {…}` on the wire and {@link OrderDeskQueueRow} extends
 * `KitchenOrder` in the contract, so the mapping is {@link mapKitchenOrder} plus the four fields the
 * desk adds. Restating the twenty kitchen-order fields here would be a second copy of a mapping that
 * already exists and already has a test — and the day the order shape gains a column, one of the two
 * copies would get it.
 */

function mapCustomer(wire: WireOrderDeskCustomerContact): OrderDeskCustomerContact {
    return {
        displayName: wire.display_name,
        phone: wire.phone,
    };
}

/**
 * One queue row.
 *
 * `customer` is spread conditionally rather than assigned as `wire.customer ?? undefined`, because
 * the *presence* of the key is the disclosure signal — see `contracts/order-desk.ts`. An absent
 * block means "you may not read contact details"; a present block with `display_name: null` means
 * "this account has no name". Writing `customer: undefined` unconditionally would erase that
 * difference under `exactOptionalPropertyTypes`, and a screen would have no way to tell a refusal
 * from an anonymised customer.
 *
 * `payment` and `delivery_job` are carried through as they arrive — always `null` in this phase, and
 * deliberately not defaulted to `{}`: an empty object would claim a receipt exists with nothing in
 * it, which is the one reading of this field that is never true.
 */
export function mapOrderDeskQueueRow(wire: WireOrderDeskRow): OrderDeskQueueRow {
    return {
        ...mapKitchenOrder(wire),
        dueAt: wire.due_at,
        payment: wire.payment,
        deliveryJob: wire.delivery_job,
        ...(wire.customer === undefined ? {} : { customer: mapCustomer(wire.customer) }),
    };
}

/**
 * What the server measured the queue against.
 *
 * Read from the generated envelope's own meta type rather than re-declared, on the terms
 * `marketplace-mappers.ts` reads its cursor meta: every field here is required on the wire, so there
 * is nothing to default and no place for a fallback to invent a fact. In particular `truncated` is
 * never defaulted — a missing-and-therefore-false reading would tell a screen that a capped queue is
 * the whole one, which is exactly the silence this field exists to break.
 */
export function mapOrderDeskQueueMeta(wire: OrderDeskQueueEnvelope['meta']): OrderDeskQueueMeta {
    return {
        count: wire.count,
        limit: wire.limit,
        truncated: wire.truncated,
        window: wire.window,
        today: wire.today,
        timezone: wire.timezone,
    };
}
