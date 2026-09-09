import { Breadcrumbs, Inline, Text } from '@healthy360/design-system';
import type { BreadcrumbItem } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { CatalogueNavToggle } from './catalogue-nav.tsx';

/**
 * Parts one and two of a Catalogue list page (§4.1): the breadcrumb line, then the title with its
 * single primary action.
 *
 * ```
 * ☰  Kitchen › Catalogue › Ingredients                    <- 11px, 16px tall
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
 * ## Both `title` and `trail` are optional, and the Catalogue's own lists omit both
 *
 * **The title**, because the trail above already ends in the page's name and the nav rail already
 * has it highlighted: a 16px heading between them is the third time the word "Ingredients" appears
 * in 40px of screen.
 *
 * **The trail**, because `KitchenOpsShell` already draws one for every kitchen route. Drawing a
 * second here put `Kitchen workspace › Ingredients` and `Catalogue › Ingredients` on consecutive
 * lines — two trails to the same page, disagreeing about how they got there. The shell's is the one
 * that survives: it is derived from the same entity registry the hub cards and the `<Gate>`s read,
 * so a crumb cannot name a page differently from the card that led to it, and it is there on the
 * twelve routes that have no Catalogue header at all.
 *
 * With both omitted the header is the actions row, which is what the design draws above the stat
 * cards. State either one for a screen the shell's trail cannot name on its own.
 *
 * **The nav toggle is first on the breadcrumb line**, per §4.2 — on the list and on both editors,
 * so the collapsed rail is always recoverable from wherever the collapse left you.
 *
 * One primary at most in `primaryAction`, and it is the page's only `md` (32px) control; everything
 * else on the page is `sm`. The `size` is the caller's to pass, because this component sets no
 * geometry on its children — but §3 is unambiguous that the primary is the one exception to the
 * Catalogue's `sm` default.
 */
export interface CataloguePageHeaderProps {
    /** Omit on a list the trail already names — see above. */
    readonly title?: string | undefined;
    /**
     * Translated trail. The last item is the current page and carries no `onPress`. Omit inside a
     * shell that already draws one — see above.
     */
    readonly trail?: readonly BreadcrumbItem[] | undefined;
    /** Accessible name for the trail. Required with `trail`. */
    readonly trailLabel?: string | undefined;
    /** Translated label for the ☰ — describes the action, not the current state. */
    readonly navToggleLabel?: string | undefined;
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
    trail,
    trailLabel,
    navToggleLabel,
    primaryAction,
    titleAside,
    titleTestID,
    testID,
}: CataloguePageHeaderProps) {
    return (
        <View testID={testID} className="gap-hair">
            {trail === undefined || trail.length === 0 ? null : (
                <View className="h-control-xs flex-row items-center gap-tight">
                    <CatalogueNavToggle
                        label={navToggleLabel ?? ''}
                        testID={`${testID}-nav-toggle`}
                    />
                    <Breadcrumbs
                        items={trail}
                        label={trailLabel ?? ''}
                        testID={`${testID}-breadcrumbs`}
                    />
                </View>
            )}

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
