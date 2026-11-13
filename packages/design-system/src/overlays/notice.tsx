import { useId } from 'react';
import type { ReactNode } from 'react';
import { Modal, Pressable, Text as RNText, View } from 'react-native';

import { Button } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { FadeIn } from '../motion/fade-in.tsx';

export type NoticeTone = 'warning' | 'danger' | 'info' | 'success';

export interface NoticeAction {
    readonly label: string;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

export interface NoticeProps {
    readonly open: boolean;
    /** Escape and the backdrop; the quiet button when it is the same thing. */
    readonly onClose: () => void;
    readonly tone: NoticeTone;
    /** Six words at most: "2 things before saving". */
    readonly title: string;
    /** One sentence. A short list goes in `children` instead. */
    readonly body?: string | undefined;
    readonly children?: ReactNode | undefined;
    /** The verb that moves on — "Show me", "Try again". */
    readonly primary: NoticeAction;
    /** The way out that does nothing — "Not now", "Keep editing". */
    readonly secondary?: NoticeAction | undefined;
    readonly testID?: string | undefined;
}

const TONE_ICON: Readonly<Record<NoticeTone, IconName>> = {
    warning: 'alert',
    danger: 'circleX',
    info: 'infoCircle',
    success: 'circleCheck',
};

const TONE_TILE: Readonly<Record<NoticeTone, string>> = {
    warning: 'bg-warning-subtle',
    danger: 'bg-danger-subtle',
    info: 'bg-info-subtle',
    success: 'bg-success-subtle',
};

const TONE_MARK: Readonly<Record<NoticeTone, string>> = {
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
    success: 'text-success',
};

/**
 * Notice — a small card in the middle of the page, for the moment a press could not go through or
 * a choice is needed first.
 *
 * ```
 *        ┌──────────────────────────────────┐
 *        │ (△)  2 things before saving      │
 *        │      • Name (English)            │
 *        │      • Category                  │
 *        │              [ Not now ] [Show me]│
 *        └──────────────────────────────────┘
 * ```
 *
 * Narrower and quieter than `Dialog`: no close cross and no form, a tone tile instead, and the
 * buttons named by what they do. One at a time; it never closes itself. The modal plumbing is
 * `Dialog`'s — React Native's `Modal`, which traps focus and turns Escape into `onClose` on both
 * platforms — for the reasons stated there.
 */
export function Notice({
    open,
    onClose,
    tone,
    title,
    body,
    children,
    primary,
    secondary,
    testID,
}: NoticeProps) {
    const generated = useId();
    const base = testID ?? `notice-${generated.replace(/:/g, '')}`;
    const titleId = `${base}-title`;
    const bodyId = body === undefined ? undefined : `${base}-body`;

    return (
        <Modal
            visible={open}
            transparent
            animationType="none"
            onRequestClose={onClose}
            {...({ 'aria-labelledby': titleId } as object)}
        >
            <View className="flex-1 items-center justify-center p-4">
                <Pressable
                    testID={`${base}-backdrop`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={onClose}
                    className="absolute inset-0 bg-overlay"
                />
                {/* The width bound sits on a plain `View`: `FadeIn` drops `className` on the web. */}
                <View className="w-full max-w-[400px]">
                    <FadeIn>
                        <View
                            testID={base}
                            role="alertdialog"
                            aria-modal
                            aria-labelledby={titleId}
                            aria-describedby={bodyId}
                            className="w-full flex-col gap-4 rounded-xl bg-surface-raised p-6 shadow-elevation-4"
                        >
                            <View className="flex-row items-center gap-3">
                                <View
                                    aria-hidden
                                    className={cx(
                                        'h-10 w-10 shrink-0 items-center justify-center rounded-full',
                                        TONE_TILE[tone],
                                    )}
                                >
                                    <Icon name={TONE_ICON[tone]} className={TONE_MARK[tone]} />
                                </View>
                                <RNText
                                    nativeID={titleId}
                                    testID={`${base}-title`}
                                    accessibilityRole="header"
                                    aria-level={2}
                                    className="min-w-0 flex-1 font-display text-lg font-semibold text-content-primary text-start"
                                >
                                    {title}
                                </RNText>
                            </View>

                            {body === undefined ? null : (
                                <RNText
                                    nativeID={bodyId}
                                    testID={`${base}-body`}
                                    className="text-base text-content-secondary text-start"
                                >
                                    {body}
                                </RNText>
                            )}
                            {children}

                            <View className="flex-row flex-wrap items-center justify-end gap-2">
                                {secondary === undefined ? null : (
                                    <Button
                                        testID={secondary.testID ?? `${base}-secondary`}
                                        variant="secondary"
                                        size="lg"
                                        label={secondary.label}
                                        onPress={secondary.onPress}
                                    />
                                )}
                                <Button
                                    testID={primary.testID ?? `${base}-primary`}
                                    variant={tone === 'danger' ? 'danger' : 'primary'}
                                    size="lg"
                                    label={primary.label}
                                    onPress={primary.onPress}
                                />
                            </View>
                        </View>
                    </FadeIn>
                </View>
            </View>
        </Modal>
    );
}
