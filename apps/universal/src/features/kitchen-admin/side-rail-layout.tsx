import { cx, usePortWidth } from '@healthy360/design-system';
import { asideWidth, formMinWidth, formWidth, spacingAliases } from '@healthy360/design-tokens';
import type { ReactNode } from 'react';
import { Platform, View } from 'react-native';

export interface SideRailLayoutProps {
    readonly main: ReactNode;
    readonly rail: ReactNode;
    /** Prefix for `-body`, `-main` and `-rail` — the ids `RecordViewPage` already uses. */
    readonly testID: string;
    /**
     * Caps the whole layout at `formWidth` + gap + `asideWidth`, so the main column stops at a
     * bounded card's width. Off: the main column takes whatever the page gives it.
     */
    readonly bounded?: boolean | undefined;
    /** Pins the rail under the top bar while the main column scrolls (web, beside only). */
    readonly sticky?: boolean | undefined;
    /** The main column's narrowest width beside the rail. Defaults to `formMinWidth`. */
    readonly mainBasis?: number | undefined;
}

/**
 * A record's main column with a side rail — the rail's width is guaranteed, not hoped for.
 *
 * Beside, the rail is exactly `asideWidth`: it never grows (`flexGrow: 0`), so every pixel of
 * slack goes to the main column. In `bounded` mode it is the *container* that is capped, never the
 * main column — capping main is what would leak the slack into the rail.
 *
 * When the two no longer fit side by side the row wraps and the rail goes full width under the
 * main column. CSS cannot tell a wrapped item from one beside its sibling, and the trigger is the
 * *content* width, not the viewport (the shell's nav is collapsible, so no breakpoint class
 * applies) — so the container is measured once with `usePortWidth`, the measurement each aside
 * screen used to make by hand. Before the first measurement the rail renders beside: desktop first.
 */
export function SideRailLayout({
    main,
    rail,
    testID,
    bounded = false,
    sticky = false,
    mainBasis = formMinWidth,
}: SideRailLayoutProps) {
    const gap = spacingAliases.base;
    const port = usePortWidth({ bucket: (width) => width < mainBasis + gap + asideWidth });
    const stacked = port.width > 0 && port.width < mainBasis + gap + asideWidth;

    return (
        <View
            testID={`${testID}-body`}
            // Both measurement paths, each inert on the other's platform — as `CatalogueList`.
            ref={Platform.OS === 'web' ? port.ref : undefined}
            onLayout={Platform.OS === 'web' ? undefined : port.onLayout}
            className="z-auto flex-row flex-wrap items-start gap-base"
            style={bounded ? { maxWidth: formWidth + gap + asideWidth } : undefined}
        >
            <View
                testID={`${testID}-main`}
                className="z-auto min-w-0 flex-col gap-base"
                style={{ flexBasis: mainBasis, flexGrow: 1, flexShrink: 1 }}
            >
                {main}
            </View>
            <View
                testID={`${testID}-rail`}
                className={cx(
                    'z-auto min-w-0 flex-col gap-base',
                    sticky && !stacked ? 'web:sticky web:top-0 self-start' : null,
                )}
                style={{ flexBasis: stacked ? '100%' : asideWidth, flexGrow: 0, flexShrink: 0 }}
            >
                {rail}
            </View>
        </View>
    );
}
