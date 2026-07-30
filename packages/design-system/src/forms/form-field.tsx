import { useId } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

/**
 * The accessibility props a `FormField` hands to whatever control it wraps.
 *
 * Both spellings are supplied on purpose: `aria-describedby` builds the id chain the web platform
 * (and axe) requires, while `accessibilityHint` carries the same text on native, which has no id
 * graph. Keeping them in one object is what stops a hint from existing on one platform only.
 */
export interface FieldControlProps {
    readonly nativeID: string;
    readonly 'aria-labelledby': string;
    readonly accessibilityLabel: string;
    readonly 'aria-describedby'?: string | undefined;
    readonly accessibilityHint?: string | undefined;
    readonly 'aria-invalid': boolean;
    readonly 'aria-required': boolean;
    readonly accessibilityState: { readonly disabled?: boolean };
}

export interface FormFieldProps {
    readonly label: string;
    /** Supporting copy shown under the label and referenced by `aria-describedby`. */
    readonly hint?: string | undefined;
    /** Validation message. Its presence is what marks the control invalid. */
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /** Stable id root. Generated when omitted, which is fine for everything except tests. */
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
    readonly children: (control: FieldControlProps) => ReactNode;
}

/** Marks a required field for sighted users; `aria-required` covers assistive technology. */
export const REQUIRED_MARK = '*';

export function FormField({
    label,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
    children,
}: FormFieldProps) {
    const generated = useId();
    const base = id ?? `field-${generated.replace(/:/g, '')}`;

    const labelId = `${base}-label`;
    const hintId = hint === undefined ? undefined : `${base}-hint`;
    const errorId = error === undefined ? undefined : `${base}-error`;
    const described = [hintId, errorId].filter((value): value is string => value !== undefined);

    const control: FieldControlProps = {
        nativeID: base,
        'aria-labelledby': labelId,
        accessibilityLabel: required ? `${label} ${REQUIRED_MARK}` : label,
        ...(described.length > 0 ? { 'aria-describedby': described.join(' ') } : {}),
        ...(error ?? hint ? { accessibilityHint: error ?? hint } : {}),
        'aria-invalid': error !== undefined,
        'aria-required': required,
        accessibilityState: { disabled },
    };

    return (
        <View testID={testID} className={cx('flex-col gap-1', className)}>
            <RNText
                nativeID={labelId}
                testID={testID === undefined ? undefined : `${testID}-label`}
                className={cx(
                    'text-sm font-medium text-start',
                    disabled ? 'text-content-disabled' : 'text-content-primary',
                )}
            >
                {label}
                {required ? (
                    <RNText className="text-danger-strong">{` ${REQUIRED_MARK}`}</RNText>
                ) : null}
            </RNText>

            {hint === undefined ? null : (
                <RNText
                    nativeID={hintId}
                    testID={testID === undefined ? undefined : `${testID}-hint`}
                    className="text-xs text-content-secondary text-start"
                >
                    {hint}
                </RNText>
            )}

            {children(control)}

            {error === undefined ? null : (
                <View className="flex-row items-center gap-1">
                    {/* An error is never signalled by colour alone: the icon carries it too. */}
                    <Icon name="warning" size="sm" className="text-danger-strong" />
                    <RNText
                        nativeID={errorId}
                        testID={testID === undefined ? undefined : `${testID}-error`}
                        role="alert"
                        accessibilityRole="alert"
                        aria-live="polite"
                        className="flex-1 text-xs text-danger-strong text-start"
                    >
                        {error}
                    </RNText>
                </View>
            )}
        </View>
    );
}
