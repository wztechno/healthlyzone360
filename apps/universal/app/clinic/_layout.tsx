import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `clinic` area. `AreaShell` applies `<Gate area="clinic">` and this area's chrome. */
export default function ClinicLayout() {
    return (
        <AreaShell area="clinic" testID="clinic-shell">
            <Slot />
        </AreaShell>
    );
}
