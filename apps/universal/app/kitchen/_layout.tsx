import { Slot } from 'expo-router';

import { KitchenOpsShell } from '../../src/features/kitchen-admin/kitchen-ops-shell.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `kitchen` area. `AreaShell` applies `<Gate area="kitchen">` and this area's chrome. */
export default function KitchenLayout() {
    return (
        <AreaShell area="kitchen" testID="kitchen-shell">
            <KitchenOpsShell>
                <Slot />
            </KitchenOpsShell>
        </AreaShell>
    );
}
