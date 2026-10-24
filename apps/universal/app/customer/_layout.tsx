import { Redirect, Slot, usePathname } from 'expo-router';

import { isPathAvailable } from '../../src/features/availability.ts';
import { isShopViewOnly } from '../../src/features/marketplace/shop-view-only.tsx';
import { useAccessState } from '../../src/session/session-provider.tsx';
import { ConsumerShell } from '../../src/shell/consumer-shell.tsx';

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
    // Staff view the shop and own nothing in it — no basket, account, orders or subscriptions — so
    // every page here sends them back to the shop's home (`shop-view-only.tsx`).
    const viewOnly = isShopViewOnly(useAccessState());

    if (pathname === '/customer' || pathname === '/customer/') return <Redirect href="/discover" />;
    if (viewOnly) return <Redirect href="/discover" />;
    if (!isPathAvailable(pathname)) return <Redirect href="/discover" />;

    return (
        <ConsumerShell>
            <Slot />
        </ConsumerShell>
    );
}
