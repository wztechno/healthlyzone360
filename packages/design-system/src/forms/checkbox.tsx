import { useId } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { descriptionProps } from '../internal/a11y.ts';

export interface CheckboxProps {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
    readonly label: string;
    /** Extra copy under the label — used for consent wording that is too long for a label. */
    readonly description?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
    /** Replaces the plain-text label — for consents that embed a link. */
    readonly labelSlot?: ReactNode | undefined;
}

/**
 * Checkbox.
 *
 * The whole row is the hit target, which is what gets a 44 px touch area without stretching the box
 * itself — on the customer surfaces. Under `compact` the row drops to `controlHeight.sm`, because a
 * Catalogue filter list of fifteen allergen classes at 44px a row is a scrollbar rather than a
 * filter, and the admin is driven with a mouse. The box itself is unchanged in both: it is the
 * *target* that differs, not the mark. `accessibilityRole="checkbox"` plus `accessibilityState.checked` is the pair
 * react-native-web turns into `role="checkbox"` + `aria-checked`; omitting the state leaves axe
 * reporting a checkbox with no checked state, which is a serious violation rather than a nicety.
 */
export function Checkbox({
    checked,
    onChange,
    label,
    description,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
    labelSlot,
}: CheckboxProps) {
    const density = useDensity();
    const generated = useId();
    const base = id ?? `checkbox-${generated.replace(/:/g, '')}`;
    const descriptionId = description === undefined ? undefined : `${base}-description`;
    const errorId = error === undefined ? undefined : `${base}-error`;

    return (
        <View className={cx('flex-col gap-1', className)} testID={testID}>
            <Pressable
                testID={testID === undefined ? undefined : `${testID}-control`}
                nativeID={base}
                role="checkbox"
                accessibilityRole="checkbox"
                accessibilityLabel={label}
                aria-label={label}
                accessibilityState={{ checked, disabled }}
                aria-checked={checked}
                aria-disabled={disabled}
                aria-required={required}
                {...descriptionProps([descriptionId, errorId], description ?? error)}
                disabled={disabled}
                onPress={() => {
                    if (!disabled) onChange(!checked);
                }}
                className={cx(
                    'flex-row items-start',
                    density === 'compact' ? 'gap-control-sm py-hair' : 'min-h-touch gap-3 py-1',
                    disabled ? 'opacity-50' : null,
                )}
            >
                <View
                    testID={testID === undefined ? undefined : `${testID}-box`}
                    className={cx(
                        'mt-0.5 size-5 items-center justify-center rounded-sm border',
                        checked ? 'bg-surface-brand border-transparent' : 'bg-surface-base',
                        error === undefined ? 'border-stroke-strong' : 'border-danger-border',
                    )}
                >
                    {checked ? (
                        <Icon name="check" size="sm" className="text-content-on-brand" />
                    ) : null}
                </View>

                <View className="flex-1 flex-col gap-0.5">
                    {labelSlot ?? (
                        <RNText
                            className={cx(
                                'text-content-primary text-start',
                                density === 'compact' ? 'text-role-body font-admin' : 'text-sm',
                            )}
                        >
                            {label}
                            {required ? (
                                <RNText className="text-danger-strong">{' *'}</RNText>
                            ) : null}
                        </RNText>
                    )}
                    {description === undefined ? null : (
                        <RNText
                            nativeID={descriptionId}
                            className={cx(
                                'text-content-secondary text-start',
                                density === 'compact' ? 'text-role-caption font-admin' : 'text-xs',
                            )}
                        >
                            {description}
                        </RNText>
                    )}
                </View>
            </Pressable>

            {error === undefined ? null : (
                <View className="flex-row items-center gap-1">
                    <Icon name="warning" size="sm" className="text-danger-strong" />
                    <RNText
                        nativeID={errorId}
                        testID={testID === undefined ? undefined : `${testID}-error`}
                        role="alert"
                        accessibilityRole="alert"
                        className={cx(
                            'flex-1 text-danger-strong text-start',
                            density === 'compact' ? 'text-role-caption font-admin' : 'text-xs',
                        )}
                    >
                        {error}
                    </RNText>
                </View>
            )}
        </View>
    );
}
