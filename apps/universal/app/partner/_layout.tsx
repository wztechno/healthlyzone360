import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `partner` area. `AreaShell` applies `<Gate area="partner">` and this area's chrome. */
export default function PartnerLayout() {
    return (
        <AreaShell area="partner" testID="partner-shell">
            <Slot />
        </AreaShell>
    );
}
