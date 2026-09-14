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
