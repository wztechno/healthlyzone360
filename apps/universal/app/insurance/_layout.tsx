import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `insurance` area. `AreaShell` applies `<Gate area="insurance">` and this area's chrome. */
export default function InsuranceLayout() {
    return (
        <AreaShell area="insurance" testID="insurance-shell">
            <Slot />
        </AreaShell>
    );
}
