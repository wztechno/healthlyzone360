import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { SlideIn } from '../motion/slide-in.tsx';

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
 *
 * ## The size bound is in viewport units, not per cent
 *
 * The panel is wrapped by `SlideIn`, whose box is whatever the panel asks for. A percentage bound
 * therefore resolves against the panel's own wrapper: `max-w-[95%]` meant 95 % *of the panel*,
 * which inset it from the edge it is attached to by exactly 5 % and left a strip of backdrop
 * showing down the trailing edge. `vw`/`vh` resolve against the screen on both platforms, which is
 * what every caller means, and they do not depend on an ancestor having a definite size.
 *
 * ## The body scrolls
 *
 * A drawer holds a form, a filter set or an action list, and any of them can be taller than the
 * screen. Without a scroller the overflow is simply unreachable — the last actions of a sheet end
 * up underneath its own footer, and no amount of page scrolling brings them back, because the panel
 * is inside a fixed modal. So the content is a `ScrollView`, the header and footer stay put, and
 * the panel shrinks to its own bound instead of growing past it.
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
                'min-h-0 shrink flex-col gap-2 bg-surface-raised shadow-elevation-4',
                bottom ? 'max-h-[85vh] w-full rounded-t-2xl' : 'h-full w-[300px] max-w-[85vw]',
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

            <ScrollView
                testID={`${base}-content`}
                className="min-h-0 shrink"
                contentContainerClassName="p-2"
            >
                {children}
            </ScrollView>

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
            // animationType must be 'none': react-native-web only activates the modal's
            // dialog role and focus trap from the CSS animationend event, which does not
            // fire reliably for its built-in animations - leaving an axe-critical roleless
            // aria-modal wrapper and NO focus containment. The panel animates itself below
            // with SlideIn, which is also direction-aware where RNW's slide is not.
            animationType="none"
            onRequestClose={onClose}
            // Names react-native-web's own dialog wrapper (it spreads unrecognised props
            // onto that element): an active modal without an accessible name is an axe
            // serious violation (aria-dialog-name). RN's Modal typing does not declare
            // aria props, hence the cast.
            {...({ 'aria-labelledby': titleId } as object)}
            // No accessibilityViewIsModal: react-native-web maps it to aria-modal on this roleless
            // wrapper (an axe-critical aria-allowed-attr violation). The dialog semantics live on
            // the panel below; native Modal is already modal to screen readers.
        >
            <View className={bottom ? 'flex-1 flex-col' : 'flex-1 flex-row'}>
                {placement === 'end' || bottom ? (
                    <>
                        {backdrop}
                        <SlideIn edge={bottom ? 'bottom' : 'end'}>{panel}</SlideIn>
                    </>
                ) : (
                    <>
                        <SlideIn edge="start">{panel}</SlideIn>
                        {backdrop}
                    </>
                )}
            </View>
        </Modal>
    );
}
