import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `patient` area. `AreaShell` applies `<Gate area="patient">` and this area's chrome. */
export default function PatientLayout() {
    return (
        <AreaShell area="patient" testID="patient-shell">
            <Slot />
        </AreaShell>
    );
}
