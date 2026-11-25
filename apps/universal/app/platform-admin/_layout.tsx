import { AreaLookScope, DensityProvider, SectionLook } from '@healthy360/design-system';
import { Slot } from 'expo-router';
import { View } from 'react-native';

import { DeskTrail } from '../../src/features/kitchen-admin/desk-kit/desk-trail.tsx';
import {
    usePlatformAdminNavigation,
    usePlatformTrail,
} from '../../src/features/platform-admin/platform-admin-chrome.tsx';
import { DESK_SIDEBAR_WIDTH } from '../../src/shell/area-brand-block.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';
import { TrailLeafProvider } from '../../src/shell/area-trail.tsx';

/**
 * The `platform-admin` area — the operator console for kitchen tenants (PA1) and the B2B
 * onboarding queue — in the kitchen admin's look (Platform admin canvas, 2026-11-23).
 *
 * Its registry baseline is the only one that carries an explicit permission:
 * `organisation.manage_platform`, the code `PermissionRegistry::platformPermissions()` issues and
 * the code the `/platform/organisations/kitchens` routes are gated on. `AreaShell`'s
 * `<Gate area="platform-admin">` refuses anyone without it — including a signed-in organisation
 * owner, who may run a kitchen but does not run the platform.
 *
 * The chrome is the desk shell the kitchen and corporate areas share: the green rail with one
 * Platform module and its 240px page panel, and the pill trail, ع, the theme and Workspaces in the
 * top bar. The rail carries no brand mark at its top (the user's call, 2026-11-23). Toasts take the
 * desk look, and an operator works at a desk with a mouse, so pages render on the compact ladder.
 */
export default function PlatformAdminLayout() {
    return (
        <TrailLeafProvider>
            <AreaLookScope look="desk">
                <PlatformAreaShell />
            </AreaLookScope>
        </TrailLeafProvider>
    );
}

function PlatformAreaShell() {
    const navigation = usePlatformAdminNavigation();
    const crumbs = usePlatformTrail(navigation);

    return (
        <AreaShell
            area="platform-admin"
            testID="platform-admin-shell"
            navigation={navigation}
            sidebarWidth={DESK_SIDEBAR_WIDTH}
            topbarTitle={<DeskTrail testID="platform-admin-breadcrumbs" crumbs={crumbs} />}
        >
            <DensityProvider value="compact">
                {/* Cards, chips and pickers draw as the kitchen's do (`KitchenOpsShell`). */}
                <SectionLook look="board">
                    <View testID="platform-admin-content" className="min-h-0 min-w-0 flex-1">
                        <Slot />
                    </View>
                </SectionLook>
            </DensityProvider>
        </AreaShell>
    );
}
