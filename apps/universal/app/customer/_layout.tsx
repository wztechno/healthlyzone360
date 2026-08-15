import { Redirect, Slot, usePathname } from 'expo-router';

import { isPathAvailable } from '../../src/features/availability.ts';
import { ConsumerShell } from '../../src/shell/consumer-shell.tsx';

/**
 * The `customer` area. `ConsumerShell` applies `<Gate area="customer">` and the consumer chrome —
 * a sidebar at `lg` and above, bottom tabs below it.
 *
 * Screens inside the area whose feature has no backend yet (planner, grocery, recipes, nutrition,
 * onboarding, virtual dietitian) redirect to the area's home before any of that mounts. `/customer`
 * itself is always available, so the redirect cannot loop.
 */
export default function CustomerLayout() {
    const pathname = usePathname();

    if (!isPathAvailable(pathname)) return <Redirect href="/customer" />;

    return (
        <ConsumerShell>
            <Slot />
        </ConsumerShell>
    );
}
