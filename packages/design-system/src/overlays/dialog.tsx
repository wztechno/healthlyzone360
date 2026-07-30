import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export interface DialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly description?: string | undefined;
    readonly children?: ReactNode | undefined;
    /** Buttons. Rendered in a row that wraps, with the confirming action last. */
    readonly actions?: ReactNode | undefined;
    /** Blocks dismissal by backdrop tap. Escape still works — never trap a keyboard user. */
    readonly dismissOnBackdrop?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Dialog.
 *
 * Built on React Native's `Modal` on both platforms, which is what avoids a `.web.tsx` split:
 * react-native-web's `Modal` already renders into a portal, traps focus inside the surface and
 * calls `onRequestClose` when Escape is pressed. Reimplementing any of that by hand is how focus
 * escapes to the page behind and how axe ends up reporting a dialog with no accessible name.
 *
 * `aria-modal` plus `aria-labelledby`/`aria-describedby` are set explicitly rather than left to the
 * platform, because native has no equivalent and the two would otherwise diverge.
 */
export function Dialog({
    open,
    onClose,
    title,
    description,
    children,
    actions,
    dismissOnBackdrop = true,
    className,
    testID,
}: DialogProps) {
    const { t } = useTranslation();
    const generated = useId();
    const base = testID ?? `dialog-${generated.replace(/:/g, '')}`;
    const titleId = `${base}-title`;
    const descriptionId = description === undefined ? undefined : `${base}-description`;

    return (
        <Modal
            visible={open}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View className="flex-1 items-center justify-center p-4">
                <Pressable
                    testID={`${base}-backdrop`}
                    // The backdrop is scenery: it must never appear in the tab order or be
                    // announced, or a screen reader user meets an unlabelled button before the
                    // dialog's own content.
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={dismissOnBackdrop ? onClose : undefined}
                    className="absolute inset-0 bg-overlay"
                />

                <View
                    testID={base}
                    role="dialog"
                    aria-modal
                    aria-labelledby={titleId}
                    aria-describedby={descriptionId}
                    className={cx(
                        'w-full max-w-[480px] flex-col gap-4 rounded-xl bg-surface-raised p-6 shadow-elevation-4',
                        className,
                    )}
                >
                    <View className="flex-row items-start gap-3">
                        <RNText
                            nativeID={titleId}
                            testID={`${base}-title`}
                            accessibilityRole="header"
                            aria-level={2}
                            className="flex-1 text-xl font-semibold text-content-primary text-start"
                        >
                            {title}
                        </RNText>
                        <IconButton
                            testID={`${base}-close`}
                            size="sm"
                            label={t('common:action.close')}
                            icon={<Icon name="close" />}
                            onPress={onClose}
                        />
                    </View>

                    {description === undefined ? null : (
                        <RNText
                            nativeID={descriptionId}
                            testID={`${base}-description`}
                            className="text-sm text-content-secondary text-start"
                        >
                            {description}
                        </RNText>
                    )}

                    {children}

                    {actions === undefined ? null : (
                        <View
                            testID={`${base}-actions`}
                            className="flex-row flex-wrap items-center justify-end gap-2"
                        >
                            {actions}
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
}
