import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `kds` area. `AreaShell` applies `<Gate area="kds">` and this area's chrome. */
export default function KdsLayout() {
    return (
        <AreaShell area="kds" testID="kds-shell">
            <Slot />
        </AreaShell>
    );
}
