import { Text as RNText, View } from 'react-native';

import { FormField } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { sliderReadoutClassName } from './slider-field-shared.ts';
import type { SliderFieldProps } from './slider-field-shared.ts';

export type { SliderFieldProps, SliderDirection } from './slider-field-shared.ts';

/**
 * Slider — web.
 *
 * A real `<input type="range">`, written as a DOM element rather than as a `View` with a pan
 * handler for the same reason `date-field.web.tsx` writes a real `<input type="date">`: the
 * browser's own control carries `role="slider"`, `aria-valuenow` / `valuemin` / `valuemax`, and
 * arrow-key, Home and End handling, none of which a hand-built rail gets for free. See
 * `slider-field-shared.ts` for why this does not contradict the design system's no-slider rule.
 *
 * Only the input itself is a DOM element. The label, hint and error scaffolding come from
 * {@link FormField} exactly as every other field's do, so the association `aria-labelledby`
 * resolves is the one the rest of the system builds, and a slider sits level with a text field
 * beside it.
 *
 * `global.css` already exempts `[type='range']` from the reset that strips borders off
 * react-native-web's text inputs, so the track keeps its native chrome and only the accent is ours.
 *
 * ## The floor means "no limit", and returning to it clears the filter
 *
 * A slider has no empty state — the thumb is always somewhere. So the floor is given the meaning
 * "unset": dragging back to it reports `null`, which is what lets a person lift the filter with the
 * same control they applied it with. Without that the only way out is Clear all, which throws away
 * every other choice they made.
 */
export function SliderField({
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
    unit,
    readout,
    valueText,
    disabled = false,
    id,
    className,
    testID,
}: SliderFieldProps) {
    return (
        <FormField
            label={label}
            disabled={disabled}
            {...(id === undefined ? {} : { id })}
            {...(className === undefined ? {} : { className })}
            {...(testID === undefined ? {} : { testID })}
        >
            {(control: FieldControlProps) => (
                <View className="flex-col gap-1.5">
                    <input
                        type="range"
                        id={control.nativeID}
                        data-testid={testID === undefined ? undefined : `${testID}-input`}
                        aria-labelledby={control['aria-labelledby']}
                        aria-describedby={control['aria-describedby']}
                        // The figure alone is announced as a bare number with no sense of which
                        // side of it is being filtered. `aria-valuetext` is the one attribute that
                        // carries "Under 700 kcal" into the announcement.
                        aria-valuetext={valueText ?? readout}
                        disabled={disabled}
                        min={min}
                        max={max}
                        step={step}
                        value={value ?? min}
                        onChange={(event) => {
                            const next = Number(event.target.value);
                            onChange(next === min ? null : next);
                        }}
                        className="min-h-touch w-full accent-brand-600"
                    />

                    <View className={sliderReadoutClassName()}>
                        {/* The floor, as a scale marker. Hidden from assistive technology: the
                            input already reports its own `aria-valuemin`, and a loose number read
                            out beside the control is noise. */}
                        <RNText
                            aria-hidden
                            accessibilityElementsHidden
                            className="text-xs text-content-disabled"
                        >
                            {unit === undefined ? String(min) : `${String(min)} ${unit}`}
                        </RNText>
                        <RNText
                            testID={testID === undefined ? undefined : `${testID}-readout`}
                            className="text-xs font-medium text-content-primary text-end"
                        >
                            {readout}
                        </RNText>
                    </View>
                </View>
            )}
        </FormField>
    );
}
