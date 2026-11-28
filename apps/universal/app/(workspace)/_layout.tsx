import { Slot, usePathname } from 'expo-router';

import { Gate } from '../../src/access/gate.tsx';
import { WorkspaceOrgSwitcher } from '../../src/screens/workspace-selector-screen.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The cross-area workspace surface: the workspace selector, the profile summary and device
 * management. These are not one role area — they are the screens a signed-in person reaches from
 * *any* area — so the guard is written directly rather than taken from an area baseline.
 *
 * No organisation is demanded. A consumer with a global identity (decision D1) must still be able
 * to see their profile and revoke a session.
 */
export default function WorkspaceLayout() {
    const pathname = usePathname();
    return (
        <Gate area="auth" requirement={{ requiresAuth: true, requiresVerifiedEmail: true }}>
            <AreaShell
                area="auth"
                variant="workspace"
                unguarded
                testID="workspace-shell"
                topbarTitle={pathname === '/workspace' ? <WorkspaceOrgSwitcher /> : undefined}
            >
                <Slot />
            </AreaShell>
        </Gate>
    );
}
