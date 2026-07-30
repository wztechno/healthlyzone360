import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `customer` area. `AreaShell` applies `<Gate area="customer">` and this area's chrome. */
export default function CustomerLayout() {
    return (
        <AreaShell area="customer" testID="customer-shell">
            <Slot />
        </AreaShell>
    );
}
