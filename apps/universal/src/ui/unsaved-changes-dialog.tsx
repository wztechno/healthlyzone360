import { Button, Dialog } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import type { UnsavedGuard } from '../navigation/use-unsaved-guard.ts';

/**
 * "Leave without saving?" for a customer form, over `useUnsavedGuard`. The kitchen editors draw
 * their own in `editor-frame.tsx` with the admin's wording; this one speaks to a customer.
 */
export function UnsavedChangesDialog({
    guard,
    testID,
}: {
    readonly guard: UnsavedGuard;
    readonly testID: string;
}) {
    const { t } = useTranslation();
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
