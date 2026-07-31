/**
 * The props both halves of {@link FieldLabel} take.
 *
 * The label is platform-split for one reason: on the web an explicit `<label for="…">` is the only
 * association axe (and the WCAG technique behind it) treats as a *visible* label. `aria-labelledby`
 * looks equivalent and is not — axe resolves it through "is this element visible **on screen right
 * now**", so a perfectly good label that happens to be scrolled below the fold stops counting and
 * the control is reported as labelled by its `title`/`aria-describedby` alone. An explicit label is
 * resolved in screen-reader terms instead, which is what a label actually is.
 *
 * React Native has no `<label>` element and no id graph to hang one on, so the native half stays a
 * `Text` carrying `nativeID` — which is what `aria-labelledby` points at on that platform.
 */
export interface FieldLabelProps {
    /** The id of the label element itself. The control's `aria-labelledby` points here. */
    readonly id: string;
    /** The control's id. On the web this becomes the label's `for`. */
    readonly htmlFor: string;
    readonly text: string;
    /** Appended after the text, in the danger tone, when the field is required. */
    readonly requiredMark?: string | undefined;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}

/** The utilities both halves render with, so the two cannot drift apart visually. */
export function fieldLabelClassName(disabled: boolean): string {
    return `text-sm font-medium text-start ${
        disabled ? 'text-content-disabled' : 'text-content-primary'
    }`;
}
