/**
 * The props both halves of {@link SliderField} take, and the reasoning behind the split.
 *
 * ## Why a slider exists at all, when the design system says it should not
 *
 * `number-stepper.tsx` calls itself "the design system's answer to a slider", and
 * `docs/architecture/05-universal-frontend.md` repeats it. That decision is not overruled here — it
 * is answered. It rests on three objections, and they are objections to a *drag rail built out of
 * gesture handlers on a phone*:
 *
 * 1. "cannot be operated without a pointer" — an `<input type="range">` is operated by arrow keys,
 *    Home and End, with no code at all.
 * 2. "needs a bespoke keyboard implementation" — it does not; the browser supplies one, along with
 *    `role="slider"` and `aria-valuenow` / `valuemin` / `valuemax`.
 * 3. "would mean a gesture dependency" — there is none. No package is added.
 *
 * All three still hold on iOS and Android, where there is no `<input>` and a rail really would be a
 * PanResponder over a 360px-wide track. So the platforms diverge on purpose: the web half is a real
 * range input, and the native half stays the {@link NumberStepper} the architecture doc argues for.
 * That is the same technique, for the same reason, as `date-field.web.tsx` / `date-field.native.tsx`
 * and `field-label.web.tsx` / `field-label.native.tsx`.
 *
 * ## One thumb, and the direction is a prop
 *
 * HealthZone's catalogue draws a single-thumb rail with a one-sided readout — "Under 800". A second
 * thumb is the control `range-filter.tsx` refuses on accessibility grounds, and it is not needed:
 * every numeric question a catalogue actually asks is one-sided. What differs is *which* side, and
 * that is what `direction` names. "Under 700 kcal" and "At least 30 g of protein" are both one
 * thumb; nobody filters for protein under 30 g.
 */

/** Which end of the range the single thumb sets. */
export type SliderDirection = 'atMost' | 'atLeast';

export interface SliderFieldProps {
    readonly label: string;
    /** `null` is "unanswered", and is distinct from `min`. An unanswered slider rests at its floor. */
    readonly value: number | null;
    /**
     * `null` when the thumb returns to the end that means "no limit" — the floor for `atMost`, the
     * floor for `atLeast` as well, since both are unconstrained at zero. Callers clear the
     * parameter rather than writing the bound.
     */
    readonly onChange: (value: number | null) => void;
    readonly min: number;
    readonly max: number;
    readonly step?: number | undefined;
    readonly direction: SliderDirection;
    /** Shown after the figure in the readout — "kcal", "g", "min", a currency code. */
    readonly unit?: string | undefined;
    /**
     * The readout, already translated and already carrying the unit, e.g. "Under 700 kcal". The
     * screen builds it because only the screen knows the locale's number formatting, and because a
     * sentence split around its figure does not survive Arabic.
     */
    readonly readout: string;
    /** Announced instead of the raw number, so a screen reader hears "Under 700 kcal" too. */
    readonly valueText?: string | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** The floor / current-value line under the track. */
export function sliderReadoutClassName(): string {
    return 'flex-row items-center justify-between gap-2';
}
