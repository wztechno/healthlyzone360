import { Text as RNText } from 'react-native';

import { fieldLabelClassName } from './field-label-shared.ts';
import type { FieldLabelProps } from './field-label-shared.ts';

export type { FieldLabelProps } from './field-label-shared.ts';

/**
 * Field label — native.
 *
 * `nativeID` is the anchor the control's `aria-labelledby` resolves against; `htmlFor` has no
 * meaning on a platform without a DOM and is deliberately unused here rather than faked.
 */
export function FieldLabel({ id, text, requiredMark, disabled = false, testID }: FieldLabelProps) {
    return (
        <RNText nativeID={id} testID={testID} className={fieldLabelClassName(disabled)}>
            {text}
            {requiredMark === undefined ? null : (
                <RNText className="text-danger-strong">{` ${requiredMark}`}</RNText>
            )}
        </RNText>
    );
}
