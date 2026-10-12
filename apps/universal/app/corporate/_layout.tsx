import { DensityProvider } from '@healthy360/design-system';
import { Slot } from 'expo-router';
import { View } from 'react-native';

import {
    CorporateBrandBlock,
    useCorporateNavigation,
    useCorporateTrail,
} from '../../src/features/business/corporate-chrome.tsx';
import { AreaRailTop, DESK_SIDEBAR_WIDTH } from '../../src/shell/area-brand-block.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';
import { AreaTrail, TrailLeafProvider } from '../../src/shell/area-trail.tsx';

/**
 * The `corporate` area. `AreaShell` applies `<Gate area="corporate">` and this area's chrome — the
 * kitchen's desk shell with the corporate destinations: Overview, one catalogue per programme and
 * the quotations on the rail, the breadcrumb trail in the top bar, and Sign out at the foot of the
 * sidebar.
 *
 * A corporate buyer works at a desk with a mouse, as a kitchen does, so every page renders on the
 * compact ladder (`DensityProvider value="compact"`): 28/32px controls rather than the customer
 * surfaces' 44px touch floor.
 */
export default function CorporateLayout() {
    return (
        <TrailLeafProvider>
            <CorporateAreaShell />
        </TrailLeafProvider>
    );
}

function CorporateAreaShell() {
    const navigation = useCorporateNavigation();
    const crumbs = useCorporateTrail();

    return (
        <AreaShell
            area="corporate"
            testID="corporate-shell"
            navigation={navigation}
            sidebarWidth={DESK_SIDEBAR_WIDTH}
            sidebarStart={<CorporateBrandBlock />}
            sidebarStartCollapsed={<AreaRailTop testID="corporate-rail-top" />}
            topbarTitle={
                crumbs.length === 0 ? undefined : (
                    <AreaTrail testID="corporate-breadcrumbs" crumbs={crumbs} />
                )
            }
            signOutInSidebar
        >
            <DensityProvider value="compact">
                <View testID="corporate-ops-content" className="min-h-0 min-w-0 flex-1">
                    <Slot />
                </View>
            </DensityProvider>
        </AreaShell>
    );
}
