import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const DRAWER_PLACEMENTS = ['start', 'end', 'bottom'] as const;
export type DrawerPlacement = (typeof DRAWER_PLACEMENTS)[number];

export interface DrawerProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly children: ReactNode;
    readonly footer?: ReactNode | undefined;
    /**
     * Which edge the panel is attached to. `start` (the default, and the Phase 1 behaviour) is the
     * leading edge — left in English, right in Arabic. `bottom` is the sheet form.
     */
    readonly placement?: DrawerPlacement | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Drawer — the surface a workspace shell collapses to below `lg`, and the sheet an action list
 * rises from on a phone.
 *
 * **Placement is resolved by source order, not by a positional utility.** For `start` the panel is
 * the first child of a `flex-row` and the backdrop fills the rest; for `end` the two swap places.
 * Flex rows follow the writing direction on both platforms, so `start` lands on the left in English
 * and on the right in Arabic with no mirrored style at all. `start-0` would be logical and would
 * still be wrong: React Native's layout engine and react-native-web disagree about inset logical
 * properties, whereas flex source order behaves identically on both.
 *
 * `bottom` is the same trick rotated: a `flex-col` with the backdrop above the panel.
 */
export function Drawer({
    open,
    onClose,
    title,
    children,
    footer,
    placement = 'start',
    className,
    testID,
}: DrawerProps) {
    const { t } = useTranslation();
    const generated = useId();
    const base = testID ?? `drawer-${generated.replace(/:/g, '')}`;
    const titleId = `${base}-title`;
    const bottom = placement === 'bottom';

    const panel = (
        <View
            testID={base}
            role="dialog"
            aria-modal
            aria-labelledby={titleId}
            className={cx(
                bottom
                    ? 'max-h-[85%] w-full flex-col gap-2 rounded-t-2xl bg-surface-raised shadow-elevation-4'
                    : 'h-full w-[300px] max-w-[85%] flex-col gap-2 bg-surface-raised shadow-elevation-4',
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
    );

    const backdrop = (
        <Pressable
            testID={`${base}-backdrop`}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            aria-hidden
            focusable={false}
            onPress={onClose}
            className={bottom ? 'w-full flex-1 bg-overlay' : 'h-full flex-1 bg-overlay'}
        />
    );

    return (
        <Modal
            visible={open}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            accessibilityViewIsModal
        >
            <View className={bottom ? 'flex-1 flex-col' : 'flex-1 flex-row'}>
                {placement === 'end' || bottom ? (
                    <>
                        {backdrop}
                        {panel}
                    </>
                ) : (
                    <>
                        {panel}
                        {backdrop}
                    </>
                )}
            </View>
        </Modal>
    );
}
