import type { KitchenOrder } from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';

import {
    DEFAULT_ORDERS_QUERY,
    landingHref,
    ordersHref,
    ordersParams,
    readOrdersQuery,
} from './orders-url.ts';

/**
 * The Orders page keeps every choice in its address, so a detour comes back to the view it left.
 */

function placed(
    day: string | null,
    placedAt = '2026-11-10T09:00:00Z',
): Pick<KitchenOrder, 'id' | 'delivery' | 'placedAt'> {
    return {
        id: 'order-9' as OrderId,
        placedAt,
        delivery: {
            label: null,
            lineOne: null,
            lineTwo: null,
            city: null,
            areaNameEn: null,
            areaNameAr: null,
            areaId: null,
            windowCode: 'lunch',
            requestedDate: day,
            zoneId: null,
        },
    };
}

describe('orders — the address', () => {
    it('opens on Today with nothing narrowed', () => {
        expect(readOrdersQuery({})).toEqual(DEFAULT_ORDERS_QUERY);
        expect(ordersHref({})).toBe('/kitchen/orders?tab=today');
    });

    it('reads the old order book’s ?view= link as All orders with that order open', () => {
        const query = readOrdersQuery({ view: 'order-1' });
        expect(query.tab).toBe('all');
        expect(query.view).toBe('order-1');
        // An explicit tab wins.
        expect(readOrdersQuery({ view: 'order-1', tab: 'today' }).tab).toBe('today');
    });

    it('falls back to the default for anything malformed', () => {
        const query = readOrdersQuery({
            tab: 'kitchen',
            day: '2026-02-31',
            month: '2026-13',
            slot: 'brunch',
            kind: 'drone',
            dates: 'forever',
            status: 'lost',
            quick: 'everything',
        });
        expect(query).toEqual(DEFAULT_ORDERS_QUERY);
    });

    it('writes only what differs from the default, the tab always', () => {
        expect(ordersHref({ tab: 'all', quick: 'late' })).toBe(
            '/kitchen/orders?tab=all&quick=late',
        );
        expect(ordersHref({ tab: 'today', day: '2026-11-11', slot: 'lunch' })).toBe(
            '/kitchen/orders?tab=today&day=2026-11-11&slot=lunch',
        );
        // A default is written as undefined, which is what takes a param off the address.
        expect(ordersParams({ ...DEFAULT_ORDERS_QUERY, q: '' }).q).toBeUndefined();
    });
});

describe('orders — where a placed or saved order lands', () => {
    it('lands on Today, on the order’s own day, lit up — filters cleared', () => {
        const from = ordersHref({ tab: 'today', day: '2026-11-12', slot: 'dinner', q: 'rania' });
        expect(landingHref(from, placed('2026-11-14'), '2026-11-10')).toBe(
            '/kitchen/orders?tab=today&day=2026-11-14&hl=order-9',
        );
        // Today's own day is the default and is left off.
        expect(landingHref(from, placed('2026-11-10'), '2026-11-10')).toBe(
            '/kitchen/orders?tab=today&hl=order-9',
        );
    });

    it('lands in the calendar on the order’s day and month', () => {
        const from = ordersHref({ tab: 'calendar', sel: '2026-11-12', mode: 'week' });
        expect(landingHref(from, placed('2026-12-02'), '2026-11-10')).toBe(
            '/kitchen/orders?tab=calendar&month=2026-12&mode=week&sel=2026-12-02&hl=order-9',
        );
    });

    it('lands back on All orders, lit up', () => {
        const from = ordersHref({ tab: 'all', status: 'cancelled', quick: 'late' });
        expect(landingHref(from, placed('2026-11-14'), '2026-11-10')).toBe(
            '/kitchen/orders?tab=all&hl=order-9',
        );
    });

    it('goes back to any other page as it was, and to Today with no return at all', () => {
        expect(landingHref('/kitchen/customers?view=c-1', placed('2026-11-14'), '2026-11-10')).toBe(
            '/kitchen/customers?view=c-1',
        );
        expect(landingHref(null, placed(null, '2026-11-09T09:00:00Z'), '2026-11-10')).toBe(
            '/kitchen/orders?tab=today&day=2026-11-09&hl=order-9',
        );
    });
});
