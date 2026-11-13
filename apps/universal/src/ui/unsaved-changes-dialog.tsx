import { Button, Dialog } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import type { UnsavedGuard } from '../navigation/use-unsaved-guard.ts';
import { ShopDialog, ShopDialogButton } from './shop-dialog.tsx';

/**
 * "Leave without saving?" for a customer form, over `useUnsavedGuard`. The kitchen editors draw
 * their own in `editor-frame.tsx` with the admin's wording; this one speaks to a customer.
 *
 * `look="shop"` is the shop's pop-up (Shop · Account, pin 12): an amber head, Keep editing beside a
 * red Discard my changes. The business and platform forms keep the design system's dialog.
 */
export function UnsavedChangesDialog({
    guard,
    testID,
    look = 'default',
}: {
    readonly guard: UnsavedGuard;
    readonly testID: string;
    readonly look?: 'shop' | 'default' | undefined;
}) {
    const { t } = useTranslation();
    if (look === 'shop') {
        return (
            <ShopDialog
                testID={testID}
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                tone="warning"
                icon="pen"
                title={t('common:unsaved.title')}
                description={t('common:unsaved.body')}
                actions={
                    <>
                        <ShopDialogButton
                            testID={`${testID}-keep`}
                            label={t('common:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <ShopDialogButton
                            testID={`${testID}-discard`}
                            kind="danger"
                            label={t('common:unsaved.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />
        );
    }
    return (
        <Dialog
            testID={testID}
            open={guard.isPrompting}
            onClose={guard.cancelDiscard}
            title={t('common:unsaved.title')}
            description={t('common:unsaved.body')}
            actions={
                <>
                    <Button
                        testID={`${testID}-keep`}
                        variant="quiet"
                        label={t('common:unsaved.keepEditing')}
                        onPress={guard.cancelDiscard}
                    />
                    <Button
                        testID={`${testID}-discard`}
                        variant="danger"
                        label={t('common:unsaved.discard')}
                        onPress={guard.confirmDiscard}
                    />
                </>
            }
        />
    );
}
