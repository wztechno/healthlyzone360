/**
 * Everything both halves of `Select` agree on.
 *
 * The split is behavioural, not cosmetic: the web renders its options in an anchored panel below
 * the field — the dropdown the Catalogue design draws, and the shape §5 already specifies for
 * `SearchSelect` — while native keeps the full-screen modal radio group, which is the platform's
 * own idiom for a picker and the only one that works on a 375px viewport with a keyboard up.
 *
 * What must not differ is the *contract*: the same props, the same option shape, the same filter,
 * and the same `-trigger` / `-value` / `-option-…` test identities, so a suite written against one
 * platform describes the other. That is what lives here.
 */

export interface SelectOption<T extends string = string> {
    readonly value: T;
    readonly label: string;
    readonly description?: string | undefined;
    readonly disabled?: boolean | undefined;
}

export interface SelectProps<T extends string = string> {
    readonly label: string;
    /** See `FormField`'s `labelHidden` — for a control named by a column header. */
    readonly labelHidden?: boolean | undefined;
    readonly options: readonly SelectOption<T>[];
    readonly value: T | null;
    readonly onChange: (value: T) => void;
    readonly placeholder?: string | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /**
     * Adds a type-ahead filter above the option list. Off by default, and off means the list is
     * rendered exactly as it was before this prop existed — no extra nodes, no extra live region.
     */
    readonly searchable?: boolean | undefined;
    readonly id?: string | undefined;
    /**
     * How many columns this select occupies inside a `FormGrid`.
     *
     * Declared here and read by the grid, never by this component — see `form-field.tsx` for why
     * the field states the intent and the grid clamps it.
     */
    readonly span?: number | undefined;
    readonly fullWidth?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** Case-insensitive substring match over the two strings an option shows the reader. */
export function optionMatches(option: SelectOption, needle: string): boolean {
    const haystack = `${option.label} ${option.description ?? ''}`.toLocaleLowerCase();
    return haystack.includes(needle);
}
