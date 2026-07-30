import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `pos` area. `AreaShell` applies `<Gate area="pos">` and this area's chrome. */
export default function PosLayout() {
    return (
        <AreaShell area="pos" testID="pos-shell">
            <Slot />
        </AreaShell>
    );
}
