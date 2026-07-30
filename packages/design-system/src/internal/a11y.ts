/**
 * Accessibility prop helpers.
 *
 * React Native and react-native-web both accept the `accessibility*` family, and react-native-web
 * maps them onto ARIA. The helpers below exist so no component has to remember which of the two
 * spellings survives the mapping, and so an `aria-describedby` chain is built the same way every
 * time — a hint that is present on native but missing on the web is the exact defect axe catches.
 */

/** Builds a stable id from a component id and a slot, or `undefined` when there is no base id. */
export function slotId(base: string | undefined, slot: string): string | undefined {
    return base === undefined ? undefined : `${base}-${slot}`;
}

/** Joins the ids a control is described by, dropping empty slots. */
export function describedBy(...ids: readonly (string | undefined)[]): string | undefined {
    const present = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
    return present.length === 0 ? undefined : present.join(' ');
}

/**
 * The description a screen reader announces after the label.
 *
 * On the web `aria-describedby` does the work and the hint must not be duplicated; on native there
 * is no id graph, so the text itself is passed as `accessibilityHint`. Returning both from one
 * place keeps them from drifting apart.
 */
export interface DescriptionProps {
    readonly 'aria-describedby'?: string | undefined;
    readonly accessibilityHint?: string | undefined;
}

export function descriptionProps(
    ids: readonly (string | undefined)[],
    hint: string | undefined,
): DescriptionProps {
    const described = describedBy(...ids);
    return {
        ...(described === undefined ? {} : { 'aria-describedby': described }),
        ...(hint === undefined || hint.length === 0 ? {} : { accessibilityHint: hint }),
    };
}
