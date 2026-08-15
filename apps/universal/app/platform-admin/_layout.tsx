import { Slot } from 'expo-router';

import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The `platform-admin` area — the operator console for kitchen tenants (PA1).
 *
 * Its registry baseline is the only one that carries an explicit permission, and PA1 changed which
 * one: `organisation.manage_platform`, the code `PermissionRegistry::platformPermissions()`
 * actually issues and the code the seven `/platform/organisations/kitchens` routes are gated on. It
 * used to name `platform.access_admin`, which existed nowhere but the client and therefore refused
 * everybody once the area started talking to a real API.
 *
 * `AreaShell`'s `<Gate area="platform-admin">` refuses anyone without it — including a signed-in
 * organisation owner, who may run a kitchen but does not run the platform.
 */
export default function PlatformAdminLayout() {
    return (
        <AreaShell area="platform-admin" testID="platform-admin-shell">
            <Slot />
        </AreaShell>
    );
}
