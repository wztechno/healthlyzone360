import type {
    OrderDeskQueue,
    OrderDeskQueueFilters,
    OrderDeskRepository,
} from '../contracts/order-desk.ts';
import type {
    OrderDeskQueueEnvelope,
    OrderDeskRow as WireOrderDeskRow,
} from '../generated/types.ts';
import { mapOrderDeskQueueMeta, mapOrderDeskQueueRow } from './order-desk-mappers.ts';
import type { Transport } from './transport.ts';

/**
 * The Order Desk queue, backed by the real Laravel route under `/catalogue/order-desk`.
 *
 * ## One read, no cursor, and `meta` is not optional here
 *
 * `kitchen-orders-repository.ts` uses `requestEnvelope` to lift a cursor out of `meta`; this module
 * uses it because `meta` carries the *answer's own terms* — how many rows the server will ever give,
 * whether it hit that ceiling, and which day on whose clock the window was measured from. A screen
 * that dropped them would render a capped queue as if it were the whole book, and would have no way
 * to say which "today" it is showing. So the envelope is answered whole (`{ rows, meta }`) rather
 * than as a bare array.
 *
 * ## The query string, and the one place it disagrees with the OpenAPI document
 *
 * Every filter is optional and every omitted one means "do not narrow" — the server defaults the
 * window to `today` and lists both open statuses. Two details are worth stating.
 *
 * **`status` is sent in PHP's bracket form** (`status[]=placed`), not the `style: form, explode:
 * true` form the specification declares (`status=placed&status=confirmed`). The declared form does
 * not survive PHP: repeated bare parameters collapse to the last value, and the controller validates
 * `status` as an `array`, so the exploded form would earn a 422 on every multi-status request. The
 * bracket form is what the endpoint's own Pest suite sends (`http_build_query(['status' =>
 * ['placed']])`), and it is what works. The specification is the thing that is wrong here; this
 * module is not the place to fix it.
 *
 * **`branch_id` is a query parameter, not the `X-Branch-Id` header** the stock surfaces send. That
 * is the endpoint's convention for the whole `order-desk` family and it is deliberate: an
 * organisation-wide desk agent selects no branch, so a header that had to be present could not
 * express the organisation-wide read. See `contracts/order-desk.ts`.
 *
 * ## No writes
 *
 * There is nothing here to lock-version and no `If-Match` anywhere, because the queue only reads.
 * The lifecycle writes an order needs are `kitchenOrders`' — the same rows, the same `lockVersion`,
 * one contract — and duplicating them behind a desk-shaped name would give two modules the ability
 * to move the same order with two different ideas of what version they hold.
 */

/** Same shape as `kitchen-orders-repository.ts`'s `ordersQuery`, narrowed to this endpoint's filters. */
function queueQuery(filters?: OrderDeskQueueFilters): string {
    if (filters === undefined) return '';

    const search = new URLSearchParams();
    if (filters.window !== undefined) search.set('window', filters.window);
    if (filters.branchId !== undefined) search.set('branch_id', String(filters.branchId));
    for (const status of filters.statuses ?? []) {
        // Bracket form, not `style: form` — see the header. An empty array appends nothing, which
        // is the same request as no filter at all and the same answer the server gives it.
        search.append('status[]', status);
    }
    if (filters.deliveryWindowCode !== undefined) {
        search.set('delivery_window_code', filters.deliveryWindowCode);
    }
    if (filters.query !== undefined && filters.query.trim() !== '') {
        search.set('query', filters.query.trim());
    }

    const rendered = search.toString();
    return rendered === '' ? '' : `?${rendered}`;
}

export function createApiOrderDeskRepository(transport: Transport): OrderDeskRepository {
    return {
        async listQueue(filters?: OrderDeskQueueFilters): Promise<OrderDeskQueue> {
            const envelope = await transport.requestEnvelope<readonly WireOrderDeskRow[]>({
                method: 'GET',
                path: `/catalogue/order-desk/queue${queueQuery(filters)}`,
            });

            return {
                rows: envelope.data.map(mapOrderDeskQueueRow),
                meta: mapOrderDeskQueueMeta(envelope.meta as OrderDeskQueueEnvelope['meta']),
            };
        },
    };
}
