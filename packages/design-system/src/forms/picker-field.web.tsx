import { useState } from 'react';
import { Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { PICKER_WIDTH } from './picker-field-shared.ts';
import type { PickerFieldProps } from './picker-field-shared.ts';
import { TimeField } from './time-field.tsx';
import { inputFrameClassName } from './text-input.tsx';

export type { PickerFieldProps } from './picker-field-shared.ts';

/**
 * PickerField — web half. Time has its own themed field ({@link TimeField}), typed or picked from a
 * panel; date and month keep the browser's input below.
 */
export function PickerField(props: PickerFieldProps) {
    if (props.kind === 'time') {
        return (
            <TimeField
                label={props.label}
                labelHidden={props.labelHidden}
                value={props.value}
                onChange={props.onChange}
                hint={props.hint}
                error={props.error}
                disabled={props.disabled}
                fullWidth={props.fullWidth}
                testID={props.testID}
            />
        );
    }
    return <BrowserPickerField {...props} />;
}

/**
 * The browser's own `<input type="date | month">` whose trigger is a drawn
 * button (Workbench handoff §1b).
 *
 * **The drawn button is not a button.** The browser's own `::-webkit-calendar-picker-indicator` is
 * made transparent and stretched over the 28px at the field's inline end (`global.css`, keyed on
 * `data-picker-field`), and the drawn `calendar` / `clock` sits on top of it with
 * `pointer-events: none`. So the click lands on the real indicator and the OS picker opens: one
 * glyph, no JavaScript, and it keeps working where `showPicker()` does not exist.
 *
 * The value stays ISO whatever the locale renders — that is the input's contract, not this file's.
 *
 * **With a `displayValue`** the page draws the words and the input is laid invisibly over the whole
 * frame (`data-picker-field="cover"`, whose indicator `global.css` stretches edge to edge), so a
 * press anywhere on the field opens the OS picker. The input still owns focus, the label and the
 * value; only its rendering is replaced.
 */
function BrowserPickerField({
    kind,
    label,
    labelHidden = false,
    value,
    onChange,
    hint,
    error,
    disabled = false,
    displayValue,
    fullWidth = false,
    testID,
}: PickerFieldProps) {
    const density = useDensity();
    const [focused, setFocused] = useState(false);
    const covered = displayValue !== undefined;

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
                    style={fullWidth ? undefined : { width: PICKER_WIDTH[kind] }}
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
                    {covered ? (
                        <RNText
                            testID={testID === undefined ? undefined : `${testID}-display`}
                            aria-hidden
                            numberOfLines={1}
                            className={cx(
                                'min-w-0 flex-1 pe-1 text-start text-role-body tabular-nums',
                                value === '' ? 'text-content-secondary' : 'text-content-primary',
                            )}
                        >
                            {displayValue}
                        </RNText>
                    ) : null}
                    <input
                        type={kind}
                        data-picker-field={covered ? 'cover' : ''}
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
                        className={
                            covered
                                ? 'absolute inset-0 h-full w-full appearance-none border-0 bg-transparent opacity-0 outline-none'
                                : 'relative h-full min-w-0 flex-1 appearance-none border-0 bg-transparent pe-7 text-role-body tabular-nums text-content-primary outline-none'
                        }
                    />
                    <View
                        pointerEvents="none"
                        aria-hidden
                        className={cx(
                            'h-6 w-6 items-center justify-center',
                            covered ? 'me-0.5' : 'absolute end-0.5',
                        )}
                    >
                        <Icon name="calendar" size="sm" className="text-content-secondary" />
                    </View>
                </View>
            )}
        </FormField>
    );
}
