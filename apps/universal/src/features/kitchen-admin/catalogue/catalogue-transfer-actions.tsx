import { Button } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

/**
 * Import and Export, the pair that opens every Catalogue list beside its primary.
 *
 * One component rather than the same two buttons written into five screens, for the reason the
 * column header and the toolbar are also one each: the next change to how a catalogue moves records
 * in and out is then a change to this file, not a hunt through `screens/`.
 *
 * ## Both are disabled, and that is the honest state
 *
 * Neither transfer exists yet — there is no import endpoint on the contract and no export one, and
 * the ingredient list has shipped a disabled Import since the Catalogue was rebuilt. Drawing them
 * disabled rather than hiding them is the same argument the row's Archive now makes: a reader who
 * cannot see the control cannot tell whether the page lacks the feature or their role lacks the
 * permission, and "not yet" is a thing an interface is allowed to say. Each carries an
 * `accessibilityLabel` that says so in words, because a disabled control announces no reason on its
 * own.
 *
 * Wire them by giving each an `onPress` and dropping `disabled`; nothing else here has to move.
 *
 * ## Not on Allergen classes
 *
 * That screen reads a platform vocabulary a kitchen does not own — there is nothing there to
 * import and nothing that would mean anything exported.
 */

export interface CatalogueTransferActionsProps {
    /**
     * The screen's toolbar id — `kitchen-ingredients-toolbar`. The buttons take `-import` and
     * `-export`, which keeps the id the ingredient list's Import already shipped with.
     */
    readonly testID: string;
}

export function CatalogueTransferActions({ testID }: CatalogueTransferActionsProps) {
    const { t } = useTranslation();

    return (
        <>
            <Button
                testID={`${testID}-import`}
                variant="secondary"
                disabled
                label={t('kitchen:list.import')}
                accessibilityLabel={t('kitchen:list.importUnavailable')}
            />
            <Button
                testID={`${testID}-export`}
                variant="secondary"
                disabled
                label={t('kitchen:list.export')}
                accessibilityLabel={t('kitchen:list.exportUnavailable')}
            />
        </>
    );
}
