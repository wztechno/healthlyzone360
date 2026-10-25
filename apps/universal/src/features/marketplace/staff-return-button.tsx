import { Button, Icon } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { pathnameOf } from '../../navigation/return-to.ts';
import { useReturnTo } from '../../navigation/use-return-to.ts';
import { useShopViewOnly } from './shop-view-only.tsx';

/**
 * The way back to the kitchen workspace for staff who opened a shop page from it — "See it on the
 * menu" on a published meal or plan.
 *
 * The admin sends `?returnTo=` with that link, and a staff member looking at the shop sees one
 * button above the trail that takes them straight back to the record they came from. Nothing at
 * all for a shopper, or for a page nobody sent them to from the workspace: the shop's own trail is
 * theirs, and a "back to the kitchen" on it would be a door to a room they cannot enter.
 *
 * Named by where it goes — the recipe, the plan — rather than by its address, which means nothing
 * to the person reading the button.
 */
export function StaffReturnButton({
    returnTo,
    testID,
}: {
    readonly returnTo: string | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const viewOnly = useShopViewOnly();
    const back = useReturnTo(returnTo, '/workspace');

    if (!viewOnly || back.returnTo === null) return null;
    const path = pathnameOf(back.returnTo);
    if (!path.startsWith('/kitchen/')) return null;

    const label = path.startsWith('/kitchen/recipes')
        ? t('marketplace:staffReturn.recipe')
        : path.startsWith('/kitchen/plans')
          ? t('marketplace:staffReturn.plan')
          : t('marketplace:staffReturn.kitchen');

    return (
        <Button
            testID={testID}
            variant="secondary"
            size="sm"
            label={label}
            iconStart={<Icon name="chevronStart" size="sm" />}
            onPress={back.leave}
            className="self-start"
        />
    );
}
