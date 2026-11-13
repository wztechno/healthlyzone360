import type { SliderDirection } from '@healthy360/design-system';

import type { ShelfTint } from './shelf-tints.ts';

/** A range's two ends; `null` is "no limit" on that side. */
export interface RangeEnds {
    readonly min: number | null;
    readonly max: number | null;
}

export interface RangeSliderProps {
    readonly testID: string;
    readonly label: string;
    /** The whole scale. */
    readonly floor: number;
    readonly ceiling: number;
    readonly step: number;
    readonly value: RangeEnds;
    /** "Any", "Under 600 kcal", "400 – 600 kcal" — composed by the screen, which knows the locale. */
    readonly readout: string;
    /**
     * The same readout for any value — so the web slider can say where a handle is while it is
     * still being dragged, before the change is committed.
     */
    readonly readoutFor?: ((value: RangeEnds) => string) | undefined;
    /** The menu's colour, which the fill and the handles wear. */
    readonly tint: ShelfTint;
    /** The two handles' names, for a screen reader. */
    readonly lowLabel: string;
    readonly highLabel: string;
    /** The one end a phone's stepper sets (`slider-field.native.tsx`). */
    readonly direction: SliderDirection;
    readonly unit: string;
    readonly onChange: (next: RangeEnds) => void;
}

/** The CSS custom property each tint's ink lives in, for the handles' rings. */
export const TINT_INK_VAR: Readonly<Record<ShelfTint, string>> = {
    neutral: '--h360-color-text-primary',
    green: '--h360-color-tint-green-on',
    blue: '--h360-color-tint-blue-on',
    orange: '--h360-color-tint-orange-on',
    yellow: '--h360-color-tint-yellow-on',
    teal: '--h360-color-tint-teal-on',
    pink: '--h360-color-tint-pink-on',
    violet: '--h360-color-tint-violet-on',
};
