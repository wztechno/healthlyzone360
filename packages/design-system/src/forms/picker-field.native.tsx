import { View } from 'react-native';

import { PICKER_FORMAT, PICKER_WIDTH } from './picker-field-shared.ts';
import type { PickerFieldProps } from './picker-field-shared.ts';
import { TimeField } from './time-field.tsx';
import { TextInputField } from './text-input.tsx';

export type { PickerFieldProps } from './picker-field-shared.ts';

/**
 * PickerField — native half. A typed ISO field with its format as the placeholder.
 *
 * The web half's trick is a browser pseudo-element, which native does not have, and an OS picker
 * here means `@react-native-community/datetimepicker` — a native module for a desk surface nobody
 * drives from a phone. The value contract is identical, so a caller never branches.
 */
export function PickerField({
    kind,
    label,
    labelHidden,
    value,
    onChange,
    hint,
    error,
    disabled,
    displayValue,
    fullWidth = false,
    testID,
}: PickerFieldProps) {
    // Time has its own themed field — typed or picked from a panel — on both platforms.
    if (kind === 'time') {
        return (
            <TimeField
                label={label}
                labelHidden={labelHidden}
                value={value}
                onChange={onChange}
                hint={hint}
                error={error}
                disabled={disabled}
                fullWidth={fullWidth}
                testID={testID}
            />
        );
    }
    return (
        <View style={fullWidth ? undefined : { width: PICKER_WIDTH[kind] }}>
            <TextInputField
                label={label}
                labelHidden={labelHidden}
                hint={hint}
                error={error}
                disabled={disabled}
                size="sm"
                value={value}
                onChangeText={onChange}
                // The value is typed here, so the page's wording of it is only useful where there
                // is nothing typed — `Open-ended` says more about an empty end date than a format.
                placeholder={displayValue ?? PICKER_FORMAT[kind]}
                testID={testID}
            />
        </View>
    );
}
