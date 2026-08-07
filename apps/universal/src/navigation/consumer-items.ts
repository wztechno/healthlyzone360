import type { NavigationDescriptor } from './items.ts';

/**
 * The signed-in consumer's destinations, declared as data.
 *
 * Same pattern as `./items.ts`, and for the same reason: "what may this person reach?" stays a pure
 * function over a table, testable without rendering a shell. What differs is the filter. The
 * customer area is authenticated-and-verified for every screen in it (`ROUTE_REQUIREMENTS.customer`)
 * with no per-destination permission, so there is nothing to filter *by permission*. What there is
 * to filter by is **existence**.
 *
 * ## `planned` destinations, and why they are shown rather than hidden
 *
 * Six of these eight screens are built by later waves. Three options were available:
 *
 * 1. link to them anyway — a link that lands on "not found" is a dead control, which the prompt
 *    forbids and which no amount of "it will exist later" excuses;
 * 2. hide them until they exist — the information architecture then arrives in fragments, and
 *    nobody reviewing the prototype can see what the product actually is;
 * 3. show them, mark them, and answer a press with a real explanation.
 *
 * The third is what the reference research recommends independently: doc 17, MKT-04 endorses a
 * **visible-but-locked** pattern — "show the capability, show its current value, state exactly what
 * unlocks it" — and names `usePrototypeAction()` as the place to reuse it. So a `planned` entry is
 * rendered, is focusable, carries a visible marker in its label, and answers a press with the
 * prototype notice naming the endpoint it is waiting for.
 *
 * A later wave flips one `status` field and deletes the `contract` line. Nothing else moves.
 */
export type ConsumerDestinationStatus = 'available' | 'planned';

export interface ConsumerNavigationDescriptor extends NavigationDescriptor {
    readonly status: ConsumerDestinationStatus;
    /**
     * Proposed endpoint or wave the destination is waiting on. Present exactly when `status` is
     * `planned`; shown in development builds by the prototype notice.
     */
    readonly contract?: string | undefined;
    /**
     * Marks the entry whose label carries a live count. Only the cart has one, and it is a named
     * flag rather than a number on the descriptor because the count is data, not configuration.
     */
    readonly badge?: 'cart' | undefined;
}

/**
 * Destinations in display order.
 *
 * `discover` deliberately points out of the customer area and into the public marketplace. That is
 * the intended shape: browsing is the same surface for everybody, and giving signed-in people a
 * second, parallel catalogue is how two catalogues drift apart.
 *
 */
export const CONSUMER_NAVIGATION: readonly ConsumerNavigationDescriptor[] = [
    {
        key: 'home',
        labelKey: 'marketplace:consumer.nav.home',
        href: '/customer',
        icon: 'home',
        area: 'customer',
        status: 'available',
    },
    {
        key: 'discover',
        labelKey: 'marketplace:consumer.nav.discover',
        href: '/discover',
        icon: 'search',
        area: 'public',
        status: 'available',
    },
    {
        key: 'planner',
        labelKey: 'marketplace:consumer.nav.planner',
        href: '/customer/planner',
        icon: 'calendar',
        area: 'customer',
        status: 'available',
    },
    {
        key: 'nutrition',
        labelKey: 'marketplace:consumer.nav.nutrition',
        href: '/customer/nutrition',
        icon: 'leaf',
        area: 'customer',
        status: 'available',
    },
    {
        key: 'virtual-dietitian',
        labelKey: 'marketplace:consumer.nav.virtualDietitian',
        href: '/customer/virtual-dietitian',
        icon: 'sparkle',
        area: 'customer',
        status: 'available',
    },
    {
        key: 'subscriptions',
        labelKey: 'marketplace:consumer.nav.subscriptions',
        href: '/customer/subscriptions',
        icon: 'refresh',
        area: 'customer',
        status: 'available',
    },
    {
        key: 'cart',
        labelKey: 'marketplace:consumer.nav.cart',
        href: '/customer/cart',
        icon: 'basket',
        area: 'customer',
        status: 'available',
        badge: 'cart',
    },
    {
        key: 'profile',
        labelKey: 'marketplace:consumer.nav.profile',
        href: '/profile',
        icon: 'user',
        area: 'auth',
        status: 'available',
    },
];

/**
 * The public marketplace's top-level destinations.
 *
 * Same table. Every entry here now resolves: `meals` and `plans` were `planned` until the catalogue
 * wave built `/meals` and `/plans`, and flipping one `status` field was the whole handoff — which is
 * what the `planned` mechanism was designed to cost.
 */
export const MARKETPLACE_NAVIGATION: readonly ConsumerNavigationDescriptor[] = [
    {
        key: 'discover',
        labelKey: 'marketplace:nav.discover',
        href: '/discover',
        icon: 'search',
        area: 'public',
        status: 'available',
    },
    {
        key: 'kitchens',
        labelKey: 'marketplace:nav.kitchens',
        href: '/kitchens',
        icon: 'organisation',
        area: 'public',
        status: 'available',
    },
    {
        key: 'meals',
        labelKey: 'marketplace:nav.meals',
        href: '/meals',
        icon: 'plate',
        area: 'public',
        status: 'available',
    },
    {
        key: 'plans',
        labelKey: 'marketplace:nav.plans',
        href: '/plans',
        icon: 'calendar',
        area: 'public',
        status: 'available',
    },
    {
        key: 'dietitians',
        labelKey: 'marketplace:nav.dietitians',
        href: '/dietitians',
        icon: 'user',
        area: 'public',
        status: 'available',
    },
    {
        key: 'how-it-works',
        labelKey: 'marketplace:nav.howItWorks',
        href: '/how-it-works',
        icon: 'info',
        area: 'public',
        status: 'available',
    },
    {
        key: 'for-business',
        labelKey: 'marketplace:nav.forBusiness',
        href: '/for-business',
        icon: 'branch',
        area: 'public',
        status: 'available',
    },
];

/** Destinations that genuinely resolve today. Used by the tests that assert no link is dead. */
export function availableDestinations(
    descriptors: readonly ConsumerNavigationDescriptor[],
): readonly ConsumerNavigationDescriptor[] {
    return descriptors.filter((item) => item.status === 'available');
}
