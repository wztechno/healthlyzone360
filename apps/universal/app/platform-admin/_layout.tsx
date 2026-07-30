import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The `platform-admin` area. Its registry baseline is the only one that carries an explicit
 * permission (`platform.access_admin`), so `AreaShell`'s `<Gate area="platform-admin">` refuses
 * anyone else — including a signed-in organisation owner.
 */
export default function PlatformAdminLayout() {
    return (
        <AreaShell area="platform-admin" testID="platform-admin-shell">
            <Slot />
        </AreaShell>
    );
}
