/**
 * What `Button` and `IconButton` agree on.
 *
 * The two files would otherwise import from each other — `button.tsx` re-exports `IconButton` for
 * the deep imports that predate the split, and `IconButton` needs the variant tables — and a cycle
 * that happens to resolve today is not a thing to leave in a design system. The repository already
 * spells this pattern `*-shared.ts` (`date-field-shared.ts`, `slider-field-shared.ts`).
 *
 * Nothing here carries a size: the ladder differs between a labelled control and a square one, so
 * each file states its own.
 */

/**
 * `quiet` is the demoted-but-still-a-button level, and it is what Sign out becomes.
 *
 * It keeps its border on purpose. Borderless was tried and rejected: a bare text control sitting in
 * a row of filled and outlined buttons reads as disabled rather than as low priority. The border
 * says "still a button"; the neutral fill and the secondary label say "not the one you came for".
 *
 * It sits between `secondary` and `ghost`: `secondary` is a real alternative action and keeps
 * primary-strength text on a full-weight border, while `ghost` has no box at all and belongs inside
 * dense rows where a border per control would be noise.
 */
export const BUTTON_VARIANTS = ['primary', 'secondary', 'quiet', 'ghost', 'danger'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

export const CONTAINER_VARIANT: Readonly<Record<ButtonVariant, string>> = {
    // Hovers to the canopy rather than to a lighter green: the primary is already `brand-surface`
    // because `brand-500` cannot legally carry small white text (§1.3), so there is nowhere to go
    // but darker.
    primary: 'bg-surface-brand border border-transparent hover:bg-surface-canopy',
    secondary: 'bg-surface-raised border border-stroke',
    quiet: 'bg-surface-raised border border-stroke-subtle',
    ghost: 'bg-transparent border border-transparent',
    danger: 'bg-danger border border-transparent',
};

/**
 * Weight follows *emphasis*, not size.
 *
 * It used to follow size — `sm` and `lg` were semibold, `md` medium — which meant a ghost button
 * and a primary button at the same size shouted equally loudly, and the same control changed
 * weight when it changed size. The design draws it the other way round: filled buttons are 600 and
 * outlined or borderless ones are 500, at every size. That is also what the old comment here was
 * reaching for when it said a medium weight "on a coloured fill reads as thin" — the fill was
 * always the real variable, so it belongs on the variant.
 */
export const LABEL_VARIANT: Readonly<Record<ButtonVariant, string>> = {
    primary: 'text-content-on-brand font-semibold',
    secondary: 'text-content-primary font-medium',
    quiet: 'text-content-secondary font-medium',
    ghost: 'text-content-primary font-medium',
    danger: 'text-danger-on-default font-semibold',
};
