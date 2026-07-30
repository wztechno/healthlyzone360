import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/** The `corporate` area. `AreaShell` applies `<Gate area="corporate">` and this area's chrome. */
export default function CorporateLayout() {
    return (
        <AreaShell area="corporate" testID="corporate-shell">
            <Slot />
        </AreaShell>
    );
}
