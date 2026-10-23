import type { ReactNode } from 'react';

import type { GridSpanProps } from '../primitives/grid-shared.ts';
import type { InputSize } from './text-input.tsx';

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
    /** A word or two of context, drawn at the end of the option's one line — a unit, a status. */
    readonly description?: string | undefined;
    /**
     * Text the search matches and the list never draws — a reference or a code a reader may type
     * ("RC-0001", "SUP-01") but does not need to see beside every name.
     */
    readonly keywords?: string | undefined;
    readonly disabled?: boolean | undefined;
}

/**
 * `span` is read by `FormGrid` off the element, exactly as it is for `FormField`; neither half of
 * `Select` spreads its props anywhere, so it never reaches the DOM.
 */
export interface SelectProps<T extends string = string> extends GridSpanProps {
    readonly label: string;
    /** See `FormField`'s `labelHidden` — for a control named by a column header. */
    readonly labelHidden?: boolean | undefined;
    readonly options: readonly SelectOption<T>[];
    readonly value: T | null;
    readonly onChange: (value: T) => void;
    readonly placeholder?: string | undefined;
    readonly hint?: string | undefined;
    readonly error?: string | undefined;
    /** A non-blocking caution under the field — see `FormField`. */
    readonly warning?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /**
     * Adds a type-ahead filter above the option list. Off by default, and off means the list is
     * rendered exactly as it was before this prop existed — no extra nodes, no extra live region.
     */
    readonly searchable?: boolean | undefined;
    /**
     * The options are still being fetched. An empty list then says so rather than "No option
     * matches", which read as a refusal for the half minute a slow list took to arrive.
     */
    readonly loading?: boolean | undefined;
    /**
     * Drawn under "No option matches" when a typed search empties a `searchable` list — the place for
     * "Add “…” as new" when the options are a library the reader can add to. Gets the typed text and
     * the panel's own close, so the action can hand off and get out of the way.
     */
    readonly noResultsAction?: ((query: string, close: () => void) => ReactNode) | undefined;
    /**
     * The frame's height step. Unset, it is the ladder's ordinary control — `sm` under the compact
     * ladder, `md` on the comfortable one. `xs` is the 24px cell step `TextInputField` already has,
     * for a picker that sits in a dense line table beside `xs` inputs: a 28px picker between two
     * 24px boxes is the one control in the row that does not line up.
     */
    readonly size?: InputSize | undefined;
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

/** Case-insensitive substring match over what an option shows the reader, and its keywords. */
export function optionMatches(option: SelectOption, needle: string): boolean {
    const haystack =
        `${option.label} ${option.description ?? ''} ${option.keywords ?? ''}`.toLocaleLowerCase();
    return haystack.includes(needle);
}
