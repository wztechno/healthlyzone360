import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Kitchen area content chrome — padding only.
 *
 * Destinations live on the hub as a card grid under the Kitchen title (not a second sidebar and
 * not a cramped icon strip on every route). List/editor screens use their own back controls.
 */

export interface KitchenOpsShellProps {
    readonly children: ReactNode;
}

export function KitchenOpsShell({ children }: KitchenOpsShellProps) {
    return (
        <View testID="kitchen-ops-shell" className="min-h-0 flex-1 p-4 md:p-5">
            <View testID="kitchen-ops-content" className="min-h-0 min-w-0 flex-1">
                {children}
            </View>
        </View>
    );
}
