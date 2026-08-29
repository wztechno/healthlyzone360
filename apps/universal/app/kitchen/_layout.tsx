import { Slot } from 'expo-router';

import {
    KITCHEN_SIDEBAR_WIDTH,
    KitchenBrandBlock,
    KitchenCanopyGradient,
    useKitchenNavigation,
} from '../../src/features/kitchen-admin/kitchen-chrome.tsx';
import { KitchenOpsShell } from '../../src/features/kitchen-admin/kitchen-ops-shell.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';

/**
 * The `kitchen` area. `AreaShell` applies `<Gate area="kitchen">` and this area's chrome — here
 * the family rail from `kitchen-chrome.tsx`: every permitted destination in its registry group,
 * queue badges on Review and Exceptions, the workspace trio under its own heading, and Sign out
 * pinned to the bottom of the canopy.
 */
export default function KitchenLayout() {
    const navigation = useKitchenNavigation();

    return (
        <AreaShell
            area="kitchen"
            testID="kitchen-shell"
            navigation={navigation}
            sidebarWidth={KITCHEN_SIDEBAR_WIDTH}
            sidebarBackground={<KitchenCanopyGradient />}
            sidebarStart={<KitchenBrandBlock />}
            signOutInSidebar
        >
            <KitchenOpsShell>
                <Slot />
            </KitchenOpsShell>
        </AreaShell>
    );
}
