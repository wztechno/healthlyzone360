import { DensityProvider } from '@healthy360/design-system';
import { Slot } from 'expo-router';
import { View } from 'react-native';

import {
    PlatformAdminBrandBlock,
    usePlatformAdminNavigation,
} from '../../src/features/platform-admin/platform-admin-chrome.tsx';
import { AreaRailTop, DESK_SIDEBAR_WIDTH } from '../../src/shell/area-brand-block.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The `platform-admin` area — the operator console for kitchen tenants (PA1) and the B2B
 * onboarding queue.
 *
 * Its registry baseline is the only one that carries an explicit permission, and PA1 changed which
 * one: `organisation.manage_platform`, the code `PermissionRegistry::platformPermissions()`
 * actually issues and the code the seven `/platform/organisations/kitchens` routes are gated on. It
 * used to name `platform.access_admin`, which existed nowhere but the client and therefore refused
 * everybody once the area started talking to a real API.
 *
 * `AreaShell`'s `<Gate area="platform-admin">` refuses anyone without it — including a signed-in
 * organisation owner, who may run a kitchen but does not run the platform.
 *
 * The rail is the corporate area's desk shell with the console's two destinations; an operator
 * works it at a desk with a mouse, so pages render on the compact ladder.
 */
export default function PlatformAdminLayout() {
    const navigation = usePlatformAdminNavigation();

    return (
        <AreaShell
            area="platform-admin"
            testID="platform-admin-shell"
            navigation={navigation}
            sidebarWidth={DESK_SIDEBAR_WIDTH}
            sidebarStart={<PlatformAdminBrandBlock />}
            sidebarStartCollapsed={<AreaRailTop testID="platform-admin-rail-top" />}
        >
            <DensityProvider value="compact">
                <View testID="platform-admin-content" className="min-h-0 min-w-0 flex-1">
                    <Slot />
                </View>
            </DensityProvider>
        </AreaShell>
    );
}
