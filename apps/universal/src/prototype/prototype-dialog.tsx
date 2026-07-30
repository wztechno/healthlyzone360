import { Badge, Dialog, Stack, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { appConfig } from '../config.ts';

/**
 * The dialog form of the prototype disclosure.
 *
 * `usePrototypeAction()` answers a press with a toast, which is right for a control whose whole
 * story is one sentence. It is wrong for a control that is *navigation-shaped* — "request a
 * quotation", "book a consultation" — where the person is asking to start a conversation and
 * deserves to be told what actually happens next and offered a real route there.
 *
 * So this dialog always carries real actions. It is never an "OK" that dismisses itself: that would
 * be a dead control wearing a bigger hat.
 */
export interface PrototypeDialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly description: string;
    /** Proposed endpoint. Shown in development builds only, as a reviewer diagnostic. */
    readonly contract: string;
    /** Real destinations — sign in, register, browse. At least one, and never a bare dismiss. */
    readonly actions: ReactNode;
    readonly children?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

export function PrototypeDialog({
    open,
    onClose,
    title,
    description,
    contract,
    actions,
    children,
    testID = 'prototype-dialog',
}: PrototypeDialogProps) {
    const { t } = useTranslation();

    return (
        <Dialog
            testID={testID}
            open={open}
            onClose={onClose}
            title={title}
            description={description}
            actions={actions}
        >
            <Stack space="sm">
                <Badge
                    tone="info"
                    icon="prototype"
                    label={t('marketplace:prototype.badge')}
                    testID={`${testID}-badge`}
                />
                {children}
                {appConfig.isDevelopment ? (
                    <Text variant="caption" tone="secondary" testID={`${testID}-contract`}>
                        {contract}
                    </Text>
                ) : null}
            </Stack>
        </Dialog>
    );
}
