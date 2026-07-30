import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export interface DrawerProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly children: ReactNode;
    readonly footer?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Drawer — the navigation surface a workspace shell collapses to below `lg`.
 *
 * It slides in from the **leading** edge, which is the left in English and the right in Arabic.
 * That is achieved with `self-start` inside a `flex-row`, not with a positional utility: `start-0`
 * would be logical but React Native's layout engine and react-native-web disagree about inset
 * logical properties, whereas flex source order behaves identically on both.
 */
export function Drawer({ open, onClose, title, children, footer, className, testID }: DrawerProps) {
    const { t } = useTranslation();
    const generated = useId();
    const base = testID ?? `drawer-${generated.replace(/:/g, '')}`;
    const titleId = `${base}-title`;

    return (
        <Modal
            visible={open}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View className="flex-1 flex-row">
                <View
                    testID={base}
                    role="dialog"
                    aria-modal
                    aria-labelledby={titleId}
                    className={cx(
                        'h-full w-[300px] max-w-[85%] flex-col gap-2 bg-surface-raised shadow-elevation-4',
                        className,
                    )}
                >
                    <View className="flex-row items-center gap-2 border-b border-stroke-subtle p-4">
                        <RNText
                            nativeID={titleId}
                            testID={`${base}-title`}
                            accessibilityRole="header"
                            aria-level={2}
                            className="flex-1 text-base font-semibold text-content-primary text-start"
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

                    <View testID={`${base}-content`} className="flex-1 p-2">
                        {children}
                    </View>

                    {footer === undefined ? null : (
                        <View className="border-t border-stroke-subtle p-4">{footer}</View>
                    )}
                </View>

                <Pressable
                    testID={`${base}-backdrop`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={onClose}
                    className="h-full flex-1 bg-overlay"
                />
            </View>
        </Modal>
    );
}
