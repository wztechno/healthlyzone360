import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { IconButton } from '../actions/button.tsx';
import { cx } from '../internal/class-names.ts';
import { descriptionProps } from '../internal/a11y.ts';
import { inputFrameClassName } from './text-input.tsx';

export interface SelectOption<T extends string = string> {
    readonly value: T;
    readonly label: string;
    readonly description?: string | undefined;
    readonly disabled?: boolean | undefined;
}

export interface SelectProps<T extends string = string> {
    readonly label: string;
    readonly options: readonly SelectOption<T>[];
    readonly value: T | null;
    readonly onChange: (value: T) => void;
    readonly placeholder?: string | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Select.
 *
 * Implemented as **a button that opens a modal radio group**, not as an ARIA `combobox`.
 *
 * A combobox is the obvious choice on the web and the wrong one here: its required attribute and
 * owned-element rules (`aria-controls` pointing at a listbox that only exists while open,
 * `aria-activedescendant` tracking) are easy to get subtly wrong, axe reports every slip as a
 * serious violation, and none of it maps onto React Native, so the two platforms would drift. A
 * dialog containing `role="radiogroup"` is unambiguously valid ARIA, is the native pattern anyway,
 * and needs no `.web.tsx` split — react-native-web's `Modal` already traps focus and calls
 * `onRequestClose` on Escape.
 */
export function Select<T extends string = string>({
    label,
    options,
    value,
    onChange,
    placeholder,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
}: SelectProps<T>) {
    const { t } = useTranslation();
    const generated = useId();
    const base = id ?? `select-${generated.replace(/:/g, '')}`;
    const labelId = `${base}-label`;
    const hintId = hint === undefined ? undefined : `${base}-hint`;
    const errorId = error === undefined ? undefined : `${base}-error`;

    const [open, setOpen] = useState(false);
    const selected = options.find((option) => option.value === value) ?? null;
    const displayText = selected?.label ?? placeholder ?? t('designSystem:select.placeholder');

    return (
        <View className={cx('flex-col gap-1', className)} testID={testID}>
            <RNText
                nativeID={labelId}
                className={cx(
                    'text-sm font-medium text-start',
                    disabled ? 'text-content-disabled' : 'text-content-primary',
                )}
            >
                {label}
                {required ? <RNText className="text-danger-strong">{' *'}</RNText> : null}
            </RNText>

            {hint === undefined ? null : (
                <RNText nativeID={hintId} className="text-xs text-content-secondary text-start">
                    {hint}
                </RNText>
            )}

            <Pressable
                testID={testID === undefined ? undefined : `${testID}-trigger`}
                nativeID={base}
                role="button"
                accessibilityRole="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                accessibilityLabel={`${label}: ${displayText}`}
                aria-label={`${label}: ${displayText}`}
                aria-labelledby={labelId}
                {...descriptionProps([hintId, errorId], error ?? hint)}
                aria-invalid={error !== undefined}
                aria-required={required}
                accessibilityState={{ disabled, expanded: open }}
                aria-disabled={disabled}
                focusable={!disabled}
                disabled={disabled}
                onPress={() => {
                    setOpen(true);
                }}
                className={inputFrameClassName({
                    invalid: error !== undefined,
                    focused: open,
                    disabled,
                })}
            >
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-value`}
                    className={cx(
                        'flex-1 text-base text-start',
                        selected === null ? 'text-content-secondary' : 'text-content-primary',
                    )}
                    numberOfLines={1}
                >
                    {displayText}
                </RNText>
                <Icon name="chevronDown" size="sm" className="text-content-secondary" />
            </Pressable>

            {error === undefined ? null : (
                <View className="flex-row items-center gap-1">
                    <Icon name="warning" size="sm" className="text-danger-strong" />
                    <RNText
                        nativeID={errorId}
                        testID={testID === undefined ? undefined : `${testID}-error`}
                        role="alert"
                        accessibilityRole="alert"
                        className="flex-1 text-xs text-danger-strong text-start"
                    >
                        {error}
                    </RNText>
                </View>
            )}

            <Modal
                visible={open}
                transparent
                animationType="fade"
                onRequestClose={() => {
                    setOpen(false);
                }}
            >
                <View className="flex-1 items-center justify-center bg-overlay p-4">
                    <View
                        testID={testID === undefined ? undefined : `${testID}-list`}
                        role="dialog"
                        accessibilityRole="none"
                        aria-modal
                        aria-labelledby={`${base}-dialog-title`}
                        className="w-full max-w-[420px] overflow-hidden rounded-xl bg-surface-raised"
                    >
                        <View className="flex-row items-center justify-between gap-2 border-b border-stroke-subtle p-4">
                            <RNText
                                nativeID={`${base}-dialog-title`}
                                accessibilityRole="header"
                                aria-level={2}
                                className="flex-1 text-base font-semibold text-content-primary text-start"
                            >
                                {label}
                            </RNText>
                            <IconButton
                                testID={testID === undefined ? undefined : `${testID}-close`}
                                size="sm"
                                label={t('common:action.close')}
                                icon={<Icon name="close" />}
                                onPress={() => {
                                    setOpen(false);
                                }}
                            />
                        </View>

                        <ScrollView
                            role="radiogroup"
                            aria-labelledby={`${base}-dialog-title`}
                            className="max-h-[360px]"
                        >
                            {options.map((option) => {
                                const isSelected = option.value === value;
                                return (
                                    <Pressable
                                        key={option.value}
                                        testID={
                                            testID === undefined
                                                ? undefined
                                                : `${testID}-option-${option.value}`
                                        }
                                        role="radio"
                                        accessibilityRole="radio"
                                        accessibilityLabel={option.label}
                                        aria-label={option.label}
                                        aria-checked={isSelected}
                                        accessibilityState={{
                                            checked: isSelected,
                                            disabled: option.disabled === true,
                                        }}
                                        aria-disabled={option.disabled === true}
                                        focusable={option.disabled !== true}
                                        disabled={option.disabled === true}
                                        onPress={() => {
                                            onChange(option.value);
                                            setOpen(false);
                                        }}
                                        className={cx(
                                            'flex-row items-center gap-3 border-b border-stroke-subtle px-4 py-3 min-h-touch',
                                            option.disabled === true ? 'opacity-50' : null,
                                        )}
                                    >
                                        <View className="w-5">
                                            {isSelected ? (
                                                <Icon
                                                    name="check"
                                                    className="text-content-on-brand-subtle"
                                                />
                                            ) : null}
                                        </View>
                                        <View className="flex-1 flex-col gap-0.5">
                                            <RNText className="text-base text-content-primary text-start">
                                                {option.label}
                                            </RNText>
                                            {option.description === undefined ? null : (
                                                <RNText className="text-xs text-content-secondary text-start">
                                                    {option.description}
                                                </RNText>
                                            )}
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
