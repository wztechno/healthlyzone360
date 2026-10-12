import { Inline, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Parts one and two of a Catalogue list page (§4.1): the title with its single primary action.
 *
 * ```
 *                              [ Import ] [ + New ]       <- one 32px primary
 * ```
 *
 * Distinct from `KitchenPageHeader`, which opens every *other* kitchen route with a 24px heading,
 * a subtitle and a band variant. This one is the Catalogue's opening and is deliberately smaller:
 * the title is the `title` step (16/22), there is no subtitle, and the line under it is the stat
 * row rather than prose. A catalogue is a working surface someone returns to forty times a day, and
 * a third of the fold spent re-explaining what the page is, is a third of the fold not spent on
 * rows.
 *
 * ## The title is optional, and the Catalogue's own lists omit it
 *
 * `KitchenOpsShell` already draws a trail for every kitchen route, ending in the page's name, and
 * the nav rail already has it highlighted: a 16px heading between them is the third time the word
 * "Ingredients" appears in 40px of screen. The shell's trail is derived from the same entity
 * registry the hub cards and the `<Gate>`s read, so a crumb cannot name a page differently from the
 * card that led to it — which is why this header draws no trail of its own.
 *
 * With the title omitted the header is the actions row, which is what the design draws above the
 * stat cards. State a title for a screen the shell's trail cannot name on its own.
 *
 * One primary at most in `primaryAction`, and it is the page's only `md` (32px) control; everything
 * else on the page is `sm`. The `size` is the caller's to pass, because this component sets no
 * geometry on its children — but §3 is unambiguous that the primary is the one exception to the
 * Catalogue's `sm` default.
 */
export interface CataloguePageHeaderProps {
    /** Omit on a list the shell's trail already names — see above. */
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
    return (
        <View testID={testID} className="gap-hair">
            <View className="flex-row items-center justify-between gap-tight">
                {/*
                 * `flex-1` on the title column is the row's own container, which is the one case
                 * the no-stretch fence exempts (eslint.config.mjs, STRETCH_MESSAGE): it is what
                 * pushes the primary to the inline end and lets a long designation truncate rather
                 * than shove the button off the page. It stays when there is no title, because the
                 * actions still need something to push against.
                 */}
                {/* eslint-disable-next-line no-restricted-syntax -- the title column *is* the row; see above. */}
                <Inline space="xs" align="center" wrap className="min-w-0 flex-1">
                    {title === undefined ? null : (
                        <Text variant="title" testID={titleTestID ?? `${testID}-title`}>
                            {title}
                        </Text>
                    )}
                    {titleAside}
                </Inline>
                {primaryAction}
            </View>
        </View>
    );
}
