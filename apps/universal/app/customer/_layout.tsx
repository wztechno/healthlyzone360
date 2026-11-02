import { Redirect, Slot, useGlobalSearchParams, usePathname } from 'expo-router';
import { useState } from 'react';

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
 *
 * ## The router reports the bare area while the session restores
 *
 * Loading or refreshing `/customer/account` used to end on `/discover`, for all of the area's links.
 * The gate holds `<Slot />` back until the session is known, and the root state drops the nested
 * state of a route whose navigator has not mounted (`useOnGetState`), so for that stretch
 * `usePathname()` reads `/customer` and its params are gone. The nested state itself survives, so
 * the page comes back once the gate opens: every other area recovers unnoticed. Only this layout
 * acts on the pathname meanwhile.
 *
 * So a bare `/customer` is read as the address this layout arrived on. If that was bare too, it
 * really is the bare link. If not, either the gate is still closed, or somebody navigated here in
 * the app, where `customer/index.tsx` forwards them. The channel is lost the same way, and a
 * business buyer refreshing the wholesale checkout needs it.
 */
export default function CustomerLayout() {
    const reportedPathname = usePathname();
    const { channel: reportedChannel } = useGlobalSearchParams<{ channel?: string }>();
    const [arrival] = useState({ pathname: reportedPathname, channel: reportedChannel });
    const bare = reportedPathname === '/customer' || reportedPathname === '/customer/';
    const pathname = bare ? arrival.pathname : reportedPathname;
    const channel = bare ? arrival.channel : reportedChannel;
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
