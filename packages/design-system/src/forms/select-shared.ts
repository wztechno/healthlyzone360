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
    /**
     * A heading the option is listed under, as `Menu`'s `sections` label its runs. Consecutive
     * options with the same `section` share one heading, so the caller orders the list. Never
     * searched: a filter by heading would empty a group the reader is looking inside. An option with
     * no section is drawn exactly as before — no heading, no group around it.
     */
    readonly section?: string | undefined;
    /** How many records the option stands for — drawn after the name as "Short · 3". */
    readonly count?: number | undefined;
    /** Overrides the derived `{select}-option-{value}` id. */
    readonly testID?: string | undefined;
}

/** What a row draws as its name: the label, and the count after it when there is one. */
export function optionText(option: SelectOption): string {
    return option.count === undefined ? option.label : `${option.label} · ${String(option.count)}`;
}

/** A run of consecutive options under one heading; `section` undefined is a run with none. */
export interface SelectOptionRun<T extends string = string> {
    readonly section: string | undefined;
    readonly options: readonly SelectOption<T>[];
}

/** Splits options into runs of the same `section`, in order. A list with none is one run. */
export function sectionRuns<T extends string>(
    options: readonly SelectOption<T>[],
): readonly SelectOptionRun<T>[] {
    const runs: { section: string | undefined; options: SelectOption<T>[] }[] = [];
    for (const option of options) {
        const last = runs[runs.length - 1];
        if (last !== undefined && last.section === option.section) last.options.push(option);
        else runs.push({ section: option.section, options: [option] });
    }
    return runs;
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
     * The "Type to filter" box above the options.
     *
     * - `'auto'` — on when the list is longer than {@link SEARCH_THRESHOLD}, off for a short one
     *   (kg / L / Pc). The default for the admin's `card` look, so no page has to decide.
     * - `true` / `false` — forced, for the rare list that needs the other answer.
     * - A list with a `noResultsAction` (add what was typed) always has the box, unless forced off.
     *
     * The `field` look keeps its old default, off, so the web shop is unchanged.
     */
    readonly searchable?: boolean | 'auto' | undefined;
    /**
     * The open list's look. `card` is the kitchen admin's one dropdown look — the rounded card
     * from the recipe editor's "Add an ingredient…": a filter box, uppercase group headings, and a
     * row per option with its description under the name. Web only; the phone's sheet is unchanged.
     * A `pill` trigger is always `card`.
     */
    readonly look?: 'field' | 'card' | undefined;
    /**
     * What opens the list.
     *
     * - `field` (default) — the form field: a label above, the chosen value in an input frame.
     * - `pill` — the admin's 34px toolbar pill, with no field around it. With a `value` it is a
     *   scope ("Slot  **All** ⌄"), soft green once it is set to anything but the first option. With
     *   `value={null}` it is an action ("Add an ingredient… ⌄") that shows `placeholder`, and the
     *   caller keeps the value `null` after a pick. `label` names it for assistive technology.
     *   `hint`, `error` and `warning` belong to a field and are not drawn on a pill.
     */
    readonly trigger?: 'field' | 'pill' | undefined;
    /** Which edge of the trigger the card lines up with. A pill at a row's end opens to `end`. */
    readonly align?: 'start' | 'end' | undefined;
    /**
     * How wide the field is.
     *
     * - `'auto'` (default) — narrow when every option is a few letters (kg / L / Pc), so a unit is
     *   not a long empty box; otherwise the width the page gives it.
     * - `'fill'` / `'narrow'` — forced, for the rare field that needs the other answer.
     *
     * A field only — a pill is always as wide as what it says.
     */
    readonly width?: 'auto' | 'fill' | 'narrow' | undefined;
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

/**
 * A list longer than this gets the filter box by itself (`searchable="auto"`). Eight is what a
 * desk card shows before it scrolls: past that, typing is quicker than looking.
 */
export const SEARCH_THRESHOLD = 8;

/** Options this short or shorter (kg, L, Pc, pcs) make an `auto` field narrow. */
export const SHORT_OPTION_LENGTH = 4;

/** Whether a field is drawn narrow — see `SelectProps['width']`. */
export function resolveNarrow(
    width: 'auto' | 'fill' | 'narrow' | undefined,
    options: readonly SelectOption[],
): boolean {
    if (width === 'narrow') return true;
    if (width === 'fill') return false;
    return (
        options.length > 0 &&
        options.every((option) => optionText(option).length <= SHORT_OPTION_LENGTH)
    );
}

/**
 * Whether the filter box is drawn. Unset, the `card` look decides by length and the `field` look
 * keeps its old answer, off — see `SelectProps['searchable']`.
 */
export function resolveSearchable(
    searchable: boolean | 'auto' | undefined,
    look: 'field' | 'card',
    optionCount: number,
    canAddTyped = false,
): boolean {
    // A list that adds what was typed ("Add “…” as new") needs the box whatever its length: typing
    // is how a reader reaches the Add, and a new kitchen's three ingredients are still a list to add to.
    if (searchable === undefined && canAddTyped) return true;
    const setting = searchable ?? (look === 'card' ? 'auto' : false);
    return setting === 'auto' ? optionCount > SEARCH_THRESHOLD : setting;
}

/** Case-insensitive substring match over what an option shows the reader, and its keywords. */
export function optionMatches(option: SelectOption, needle: string): boolean {
    const haystack =
        `${option.label} ${option.description ?? ''} ${option.keywords ?? ''}`.toLocaleLowerCase();
    return haystack.includes(needle);
}
