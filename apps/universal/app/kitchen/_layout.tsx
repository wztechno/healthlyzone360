import { Slot } from 'expo-router';

import {
    KITCHEN_SIDEBAR_WIDTH,
    KitchenBrandBlock,
    KitchenRailTop,
    useKitchenNavigation,
} from '../../src/features/kitchen-admin/kitchen-chrome.tsx';
import {
    KitchenOpsShell,
    KitchenTrail,
    KitchenTrailProvider,
    useKitchenTrail,
} from '../../src/features/kitchen-admin/kitchen-ops-shell.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The `kitchen` area. `AreaShell` applies `<Gate area="kitchen">` and this area's chrome — here
 * the family rail from `kitchen-chrome.tsx`: every permitted destination in its registry group,
 * queue badges on Review and Exceptions, the workspace trio under its own heading, and Sign out
 * pinned to the bottom of the sidebar.
 *
 * The breadcrumb trail is drawn in the top bar in place of the area title. Its provider wraps the
 * shell rather than sitting inside it, because the bar and the screen that names the trail's leaf
 * are siblings under `AreaShell`.
 */
export default function KitchenLayout() {
    return (
        <KitchenTrailProvider>
            <KitchenAreaShell />
        </KitchenTrailProvider>
    );
}

function KitchenAreaShell() {
    const navigation = useKitchenNavigation();
    const crumbs = useKitchenTrail();

    return (
        <AreaShell
            area="kitchen"
            testID="kitchen-shell"
            navigation={navigation}
            sidebarWidth={KITCHEN_SIDEBAR_WIDTH}
            sidebarStart={<KitchenBrandBlock />}
            sidebarStartCollapsed={<KitchenRailTop />}
            topbarTitle={crumbs.length === 0 ? undefined : <KitchenTrail crumbs={crumbs} />}
            signOutInSidebar
        >
            <KitchenOpsShell>
                <Slot />
            </KitchenOpsShell>
        </AreaShell>
    );
}
