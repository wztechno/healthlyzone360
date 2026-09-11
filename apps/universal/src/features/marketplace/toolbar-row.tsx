import { Button, Icon } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * The single row of controls that sits above a listing.
 *
 * ## Why this is a new component rather than a change to `FilterBar`
 *
 * §2.5 reads `filter-bar.tsx` and `list-toolbar.tsx` as two stacked toolbars to be flattened. They
 * are not. `FilterBar` is the *contents of the disclosure panel* — on `/meals` it is rendered inside
 * a `Collapse` with `showSearch={false}` — and the three stacked rows the handoff is describing are
 * composed at the screen: a full-width search field, then an `Inline` holding the disclosure toggle
 * and the sort `Select`, then the result count, which lives further down inside `QueryStates`.
 *
 * So there was nothing to flatten. The row is new, `FilterBar` keeps its job of drawing chip groups
 * inside the panel, and `kitchen-admin/list-toolbar.tsx` — a different component with an unrelated
 * prop set — composes this same row rather than growing a second implementation of it.
 *
 * ## The active filters are the point, not decoration
 *
 * With the panel closed by default (a documented behaviour that must survive this pass), a filter
 * applied on a previous visit is otherwise invisible: the grid is short and nothing says why. The
 * chips are that "why", and each one is a control that removes exactly the filter it names, so the
 * fastest way to widen a search does not require opening the panel at all.
 *
 * `/meals` now shows its filters in a rail beside the grid above `lg`, where there is no panel to
 * open and no toggle to draw — hence `showFiltersToggle={false}`. The chips stay even there: the
 * rail says which controls exist, but a selection made three sections down is still quicker to undo
 * from a pill above the grid than to hunt for, and on the way down to a phone the rail becomes a
 * disclosure again and the chips become the only visible account of what is applied.
 *
 * ## The count states a total
 *
 * "Showing 6 of 40" rather than "6 results" — §8 asks for it specifically, and it is the difference
 * between a number that means something and a number that could mean the catalogue is empty.
 */

export interface ActiveFilterChip {
    /** Unique within the row; also the testID suffix. */
    readonly key: string;
    /** What the person selected, in their language — the kitchen's name, "Vegan", "under 500 kcal". */
    readonly label: string;
    /** Accessible name for the remove action, e.g. "Remove filter: Vegan". */
    readonly removeLabel: string;
    readonly onRemove: () => void;
}

export interface ToolbarRowProps {
    /**
     * A search field on the row's leading edge, before the disclosure toggle. Full-width on a
     * narrow screen, ~300px from `md` up — the kitchen lists put their search here; `/meals`
     * keeps its search in the hero and leaves this empty.
     */
    /**
     * The screen's search control, rendered first in the row.
     *
     * A `ReactNode` rather than a value/handler pair: the two callers want different inputs — the
     * admin lists a labelled `TextInputField` with a trailing glyph, the marketplace a plain one —
     * and a row that owned the control would have to grow a prop per difference.
     */
    readonly search?: ReactNode | undefined;
    /**
     * A always-visible filter that sits between the search field and the Filters disclosure — the
     * Catalogue's segmented status set.
     *
     * On the row rather than in the panel because it is the filter every reader of an admin list
     * reaches for: "show me the drafts" is one press here and three behind a disclosure. Everything
     * rarer stays in the panel, which is what keeps the row one row.
     */
    readonly quickFilter?: ReactNode | undefined;
    /** Label for the disclosure toggle — already carrying its count, e.g. "Filters (3)". */
    readonly filtersLabel: string;
    readonly filtersActive: number;
    readonly onToggleFilters: () => void;
    readonly filtersExpanded: boolean;
    /** `nativeID` of the panel this toggle controls. */
    readonly filtersPanelId: string;
    /**
     * `false` for a layout that shows its filters outright — a rail beside the grid — so the row
     * carries only the chips, the count and the sort. A toggle whose `aria-controls` points at a
     * panel that is not in the tree is a broken relationship, not a harmless extra control.
     */
    readonly showFiltersToggle?: boolean | undefined;
    readonly activeFilters?: readonly ActiveFilterChip[] | undefined;
    readonly onClearAll?: (() => void) | undefined;
    readonly clearAllLabel?: string | undefined;
    /** Already pluralised by the screen, and stating a total. */
    readonly resultSummary?: string | undefined;
    /** The sort control, which keeps its own visible label. */
    readonly sort?: ReactNode | undefined;
    /**
     * The screen's primary action, rendered last on the row.
     *
     * On the row rather than on a title line of its own: the Catalogue lists drop the page title
     * (the breadcrumb above already names the screen), and a row that exists only to hold one
     * button is the kind of stacked box the redesign is removing.
     */
    readonly actions?: ReactNode | undefined;
    /**
     * Override the derived handles for the two controls that existed before this row did. A
     * testID is a contract with the suites that already point at it, and renaming one to suit a
     * new component's naming scheme is churn paid for by whoever has to re-find them.
     */
    readonly filtersTestID?: string | undefined;
    readonly countTestID?: string | undefined;
    readonly testID?: string | undefined;
}

export function ToolbarRow({
    search,
    quickFilter,
    filtersLabel,
    filtersActive,
    onToggleFilters,
    filtersExpanded,
    filtersPanelId,
    showFiltersToggle = true,
    activeFilters = [],
    onClearAll,
    clearAllLabel,
    resultSummary,
    sort,
    actions,
    filtersTestID,
    countTestID,
    testID = 'toolbar-row',
}: ToolbarRowProps) {
    const filtersId = filtersTestID ?? `${testID}-filters`;
    const countId = countTestID ?? `${testID}-count`;
    return (
        <View
            testID={testID}
            // One row, wrapping rather than overflowing. `items-center` gives every control the
            // same baseline, which is the complaint §2.5 opens with: a filter button bottom-aligned
            // against a label-and-select twice its height.
            className="flex-row flex-wrap items-center gap-2"
        >
            {search === undefined ? null : <View className="min-w-[240px]">{search}</View>}
            {quickFilter}
            {showFiltersToggle ? (
                <Pressable
                    testID={filtersId}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={filtersLabel}
                    accessibilityState={{ expanded: filtersExpanded }}
                    aria-expanded={filtersExpanded}
                    aria-controls={filtersPanelId}
                    focusable
                    onPress={onToggleFilters}
                    className="min-h-touch flex-row items-center gap-2 rounded-lg border border-stroke-subtle bg-surface-raised px-4 shadow-elevation-1"
                >
                    {/* eslint-disable-next-line no-restricted-syntax -- §1.3 permits brand-500 on graphics: this glyph is decorative, the adjacent label carries the meaning, and 3.05:1 clears the 3:1 non-text threshold. It is not a text colour. */}
                    <Icon name="filter" className="text-brand-500" />
                    <RNText className="text-sm font-medium text-content-primary">
                        {filtersLabel}
                    </RNText>
                    {filtersActive === 0 ? null : (
                        <View
                            testID={`${filtersId}-count`}
                            className="min-w-[22px] items-center justify-center rounded-full bg-surface-brand px-1.5 py-0.5"
                        >
                            <RNText className="text-xs font-bold text-content-on-brand">
                                {String(filtersActive)}
                            </RNText>
                        </View>
                    )}
                </Pressable>
            ) : null}

            {activeFilters.map((chip) => (
                <Pressable
                    key={chip.key}
                    testID={`${testID}-chip-${chip.key}`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={chip.removeLabel}
                    focusable
                    onPress={chip.onRemove}
                    // brand-500 on the border is exactly where §1.3 keeps it; the fill and the text
                    // are the subtle pair, which is contrast-tested as a pair.
                    className="min-h-touch flex-row items-center gap-2 rounded-full border border-brand-500 bg-surface-brand-subtle px-4"
                >
                    <RNText className="text-sm font-medium text-content-on-brand-subtle">
                        {chip.label}
                    </RNText>
                    <Icon name="close" size="sm" className="text-content-on-brand-subtle" />
                </Pressable>
            ))}

            {onClearAll === undefined || activeFilters.length === 0 ? null : (
                // Wrapped, because `Button` sets `self-start` on itself when it is not `block`, and
                // that wins over the row's `items-center` — which is the exact misalignment §2.5
                // opens with. The wrapper is what the row centres; the button fills it.
                <View className="flex-col justify-center">
                    <Button
                        testID={`${testID}-clear`}
                        size="sm"
                        variant="quiet"
                        label={clearAllLabel ?? ''}
                        onPress={onClearAll}
                    />
                </View>
            )}

            {/* Pushes the count and the sort to the trailing edge — the ~1,400px of dead space
                §2.5 complains about is this gap doing nothing, so it does the separating instead. */}
            <View className="grow" />

            {resultSummary === undefined ? null : (
                <RNText
                    testID={countId}
                    role="status"
                    aria-live="polite"
                    // The display face, per §2.5. The figure inside is deliberately *not* coloured
                    // separately: doing that means splitting a translated sentence around its
                    // number, and Arabic does not put the number where English does.
                    className="text-sm text-content-primary"
                >
                    {resultSummary}
                </RNText>
            )}

            {sort}
            {actions === undefined ? null : (
                <View className="ms-auto flex-row items-center gap-2">{actions}</View>
            )}
        </View>
    );
}
