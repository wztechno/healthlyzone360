import { Button, Icon, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

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
    /** Label for the disclosure toggle — already carrying its count, e.g. "Filters (3)". */
    readonly filtersLabel: string;
    readonly filtersActive: number;
    readonly onToggleFilters: () => void;
    readonly filtersExpanded: boolean;
    /** `nativeID` of the panel this toggle controls. */
    readonly filtersPanelId: string;
    readonly activeFilters?: readonly ActiveFilterChip[] | undefined;
    readonly onClearAll?: (() => void) | undefined;
    readonly clearAllLabel?: string | undefined;
    /** Already pluralised by the screen, and stating a total. */
    readonly resultSummary?: string | undefined;
    /** The sort control, which keeps its own visible label. */
    readonly sort?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

export function ToolbarRow({
    filtersLabel,
    filtersActive,
    onToggleFilters,
    filtersExpanded,
    filtersPanelId,
    activeFilters = [],
    onClearAll,
    clearAllLabel,
    resultSummary,
    sort,
    testID = 'toolbar-row',
}: ToolbarRowProps) {
    return (
        <View
            testID={testID}
            // One row, wrapping rather than overflowing. `items-center` gives every control the
            // same baseline, which is the complaint §2.5 opens with: a filter button bottom-aligned
            // against a label-and-select twice its height.
            className="flex-row flex-wrap items-center gap-2"
        >
            <Pressable
                testID={`${testID}-filters`}
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
                <Text variant="label" className="text-content-primary">
                    {filtersLabel}
                </Text>
                {filtersActive === 0 ? null : (
                    <View
                        testID={`${testID}-filters-count`}
                        className="min-w-[22px] items-center justify-center rounded-full bg-surface-brand px-1.5 py-0.5"
                    >
                        <Text className="text-xs font-bold text-content-on-brand">
                            {String(filtersActive)}
                        </Text>
                    </View>
                )}
            </Pressable>

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
                    <Text className="text-sm font-medium text-content-on-brand-subtle">
                        {chip.label}
                    </Text>
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
                <Text
                    testID={`${testID}-count`}
                    role="status"
                    aria-live="polite"
                    // The display face, per §2.5. The figure inside is deliberately *not* coloured
                    // separately: doing that means splitting a translated sentence around its
                    // number, and Arabic does not put the number where English does.
                    className="font-display text-sm text-content-primary"
                >
                    {resultSummary}
                </Text>
            )}

            {sort}
        </View>
    );
}
