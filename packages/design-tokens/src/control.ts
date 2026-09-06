/**
 * Control geometry — the single knob the Catalogue's density turns on.
 *
 * Everything a person can click, type into or press resolves its height from exactly one of the
 * tables below, so "make the admin two pixels tighter" is one number and one `pnpm build:tokens`
 * rather than a sweep through forty components. Nothing here carries a colour and nothing here
 * carries a width except the two that are deliberately fixed (see {@link fieldWidth}).
 *
 * **Why there are two height tables.** A mouse pointer resolves to about one pixel; a fingertip
 * covers about forty-four. The Catalogue brief asks for 32px controls, and on a desk with a mouse
 * that is comfortable and correct. On a phone or a tablet it is not — and `apps/universal` is one
 * Expo app that ships to both. So the pointer table is the default and the touch table is the
 * floor applied when the primary pointer is coarse, which is `useIsCoarsePointer()`: always true
 * on native, and the `(pointer: coarse)` media query on the web.
 *
 * That is the resolution `catalogue-redesign-plan.md` §3.1 proposed — "so the 44px invariant and
 * the compact brief both hold" — and it is the only reading under which `CLAUDE.md`'s
 * "44px minimum touch target" invariant survives. {@link MIN_TOUCH_TARGET} is therefore *not*
 * retired; `controlHeightTouch.md` is equal to it by construction, and a test asserts so.
 *
 * The cost is honest and worth stating: on a tablet the Catalogue is not as compact as the mock.
 * A design reviewed on an iPad will show 44px rows where the mock shows 32.
 */

import { MIN_TOUCH_TARGET } from './layout.ts';

export const CONTROL_SIZES = ['xs', 'sm', 'md', 'lg'] as const;
export type ControlSize = (typeof CONTROL_SIZES)[number];

/**
 * Control heights for a fine pointer, in dp. The Catalogue default is `sm`; `md` is a page's one
 * primary action. `lg` is unused in admin and exists for the customer surfaces.
 */
export const controlHeight: Readonly<Record<ControlSize, number>> = {
    xs: 24,
    sm: 28,
    md: 32,
    lg: 36,
};

/**
 * The same ladder for a coarse pointer. `md` is {@link MIN_TOUCH_TARGET} exactly — this table is
 * the invariant's implementation, not an exception to it.
 */
export const controlHeightTouch: Readonly<Record<ControlSize, number>> = {
    xs: 36,
    sm: 40,
    md: MIN_TOUCH_TARGET,
    lg: 48,
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

/** As {@link controlHeightTouch} is to {@link controlHeight}: the coarse-pointer floor for rows. */
export const rowHeightTouch: Readonly<Record<RowDensity, number>> = {
    sm: 40,
    md: MIN_TOUCH_TARGET,
    lg: 48,
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
