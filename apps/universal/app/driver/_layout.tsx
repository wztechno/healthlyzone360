import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `driver` area. `AreaShell` applies `<Gate area="driver">` and this area's chrome. */
export default function DriverLayout() {
    return (
        <AreaShell area="driver" testID="driver-shell">
            <Slot />
        </AreaShell>
    );
}
