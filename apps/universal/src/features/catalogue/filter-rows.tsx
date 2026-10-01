import { Pressable, Text as RNText, View } from 'react-native';

/**
 * A filter group drawn as a column of full-width rows rather than a wrap of pills.
 *
 * ## Why two treatments exist at all
 *
 * HealthZone's catalogue rail draws its groups two different ways, and the difference is not
 * decoration. `CATEGORY` is a column of full-width rows; `DIETARY` is a wrap of pills. The rule
 * underneath it is that a **short list of long labels** wraps badly — "Low carbohydrate" and
 * "Saffron and Sea Kitchen" each take a whole line of a 264px rail anyway, so laying them out as
 * pills spends a pill's worth of border and padding to arrive at the same one-per-line result, and
 * ragged pill edges make the column look accidental. A **long list of short labels** is the reverse:
 * ten diet names pack three to a line and read as a set.
 *
 * That is why Category and Kitchen use this and Diet keeps chips. Applying one treatment
 * to everything is what made the rail 1,700px tall.
 *
 * ## It writes through the same state as the chips
 *
 * `onToggle` is `MarketplaceFilterState.toggle`, and the testIDs follow the same
 * `meals-filter-{group}-{value}` scheme `FilterBar` emits, so a row and a chip are interchangeable
 * to every spec that reaches for one. Selection is announced with `aria-pressed` on the web and
 * `accessibilityState.selected` on native — the same pair `FilterChip` sets, for the same reason:
 * neither platform sees the other's attribute.
 *
 * Selection is not carried by colour alone: a chosen row gains a raised fill *and* a visible
 * border where an unchosen one has neither — a change of shape, as the design's `sideBtn` draws it,
 * rather than the check glyph this used to add, which the design does not have.
 */
export interface FilterRowOption {
    readonly value: string;
    readonly label: string;
    /**
     * How many listings sit behind the row, already formatted for the locale — HealthZone's
     * `CATEGORY` list prints one beside every name. Omitted when the repository cannot count, and
     * then the row simply has no figure rather than a guessed one.
     */
    readonly countText?: string | undefined;
    /** The name a screen reader hears when the row carries a figure — "Lunch, 12 meals". */
    readonly accessibilityLabel?: string | undefined;
}

export interface FilterRowsProps {
    readonly options: readonly FilterRowOption[];
    readonly selected: readonly string[];
    readonly onToggle: (value: string, selected: boolean) => void;
    /** Prefix for each row's handle — `meals-filter` yields `meals-filter-category-bowls`. */
    readonly testID: string;
    readonly groupKey: string;
}

export function FilterRows({ options, selected, onToggle, testID, groupKey }: FilterRowsProps) {
    if (options.length === 0) return null;

    // No group heading of its own: the eyebrow above names the group.
    return (
        <View className="flex-col gap-0.5">
            {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                    <Pressable
                        key={option.value}
                        testID={`${testID}-${groupKey}-${option.value}`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={option.accessibilityLabel ?? option.label}
                        accessibilityState={{ selected: isSelected }}
                        aria-pressed={isSelected}
                        focusable
                        onPress={() => {
                            onToggle(option.value, !isSelected);
                        }}
                        /*
                         * The design's `sideBtn`: a row that is transparent and quiet until it
                         * is chosen, then gains a raised fill and a visible border. The unlit
                         * state carries no border at all, which is what keeps a column of six
                         * of them from reading as a table.
                         */
                        className={`min-h-touch flex-row items-center justify-between gap-2 rounded border px-3 py-2.5 ${
                            isSelected
                                ? 'border-stroke bg-surface-raised'
                                : 'border-transparent bg-transparent'
                        }`}
                    >
                        <RNText
                            numberOfLines={1}
                            className={`flex-1 text-sm font-medium text-start ${
                                isSelected ? 'text-content-primary' : 'text-content-secondary'
                            }`}
                        >
                            {option.label}
                        </RNText>
                        {option.countText === undefined ? null : (
                            <RNText
                                testID={`${testID}-${groupKey}-${option.value}-count`}
                                aria-hidden
                                accessibilityElementsHidden
                                importantForAccessibility="no"
                                className="text-xs tabular-nums text-content-secondary"
                            >
                                {option.countText}
                            </RNText>
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}
