import { Breadcrumbs } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import type { ReturnTo } from '../navigation/use-return-to.ts';

export interface SubpageTrailProps {
    /** The screen's detour, from `useReturnTo`. */
    readonly back: ReturnTo;
    /** The page itself — the trail's last, unlinked crumb. */
    readonly current: string;
    /**
     * The parent's own name, used when the page was opened directly rather than as a detour
     * ("Addresses" rather than "Your account"). A detour always names where it returns to.
     */
    readonly parentLabel?: string | undefined;
    readonly testID: string;
}

/**
 * The way back from a page below a top-level destination: "Checkout › Add address" when checkout
 * sent the person here, "Your account › Add address" when they came from the account.
 *
 * Every page under `/customer` needs one. The area is a `<Slot/>`, which draws no header, and on iOS
 * there is no swipe-back inside it — without this the only way out of an account sub-page is the
 * browser's own Back, which a phone does not have.
 *
 * The crumb goes *up* to what it names (`dismissTo`), never simply back: a label that says "Your
 * account" must not land on whatever page happened to come before.
 */
export function SubpageTrail({ back, current, parentLabel, testID }: SubpageTrailProps) {
    const { t } = useTranslation();
    const label =
        back.returnTo === null && parentLabel !== undefined
            ? parentLabel
            : t(`common:destination.${back.destination}`);

    return (
        <Breadcrumbs
            testID={testID}
            items={[
                { key: 'up', label, onPress: back.up, testID: `${testID}-up` },
                { key: 'current', label: current },
            ]}
        />
    );
}
