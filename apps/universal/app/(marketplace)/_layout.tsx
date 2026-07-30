import { Slot } from 'expo-router';

import { Gate } from '../../src/access/gate.tsx';
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
 */
export default function MarketplaceLayout() {
    return (
        <Gate area="public">
            <MarketplaceShell>
                <Slot />
            </MarketplaceShell>
        </Gate>
    );
}
