import { AreaLookScope, DensityProvider, SectionLook } from '@healthy360/design-system';
import { Slot } from 'expo-router';
import { View } from 'react-native';

import {
    useCorporateNavigation,
    useCorporateTrail,
} from '../../src/features/business/corporate-chrome.tsx';
import { DeskTrail } from '../../src/features/kitchen-admin/desk-kit/desk-trail.tsx';
import { AreaRailTop, DESK_SIDEBAR_WIDTH } from '../../src/shell/area-brand-block.tsx';
import { AreaShell } from '../../src/shell/area-shell.tsx';
import { TrailLeafProvider } from '../../src/shell/area-trail.tsx';

/**
 * The `corporate` area. `AreaShell` applies `<Gate area="corporate">` and this area's chrome — the
 * kitchen's desk shell with the corporate destinations: Overview, one catalogue per programme and
 * the quotations on the rail, and the kitchen's pill trail (`DeskTrail`), ع, the theme and
 * Workspaces in the top bar. Toasts take the desk look, as they do in the kitchen.
 *
 * A corporate buyer works at a desk with a mouse, as a kitchen does, so every page renders on the
 * compact ladder (`DensityProvider value="compact"`): 28/32px controls rather than the customer
 * surfaces' 44px touch floor.
 */
export default function CorporateLayout() {
    return (
        <TrailLeafProvider>
            <AreaLookScope look="desk">
                <CorporateAreaShell />
            </AreaLookScope>
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
            sidebarStartCollapsed={<AreaRailTop testID="corporate-rail-top" />}
            topbarTitle={<DeskTrail testID="corporate-breadcrumbs" crumbs={crumbs} />}
        >
            <DensityProvider value="compact">
                {/* Cards, chips and pickers draw as the kitchen's do (`KitchenOpsShell`). */}
                <SectionLook look="board">
                    <View testID="corporate-ops-content" className="min-h-0 min-w-0 flex-1">
                        <Slot />
                    </View>
                </SectionLook>
            </DensityProvider>
        </AreaShell>
    );
}
