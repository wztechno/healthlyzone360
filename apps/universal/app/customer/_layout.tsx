import { Redirect, Slot, usePathname } from 'expo-router';

import { isPathAvailable } from '../../src/features/availability.ts';
import { ConsumerShell } from '../../src/shell/consumer-shell.tsx';

/**
 * The `customer` area. `ConsumerShell` applies `<Gate area="customer">` and the customer header —
 * the same chrome the public marketplace wears, so the basket and the account read as the same
 * site as the menu.
 *
 * Screens inside the area whose feature has no backend yet (planner, grocery, recipes, nutrition,
 * onboarding, virtual dietitian) redirect to the marketplace home before any of that mounts.
 * `/discover` is outside this layout, so the redirect cannot loop.
 */
export default function CustomerLayout() {
    const pathname = usePathname();

    if (!isPathAvailable(pathname)) return <Redirect href="/discover" />;

    return (
        <ConsumerShell>
            <Slot />
        </ConsumerShell>
    );
}
