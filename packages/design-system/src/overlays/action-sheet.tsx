import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { Drawer } from './drawer.tsx';

export const ACTION_TONES = ['default', 'destructive'] as const;
export type ActionTone = (typeof ACTION_TONES)[number];

export interface ActionSheetAction {
    readonly key: string;
    readonly label: string;
    readonly description?: string | undefined;
    readonly icon?: IconName | undefined;
    readonly tone?: ActionTone | undefined;
    readonly disabled?: boolean | undefined;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

export interface ActionSheetProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly title: string;
    readonly actions: readonly ActionSheetAction[];
    readonly description?: string | undefined;
    readonly cancelLabel?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Action sheet — the per-item menu on a phone.
 *
 * A thin composition over a bottom {@link Drawer} rather than a component of its own, so the focus
 * trap, the Escape handling, the backdrop semantics and the dismiss contract have exactly one
 * implementation. An action sheet that reimplemented any of that would be a second modal that
 * drifts from the first.
 *
 * A destructive action never relies on colour: it carries a warning mark as well as the danger
 * tone, so it is still distinguishable in greyscale and to a colour-blind reader.
 *
 * Choosing an action closes the sheet *before* running it — a sheet still standing over the screen
 * it just changed hides the very result the user asked for.
 */
export function ActionSheet({
    open,
    onClose,
    title,
    actions,
    description,
    cancelLabel,
    className,
    testID,
}: ActionSheetProps) {
    const { t } = useTranslation();
    const base = testID ?? 'action-sheet';

    return (
        <Drawer
            testID={base}
            open={open}
            onClose={onClose}
            title={title}
            placement="bottom"
            className={className}
            footer={
                <Pressable
                    testID={`${base}-cancel`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={cancelLabel ?? t('common:action.cancel')}
                    focusable
                    onPress={onClose}
                    className="min-h-touch items-center justify-center rounded-lg border border-stroke bg-surface-raised px-4 py-2"
                >
                    <RNText className="text-base font-medium text-content-primary">
                        {cancelLabel ?? t('common:action.cancel')}
                    </RNText>
                </Pressable>
            }
        >
            <View
                testID={`${base}-actions`}
                role="menu"
                aria-label={title}
                accessibilityLabel={title}
                className="flex-col"
            >
                {description === undefined ? null : (
                    <RNText
                        testID={`${base}-description`}
                        className="px-2 pb-2 text-sm text-content-secondary text-start"
                    >
                        {description}
                    </RNText>
                )}

                {actions.map((action) => {
                    const destructive = action.tone === 'destructive';
                    const disabled = action.disabled === true;
                    return (
                        <Pressable
                            key={action.key}
                            testID={action.testID ?? `${base}-action-${action.key}`}
                            role="menuitem"
                            accessibilityRole="menuitem"
                            accessibilityLabel={action.label}
                            accessibilityHint={action.description}
                            accessibilityState={{ disabled }}
                            aria-disabled={disabled}
                            disabled={disabled}
                            focusable={!disabled}
                            onPress={() => {
                                onClose();
                                action.onPress();
                            }}
                            className={cx(
                                'min-h-touch flex-row items-center gap-3 rounded-lg px-3 py-3',
                                disabled ? 'opacity-50' : null,
                            )}
                        >
                            {action.icon === undefined && !destructive ? null : (
                                <Icon
                                    testID={`${base}-action-${action.key}-icon`}
                                    name={action.icon ?? 'warning'}
                                    className={
                                        destructive
                                            ? 'text-danger-strong'
                                            : 'text-content-secondary'
                                    }
                                />
                            )}
                            <View className="flex-1 flex-col gap-0.5">
                                <RNText
                                    className={cx(
                                        'text-base text-start',
                                        destructive
                                            ? 'font-medium text-danger-strong'
                                            : 'text-content-primary',
                                    )}
                                >
                                    {action.label}
                                </RNText>
                                {action.description === undefined ? null : (
                                    <RNText className="text-xs text-content-secondary text-start">
                                        {action.description}
                                    </RNText>
                                )}
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        </Drawer>
    );
}
