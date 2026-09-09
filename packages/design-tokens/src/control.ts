/**
 * Control geometry — the single knob the Catalogue's density turns on.
 *
 * Everything a person can click, type into or press resolves its height from exactly one of the
 * tables below, so "make the admin two pixels tighter" is one number and one `pnpm build:tokens`
 * rather than a sweep through forty components. Nothing here carries a colour and nothing here
 * carries a width except the two that are deliberately fixed (see {@link fieldWidth}).
 *
 * **These are pointer sizes, and that is the whole story.** An earlier pass carried a second,
 * taller ladder for coarse pointers so that a 44px touch minimum could survive alongside the 32px
 * brief. It is gone. The kitchen admin is a desk surface driven with a mouse; the phone surface is
 * the customer app, and the customer app does not read these tables. Sizing the Catalogue for a
 * fingertip it will never meet cost it a third of its density in exchange for nothing.
 *
 * So there is no touch ladder here and no `MIN_TOUCH_TARGET` — that constant is retired. The
 * customer surfaces keep their 44px floor through the `min-h-touch` / `min-w-touch` utilities,
 * which the Tailwind preset still emits from a literal of its own; the note in
 * `generators/tailwind-preset.ts` explains why it lives there rather than here.
 */

export const CONTROL_SIZES = ['xs', 'sm', 'md', 'lg'] as const;
export type ControlSize = (typeof CONTROL_SIZES)[number];

/**
 * Control heights, in dp. The Catalogue default is `sm`; `md` is a page's one primary action.
 * `lg` is unused in admin and exists for the customer surfaces.
 */
export const controlHeight: Readonly<Record<ControlSize, number>> = {
    xs: 24,
    sm: 28,
    md: 32,
    lg: 36,
};

export const controlPaddingX: Readonly<Record<ControlSize, number>> = {
    xs: 6,
    sm: 8,
    md: 10,
    lg: 14,
};

export const controlGap: Readonly<Record<ControlSize, number>> = {
    xs: 4,
    sm: 6,
    md: 6,
    lg: 8,
};

/**
 * Glyph sizes inside a control, in dp.
 *
 * Deliberately separate from the type scale: an icon is sized to the control that holds it, not to
 * the text beside it, and driving it from a font size is how a 12px glyph ends up centred in a
 * 44px row (`responsive.ltr.spec.ts` calls that case out — a tall row of tiny icons is as
 * unusable as a short one).
 */
export const iconSize: Readonly<Record<ControlSize, number>> = {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
};

export const ROW_DENSITIES = ['sm', 'md', 'lg'] as const;
export type RowDensity = (typeof ROW_DENSITIES)[number];

/** Catalogue list row heights, switched by the toolbar's density control. `md` is the default. */
export const rowHeight: Readonly<Record<RowDensity, number>> = {
    sm: 28,
    md: 32,
    lg: 36,
};

/**
 * The fixed column width a form field resolves to, in dp.
 *
 * A constant, and constant across every breakpoint — only the *number* of columns is responsive.
 * This is the no-stretch rule: a field that grows to fill its container produces a 900px-wide text
 * input for a two-character unit, which is the single loudest complaint about the current forms.
 * Wider fields are opt-in and explicit (`span`, `fullWidth`), never emergent from the layout.
 */
export const fieldWidth = 280;

/** Card grid track bounds, in dp. `minmax(min, max)` with `justify-content: start`, never `1fr`. */
export const cardWidth = {
    min: 200,
    max: 260,
} as const;
