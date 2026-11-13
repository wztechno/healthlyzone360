import { ToastLookScope } from '@healthy360/design-system';
import { Slot } from 'expo-router';

import {
    KITCHEN_SIDEBAR_WIDTH,
    useKitchenNavigation,
} from '../../src/features/kitchen-admin/kitchen-chrome.tsx';
import {
    KitchenOpsShell,
    KitchenTrail,
    KitchenTrailProvider,
    useKitchenTrail,
} from '../../src/features/kitchen-admin/kitchen-ops-shell.tsx';
import { KitchenPageSearch } from '../../src/features/kitchen-admin/kitchen-page-search.tsx';
import { SaveBarProvider } from '../../src/features/kitchen-admin/save-bar.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';
import { StaffAlertsButton } from '../../src/shell/staff-alerts-button.tsx';

/**
 * The `kitchen` area. `AreaShell` applies `<Gate area="kitchen">` and this area's chrome — here
 * the family rail from `kitchen-chrome.tsx`: every permitted destination in its registry group,
 * and queue counts on Review and Exceptions. The rail's foot carries Workspaces and the account
 * avatar (Sign out); the top bar the trail, the page search and the page's own buttons.
 *
 * The breadcrumb trail is drawn in the top bar in place of the area title. Its provider wraps the
 * shell rather than sitting inside it, because the bar and the screen that names the trail's leaf
 * are siblings under `AreaShell`.
 */
export default function KitchenLayout() {
    return (
        <KitchenTrailProvider>
            {/* The admin's own toast: the desk card, bottom centre (design-system toast.tsx). */}
            <ToastLookScope look="desk">
                {/* An editor's save bar, drawn at the foot of the page (save-bar.tsx). */}
                <SaveBarProvider>
                    <KitchenAreaShell />
                </SaveBarProvider>
            </ToastLookScope>
        </KitchenTrailProvider>
    );
}

function KitchenAreaShell() {
    const navigation = useKitchenNavigation();
    const crumbs = useKitchenTrail(navigation);

    return (
        <AreaShell
            area="kitchen"
            testID="kitchen-shell"
            navigation={navigation}
            sidebarWidth={KITCHEN_SIDEBAR_WIDTH}
            topbarTitle={crumbs.length === 0 ? undefined : <KitchenTrail crumbs={crumbs} />}
            topbarSearch={<KitchenPageSearch navigation={navigation} />}
            topbarActions={<StaffAlertsButton />}
        >
            <KitchenOpsShell>
                <Slot />
            </KitchenOpsShell>
        </AreaShell>
    );
}
