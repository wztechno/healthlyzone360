import { View } from 'react-native';

import { cx } from '../internal/class-names.ts';
import { clampIso, isIsoDate, withinBounds } from './date-field-shared.ts';
import type { DateFieldProps } from './date-field-shared.ts';
import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';

export type { DateFieldProps } from './date-field-shared.ts';

/**
 * Date field — web.
 *
 * A real `input[type=date]`, rendered as a DOM element rather than through react-native-web. That
 * is the whole point of the platform split: the browser already ships a date picker that is
 * keyboard-operable, screen-reader-labelled, locale-formatted, touch-friendly and translated, and
 * nothing hand-built here would match it. `react-native-web`'s `TextInput` cannot express
 * `type="date"`, so the element is written directly.
 *
 * The value in and out is always ISO `YYYY-MM-DD` — which is also exactly what the DOM element
 * emits — so the two platform halves are interchangeable to a caller.
 */
export function DateField({
    label,
    value,
    onChange,
    min,
    max,
    hint,
    error,
    required = false,
    disabled = false,
    id,
    className,
    testID,
}: DateFieldProps) {
    return (
        <FormField
            label={label}
            hint={hint}
            error={error}
            required={required}
            disabled={disabled}
            id={id}
            className={className}
            testID={testID}
        >
            {(control: FieldControlProps) => (
                <View
                    className={cx(
                        'flex-row items-center gap-2 rounded-lg border bg-surface-base px-3 min-h-touch',
                        error === undefined ? 'border-stroke' : 'border-danger-border',
                        // Not an opacity — see `inputFrameClassName`: dimming the frame dims
                        // the date along with it, below the contrast floor.
                        disabled ? 'bg-surface-sunken border-stroke-subtle' : null,
                    )}
                >
                    <input
                        type="date"
                        id={control.nativeID}
                        data-testid={testID === undefined ? undefined : `${testID}-input`}
                        aria-labelledby={control['aria-labelledby']}
                        aria-describedby={control['aria-describedby']}
                        aria-invalid={control['aria-invalid']}
                        aria-required={control['aria-required']}
                        disabled={disabled}
                        min={min}
                        max={max}
                        value={value ?? ''}
                        onChange={(event) => {
                            const next = event.target.value;
                            if (next.length === 0) {
                                onChange(null);
                                return;
                            }
                            if (!isIsoDate(next)) return;
                            onChange(
                                withinBounds(next, min, max) ? next : clampIso(next, min, max),
                            );
                        }}
                        className="h-11 flex-1 border-0 bg-transparent text-base text-content-primary outline-none"
                    />
                </View>
            )}
        </FormField>
    );
}
