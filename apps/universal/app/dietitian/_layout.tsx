import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `dietitian` area. `AreaShell` applies `<Gate area="dietitian">` and this area's chrome. */
export default function DietitianLayout() {
    return (
        <AreaShell area="dietitian" testID="dietitian-shell">
            <Slot />
        </AreaShell>
    );
}
