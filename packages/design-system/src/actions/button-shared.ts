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
export const BUTTON_VARIANTS = [
    'primary',
    'secondary',
    'quiet',
    'ghost',
    'danger',
    'sidebar',
    // The admin canvas's own levels (2026-11-26, from the old `DeskButton`): a row's next step with
    // a brand ring, and the outlined destructive command that sits among others (Cancel order).
    'next',
    'dangerOutline',
    // On a dark band (the corporate picked-lines bar): the filled call and the outlined one beside it.
    'inverse',
    'inverseOutline',
] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

export const CONTAINER_VARIANT: Readonly<Record<ButtonVariant, string>> = {
    // Hovers to the canopy rather than to a lighter green: the primary is already `brand-surface`
    // because `brand-500` cannot legally carry small white text (§1.3), so there is nowhere to go
    // but darker.
    primary: 'bg-surface-brand border border-transparent hover:bg-surface-canopy',
    // The outlined levels hover to the sunken fill. They used to have no hover at all, so under a
    // pointer they read the same as a disabled control does — nothing answered until the press.
    // A disabled button never takes it: React Native Web drops hover on a disabled `Pressable`.
    secondary: 'bg-surface-raised border border-stroke hover:bg-surface-sunken',
    quiet: 'bg-surface-raised border border-stroke-subtle hover:bg-surface-sunken',
    ghost: 'bg-transparent border border-transparent hover:bg-surface-sunken',
    danger: 'bg-danger border border-transparent',
    // The primary of a panel drawn in the sidebar green (the order desk ticket): the rail's own
    // active pill, white in light mode, so it reads as the one action on that ground.
    sidebar: 'bg-surface-sidebar-active border border-transparent hover:opacity-90',
    next: 'bg-surface-raised border border-surface-brand hover:bg-surface-brand-subtle',
    dangerOutline: 'bg-surface-raised border border-danger-border hover:bg-danger-subtle',
    inverse: 'bg-stage-green border border-transparent hover:opacity-90',
    inverseOutline: 'bg-transparent border border-content-inverse/30 hover:bg-content-inverse/15',
};

/**
 * The admin canvas's buttons — what `Button` draws under `AreaLookScope look="desk"` (the Orders
 * canvas, 2026-11-10; the old `DeskButton`). Every one is a pill on the toolbar's 34px; the primary
 * carries the brand glow, the one lifted control in a toolbar or a pop-up header; `quiet` and
 * `ghost` are a link-weight word in the brand ink.
 */
export const DESK_CONTAINER_VARIANT: Readonly<Record<ButtonVariant, string>> = {
    primary:
        'border border-surface-brand bg-surface-brand shadow-elevation-brand-glow hover:border-surface-canopy hover:bg-surface-canopy',
    secondary:
        'border border-stroke-subtle bg-surface-raised hover:border-stroke hover:bg-surface-brand-subtle',
    quiet: 'border border-transparent bg-transparent hover:bg-surface-brand-subtle',
    ghost: 'border border-transparent bg-transparent hover:bg-surface-brand-subtle',
    danger: 'border border-danger bg-danger hover:border-danger-strong hover:bg-danger-strong',
    sidebar: 'bg-surface-sidebar-active border border-transparent hover:opacity-90',
    next: 'border border-surface-brand bg-surface-raised hover:bg-surface-brand-subtle',
    dangerOutline: 'border border-danger-border bg-surface-raised hover:bg-danger-subtle',
    inverse: 'bg-stage-green border border-transparent hover:opacity-90',
    inverseOutline: 'bg-transparent border border-content-inverse/30 hover:bg-content-inverse/15',
};

/** The desk label's ink; the glyphs beside it take the same. Weight is the size's (`role-strong`). */
export const DESK_LABEL_VARIANT: Readonly<Record<ButtonVariant, string>> = {
    primary: 'text-content-on-brand',
    secondary: 'text-content-primary',
    quiet: 'text-content-on-brand-subtle',
    ghost: 'text-content-on-brand-subtle',
    danger: 'text-danger-on-default',
    sidebar: 'text-content-on-sidebar-active',
    next: 'text-content-on-brand-subtle',
    dangerOutline: 'text-danger-strong',
    inverse: 'text-surface-canopy',
    inverseOutline: 'text-content-inverse',
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
    sidebar: 'text-content-on-sidebar-active font-semibold',
    next: 'text-content-on-brand-subtle font-medium',
    dangerOutline: 'text-danger-strong font-medium',
    inverse: 'text-surface-canopy font-semibold',
    inverseOutline: 'text-content-inverse font-medium',
};
