import { isPathAvailable } from '../features/availability.ts';
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
 * ## Destinations without a backend are hidden, not marked
 *
 * They used to be shown, marked with a "planned" suffix, and answered with a prototype notice naming
 * the endpoint they were waiting on — the visible-but-locked pattern. That was the right call while
 * the whole application was a prototype over synthetic data and a reviewer needed to see the shape
 * of the product. It is the wrong call now that the rest of the app talks to a real API: a person
 * using the product cannot tell "coming later" from "broken", and every marked entry is a control
 * that costs a tap to learn nothing.
 *
 * So the table stays complete — it is still the description of what the product is — and the two
 * exported functions filter it through `../features/availability.ts`. A feature key flips to `true`
 * and its destination reappears; nothing else moves.
 */
export interface ConsumerNavigationDescriptor extends NavigationDescriptor {
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
 */
export const CONSUMER_NAVIGATION: readonly ConsumerNavigationDescriptor[] = [
    {
        key: 'home',
        labelKey: 'marketplace:consumer.nav.home',
        href: '/customer',
        icon: 'home',
        area: 'customer',
    },
    {
        key: 'discover',
        labelKey: 'marketplace:consumer.nav.discover',
        href: '/discover',
        icon: 'search',
        area: 'public',
    },
    {
        key: 'planner',
        labelKey: 'marketplace:consumer.nav.planner',
        href: '/customer/planner',
        icon: 'calendar',
        area: 'customer',
    },
    {
        key: 'nutrition',
        labelKey: 'marketplace:consumer.nav.nutrition',
        href: '/customer/nutrition',
        icon: 'leaf',
        area: 'customer',
    },
    {
        key: 'virtual-dietitian',
        labelKey: 'marketplace:consumer.nav.virtualDietitian',
        href: '/customer/virtual-dietitian',
        icon: 'sparkle',
        area: 'customer',
    },
    {
        key: 'subscriptions',
        labelKey: 'marketplace:consumer.nav.subscriptions',
        href: '/customer/subscriptions',
        icon: 'refresh',
        area: 'customer',
    },
    {
        key: 'cart',
        labelKey: 'marketplace:consumer.nav.cart',
        href: '/customer/cart',
        icon: 'basket',
        area: 'customer',
        badge: 'cart',
    },
    {
        key: 'profile',
        labelKey: 'marketplace:consumer.nav.profile',
        href: '/profile',
        icon: 'user',
        area: 'auth',
    },
];

/** The public marketplace's top-level destinations. */
export const MARKETPLACE_NAVIGATION: readonly ConsumerNavigationDescriptor[] = [
    {
        key: 'discover',
        labelKey: 'marketplace:nav.discover',
        href: '/discover',
        icon: 'search',
        area: 'public',
    },
    {
        key: 'kitchens',
        labelKey: 'marketplace:nav.kitchens',
        href: '/kitchens',
        icon: 'organisation',
        area: 'public',
    },
    {
        key: 'meals',
        labelKey: 'marketplace:nav.meals',
        href: '/meals',
        icon: 'plate',
        area: 'public',
    },
    {
        key: 'plans',
        labelKey: 'marketplace:nav.plans',
        href: '/plans',
        icon: 'calendar',
        area: 'public',
    },
    {
        key: 'dietitians',
        labelKey: 'marketplace:nav.dietitians',
        href: '/dietitians',
        icon: 'user',
        area: 'public',
    },
    {
        key: 'how-it-works',
        labelKey: 'marketplace:nav.howItWorks',
        href: '/how-it-works',
        icon: 'info',
        area: 'public',
    },
    {
        key: 'for-business',
        labelKey: 'marketplace:nav.forBusiness',
        href: '/for-business',
        icon: 'branch',
        area: 'public',
    },
];

/** The consumer destinations that resolve today. */
export function consumerNavigation(): readonly ConsumerNavigationDescriptor[] {
    return CONSUMER_NAVIGATION.filter((item) => isPathAvailable(item.href));
}

/** The public destinations that resolve today. */
export function marketplaceNavigation(): readonly ConsumerNavigationDescriptor[] {
    return MARKETPLACE_NAVIGATION.filter((item) => isPathAvailable(item.href));
}
