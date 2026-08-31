import { NumberStepper } from './number-stepper.tsx';
import type { SliderFieldProps } from './slider-field-shared.ts';

export type { SliderFieldProps, SliderDirection } from './slider-field-shared.ts';

/**
 * Slider — native.
 *
 * There is no slider here, and that is the point. `number-stepper.tsx` and
 * `docs/architecture/05-universal-frontend.md` reject a drag rail because it cannot be operated
 * without a pointer, needs a bespoke keyboard implementation, cannot be hit accurately on a 360px
 * screen and costs a gesture dependency. On the web an `<input type="range">` answers all four for
 * nothing. On iOS and Android none of that is available, every objection stands, and the honest
 * implementation of "one number, one bound" is the stepper the design system already ships.
 *
 * The prop surface is identical to the web half, so a screen composes one control and gets whichever
 * is right for the platform it is running on. `min`, `max` and `step` map onto the stepper's own
 * bounds, so the value a person can reach is the same on both.
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
    disabled = false,
    id,
    className,
    testID,
}: SliderFieldProps) {
    return (
        <NumberStepper
            testID={testID}
            label={label}
            // The readout is the sentence the web half puts under the track — "Under 700 kcal". As
            // a hint it does the same job: it is what tells you which side of the figure is being
            // filtered, which the number by itself never says.
            hint={readout}
            value={value}
            onChange={(next) => {
                onChange(next === min ? null : next);
            }}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            {...(unit === undefined ? {} : { unit })}
            {...(id === undefined ? {} : { id })}
            {...(className === undefined ? {} : { className })}
        />
    );
}
