import { Redirect, Slot, useGlobalSearchParams, usePathname } from 'expo-router';

import { B2B_CART_CHANNEL_CODE } from '../../src/data/business-hooks.ts';
import { isPathAvailable } from '../../src/features/availability.ts';
import { isShopViewOnly } from '../../src/features/marketplace/shop-view-only.tsx';
import { isBusinessCustomer } from '../../src/session/machine.ts';
import { useAccessState, useSession } from '../../src/session/session-provider.tsx';
import { ConsumerShell } from '../../src/shell/consumer-shell.tsx';

/**
 * A business buyer's wholesale checkout — where `/corporate` sends its basket — and the two places
 * that checkout leads: a new delivery address, and the order it placed. The only customer pages a
 * business buyer keeps; everything else here is the retail shop, which they browse read-only.
 */
function isWholesaleCheckoutPath(pathname: string, channel: string | undefined): boolean {
    if (pathname === '/customer/checkout') return channel === B2B_CART_CHANNEL_CODE;
    return (
        pathname.startsWith('/customer/account/addresses') ||
        pathname.startsWith('/customer/orders/')
    );
}

/**
 * The `customer` area. `ConsumerShell` applies `<Gate area="customer">` and the customer header —
 * the same chrome the public marketplace wears, so the basket and the account read as the same
 * site as the menu.
 *
 * Screens inside the area whose feature has no backend yet (planner, grocery, recipes, nutrition,
 * onboarding, virtual dietitian) redirect to the marketplace home before any of that mounts.
 * `/discover` is outside this layout, so the redirect cannot loop.
 *
 * The bare `/customer` forwards to `/discover` here too, ahead of the gate. `customer/index.tsx`
 * says the same, but it renders inside `ConsumerShell`, whose gate sent a signed-out visitor with an
 * old link to sign-in before the index ever mounted — the one home is for everybody.
 */
export default function CustomerLayout() {
    const pathname = usePathname();
    const { channel } = useGlobalSearchParams<{ channel?: string }>();
    const { me } = useSession();
    // Staff and business buyers view the shop and own nothing in it — no basket, account, orders or
    // subscriptions — so every page here sends them back to the shop's home (`shop-view-only.tsx`).
    const viewOnly = isShopViewOnly(useAccessState());
    const wholesale =
        isBusinessCustomer(me?.memberships ?? []) && isWholesaleCheckoutPath(pathname, channel);

    if (pathname === '/customer' || pathname === '/customer/') return <Redirect href="/discover" />;
    if (viewOnly && !wholesale) return <Redirect href="/discover" />;
    if (!isPathAvailable(pathname)) return <Redirect href="/discover" />;

    return (
        <ConsumerShell>
            <Slot />
        </ConsumerShell>
    );
}
