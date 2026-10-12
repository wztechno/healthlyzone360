import { Inline, useBreakpoint } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { useKitchenPageName } from '../kitchen-ops-shell.tsx';

/**
 * Parts one and two of a Catalogue list page (§4.1): the title with its single primary action.
 *
 * ```
 *                              [ Import ] [ + New ]       <- one 32px primary
 * ```
 *
 * The title is the mood board's H2 (30px Space Grotesk, 24 on a phone). A caller that states no
 * title gets the kitchen family's name from the trail (`useKitchenPageName`), so a list opens on
 * "Ingredients" without restating it — the crumb, the rail and the title all read the same entity
 * registry, so they cannot disagree. State a title for a screen the trail cannot name on its own.
 *
 * One primary at most in `primaryAction`, and it is the page's only `md` (32px) control; everything
 * else on the page is `sm`. The `size` is the caller's to pass, because this component sets no
 * geometry on its children — but §3 is unambiguous that the primary is the one exception to the
 * Catalogue's `sm` default.
 */
export interface CataloguePageHeaderProps {
    /** Omit on a list the shell's trail already names; the family's name is drawn instead. */
    readonly title?: string | undefined;
    /** The page's one primary. A 32px `Button`; anything more belongs in the toolbar. */
    readonly primaryAction?: ReactNode | undefined;
    /** Beside the title — a status the page as a whole is in. Rare on a list. */
    readonly titleAside?: ReactNode | undefined;
    /**
     * Overrides the derived `{testID}-title`. For a screen whose title id is already a contract
     * with a suite and should not move because the header around it did.
     */
    readonly titleTestID?: string | undefined;
    readonly testID: string;
}

export function CataloguePageHeader({
    title,
    primaryAction,
    titleAside,
    titleTestID,
    testID,
}: CataloguePageHeaderProps) {
    const pageName = useKitchenPageName();
    const shown = title ?? pageName;
    const { atLeast } = useBreakpoint();
    const wide = atLeast('md');

    return (
        <View testID={testID} className="gap-hair">
            <View className="flex-row flex-wrap items-center justify-between gap-snug">
                {/*
                 * `flex-1` on the title column is the row's own container, which is the one case
                 * the no-stretch fence exempts (eslint.config.mjs, STRETCH_MESSAGE): it is what
                 * pushes the primary to the inline end and lets a long designation truncate rather
                 * than shove the button off the page. It stays when there is no title, because the
                 * actions still need something to push against.
                 */}
                {/* eslint-disable-next-line no-restricted-syntax -- the title column *is* the row; see above. */}
                <Inline space="sm" align="center" wrap className="min-w-[200px] flex-1">
                    {shown === undefined ? null : (
                        /*
                         * The mood board's H2 — 30px Space Grotesk, 24 on a phone. React Native's
                         * `Text`, not the design system's, because it states its own size: a
                         * caller's size on `Text` loses to the variant's in stylesheet order.
                         */
                        <RNText
                            testID={titleTestID ?? `${testID}-title`}
                            accessibilityRole="header"
                            aria-level={1}
                            className={
                                wide
                                    ? 'font-display text-role-title text-content-primary text-start'
                                    : 'font-display text-2xl font-bold text-content-primary text-start'
                            }
                        >
                            {shown}
                        </RNText>
                    )}
                    {titleAside}
                </Inline>
                {primaryAction}
            </View>
        </View>
    );
}
