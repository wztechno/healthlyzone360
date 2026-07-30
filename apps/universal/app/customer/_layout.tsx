import { Slot } from 'expo-router';

import { ConsumerShell } from '../../src/shell/consumer-shell.tsx';

/**
 * The `customer` area. `ConsumerShell` applies `<Gate area="customer">` and the consumer chrome —
 * a sidebar at `lg` and above, bottom tabs below it.
 */
export default function CustomerLayout() {
    return (
        <ConsumerShell>
            <Slot />
        </ConsumerShell>
    );
}
