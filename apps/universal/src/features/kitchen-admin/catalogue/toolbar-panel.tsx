import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * A page's control row on the same raised panel `CatalogueToolbar` draws — border, fill and the card
 * cast — for the pages whose controls are not a search: a date window, a week stepper, a day.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ [ 1 Sep ▾ ] to [ 7 Sep ▾ ]   caption                       [ ▦ 8 of 8 ] │
 * └──────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * `children` sit at the inline start; `end` — the column picker, as a rule — is pushed to the inline
 * end. `z-10` because a date picker's popover hangs out of the row and has to paint over the list
 * beneath it.
 */
export function ToolbarPanel({
    children,
    end,
    testID,
}: {
    readonly children: ReactNode;
    readonly end?: ReactNode | undefined;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-tight rounded-panel border border-brand-100 bg-surface-raised p-tight shadow-elevation-card"
        >
            {children}
            {end === undefined ? null : (
                // The row's own filler, which is what pushes `end` over: the exempt case.
                // eslint-disable-next-line no-restricted-syntax -- the row's own spacer.
                <View className="flex-1" />
            )}
            {end}
        </View>
    );
}
