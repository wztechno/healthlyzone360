/**
 * What both halves of `PickerField` share. Platform-neutral, so the index exports from here.
 */
export const PICKER_KINDS = ['date', 'month', 'time'] as const;
export type PickerKind = (typeof PICKER_KINDS)[number];

export interface PickerFieldProps {
    readonly kind: PickerKind;
    /** Translated. Visible above the control unless `labelHidden`. */
    readonly label: string;
    readonly labelHidden?: boolean | undefined;
    /** ISO — `YYYY-MM-DD`, `YYYY-MM` or `HH:mm` — or `''` for no value. Never a localised string. */
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly disabled?: boolean | undefined;
    /**
     * The value as the page words it — `21 Sep 2026`, or `Open-ended` for no value — drawn in place
     * of the browser's own rendering, which follows the *operating system's* locale rather than the
     * page's and has no way to say what an empty date means.
     *
     * On the web the whole field then opens the OS picker, not just the glyph: there is no typed
     * text to place a caret in. Native, which types the ISO value, shows it as the placeholder of an
     * empty field.
     */
    readonly displayValue?: string | undefined;
    /**
     * Take the width of the cell it sits in instead of {@link PICKER_WIDTH}. For a table column
     * whose track is already the field's width; the track widths are headroom for the browser's own
     * rendering, which a `displayValue` field does not use.
     */
    readonly fullWidth?: boolean | undefined;
    readonly testID?: string | undefined;
}

/** The ISO shape each kind stores, used as the native placeholder. Not translated: it is a format. */
export const PICKER_FORMAT: Readonly<Record<PickerKind, string>> = {
    date: 'YYYY-MM-DD',
    month: 'YYYY-MM',
    time: 'HH:mm',
};

/**
 * The track each kind needs (Workbench handoff §1b, "Sizing rule").
 *
 * A native `date`/`time` input renders in the **user's locale** — `09/01/2026`, `08:30 PM` — not the
 * ISO string, and 28px of its inline end belongs to the picker button. Measured content widths are
 * 64 / 100 / 120px; these carry the handoff's headroom on top. Narrow one and re-measure.
 */
export const PICKER_WIDTH: Readonly<Record<PickerKind, number>> = {
    time: 104,
    date: 148,
    month: 168,
};
