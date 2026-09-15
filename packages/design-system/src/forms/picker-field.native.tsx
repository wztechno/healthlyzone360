import { View } from 'react-native';

import { PICKER_FORMAT, PICKER_WIDTH } from './picker-field-shared.ts';
import type { PickerFieldProps } from './picker-field-shared.ts';
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
    testID,
}: PickerFieldProps) {
    return (
        <View style={{ width: PICKER_WIDTH[kind] }}>
            <TextInputField
                label={label}
                labelHidden={labelHidden}
                hint={hint}
                error={error}
                disabled={disabled}
                size="sm"
                value={value}
                onChangeText={onChange}
                placeholder={PICKER_FORMAT[kind]}
                testID={testID}
            />
        </View>
    );
}
