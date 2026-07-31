import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { FadeIn } from '../motion/fade-in.tsx';

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
 *
 * ## The dialog never grows past the screen
 *
 * A confirmation with a form in it — a delivery address, a repeat picker — is easily taller than a
 * short viewport, and a centred surface that overflows loses **both** ends: the title above and,
 * far worse, the confirming button below. Nothing scrolls it back, because the surface is inside a
 * fixed modal rather than in the page. So the surface is bounded by the screen and its body — the
 * description and the caller's children — is the part that scrolls; the title row and the actions
 * are always on screen, which is the property a confirmation depends on.
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
            // animationType 'none' for the same reason as Drawer: react-native-web's
            // animated modals never fire animationend here, so the dialog role and focus
            // trap would stay inactive. FadeIn below supplies the entrance.
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

                <FadeIn className="w-full max-w-[480px]">
                    <View
                        testID={base}
                        role="dialog"
                        aria-modal
                        aria-labelledby={titleId}
                        aria-describedby={descriptionId}
                        // `max-h` in viewport units, not per cent: the animating wrapper's box is
                        // whatever this panel asks for, so a percentage would resolve against the
                        // panel itself and bound nothing at all.
                        className={cx(
                            'w-full max-h-[85vh] min-h-0 shrink flex-col gap-4 rounded-xl bg-surface-raised p-6 shadow-elevation-4',
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

                        <ScrollView
                            testID={`${base}-body`}
                            className="min-h-0 shrink"
                            contentContainerClassName="flex-col gap-4"
                        >
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
                        </ScrollView>

                        {actions === undefined ? null : (
                            <View
                                testID={`${base}-actions`}
                                className="flex-row flex-wrap items-center justify-end gap-2"
                            >
                                {actions}
                            </View>
                        )}
                    </View>
                </FadeIn>
            </View>
        </Modal>
    );
}
