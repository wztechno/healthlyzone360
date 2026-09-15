import { useState } from 'react';
import { View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { PICKER_WIDTH } from './picker-field-shared.ts';
import type { PickerFieldProps } from './picker-field-shared.ts';
import { inputFrameClassName } from './text-input.tsx';

export type { PickerFieldProps } from './picker-field-shared.ts';

/**
 * PickerField — web half. A native `<input type="date | month | time">` whose trigger is a drawn
 * button (Workbench handoff §1b).
 *
 * **The drawn button is not a button.** The browser's own `::-webkit-calendar-picker-indicator` is
 * made transparent and stretched over the 28px at the field's inline end (`global.css`, keyed on
 * `data-picker-field`), and the drawn `calendar` / `clock` sits on top of it with
 * `pointer-events: none`. So the click lands on the real indicator and the OS picker opens: one
 * glyph, no JavaScript, and it keeps working where `showPicker()` does not exist.
 *
 * The value stays ISO whatever the locale renders — that is the input's contract, not this file's.
 */
export function PickerField({
    kind,
    label,
    labelHidden = false,
    value,
    onChange,
    hint,
    error,
    disabled = false,
    testID,
}: PickerFieldProps) {
    const density = useDensity();
    const [focused, setFocused] = useState(false);

    return (
        <FormField
            label={label}
            labelHidden={labelHidden}
            hint={hint}
            error={error}
            disabled={disabled}
            testID={testID}
        >
            {(control: FieldControlProps) => (
                <View
                    style={{ width: PICKER_WIDTH[kind] }}
                    className={cx(
                        inputFrameClassName({
                            invalid: error !== undefined,
                            focused,
                            disabled,
                            density,
                            size: 'sm',
                        }),
                        'relative items-center pe-0',
                    )}
                >
                    <input
                        type={kind}
                        data-picker-field=""
                        id={control.nativeID}
                        data-testid={testID === undefined ? undefined : `${testID}-input`}
                        aria-labelledby={control['aria-labelledby']}
                        aria-describedby={control['aria-describedby']}
                        aria-invalid={control['aria-invalid']}
                        disabled={disabled}
                        value={value}
                        onFocus={() => {
                            setFocused(true);
                        }}
                        onBlur={() => {
                            setFocused(false);
                        }}
                        onChange={(event) => {
                            onChange(event.target.value);
                        }}
                        className="relative h-full min-w-0 flex-1 appearance-none border-0 bg-transparent pe-7 text-role-body tabular-nums text-content-primary outline-none"
                    />
                    <View
                        pointerEvents="none"
                        aria-hidden
                        className="absolute end-0.5 h-6 w-6 items-center justify-center"
                    >
                        <Icon
                            name={kind === 'time' ? 'clock' : 'calendar'}
                            size="sm"
                            className="text-content-secondary"
                        />
                    </View>
                </View>
            )}
        </FormField>
    );
}
