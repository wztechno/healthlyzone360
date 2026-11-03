import { SliderField } from '@healthy360/design-system';

import type { RangeSliderProps } from './range-slider-shared.ts';

/**
 * On a phone there is no drag rail (`number-stepper.tsx` says why): the range is the design
 * system's one-ended stepper, on the end each figure is filtered by — calories at most, protein at
 * least. Setting that end clears the other, so nothing stale off a shared link keeps narrowing.
 */
export function RangeSlider({
    testID,
    label,
    floor,
    ceiling,
    step,
    value,
    readout,
    direction,
    unit,
    onChange,
}: RangeSliderProps) {
    return (
        <SliderField
            testID={testID}
            id={testID}
            label={label}
            direction={direction}
            value={direction === 'atLeast' ? value.min : value.max}
            min={floor}
            max={ceiling}
            step={step}
            unit={unit}
            readout={readout}
            onChange={(next) => {
                onChange(
                    direction === 'atLeast' ? { min: next, max: null } : { min: null, max: next },
                );
            }}
        />
    );
}
