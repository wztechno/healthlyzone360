import { Redirect, Slot, usePathname } from 'expo-router';

import { Gate } from '../../src/access/gate.tsx';
import { isPathAvailable } from '../../src/features/availability.ts';
import { MarketplaceShell } from '../../src/shell/marketplace-shell.tsx';

/**
 * The public marketplace group.
 *
 * A *group* rather than a route segment: the parentheses keep `(marketplace)` out of the URL, so the
 * catalogue lives at `/kitchens` and `/discover` where a person and a search engine expect it,
 * while the layout still applies to every screen inside it.
 *
 * The gate is `public`, which is a build-mode check and nothing more — no session is demanded and
 * none is implied. It is still written explicitly rather than omitted, because "this area is
 * deliberately open" and "somebody forgot the guard" must not look the same in the source.
 *
 * Ahead of it sits the availability check: `/dietitians`, `/diets` and `/tools` are compiled into
 * this build and have no backend, so a direct hit on one lands on `/discover` — which is available,
 * so the redirect cannot loop.
 */
export default function MarketplaceLayout() {
    const pathname = usePathname();

    if (!isPathAvailable(pathname)) return <Redirect href="/discover" />;

    return (
        <Gate area="public">
            <MarketplaceShell>
                <Slot />
            </MarketplaceShell>
        </Gate>
    );
}
