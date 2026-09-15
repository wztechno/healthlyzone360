import { Icon } from '@healthy360/design-system';
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
 * That is why Meal and Kitchen use this and Diet keeps `FilterBar`'s chips. Applying one treatment
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
 * Selection is never carried by colour alone; a selected row gains a check glyph, as the chips do.
 */
export interface FilterRowOption {
    readonly value: string;
    readonly label: string;
}

export interface FilterRowsProps {
    readonly options: readonly FilterRowOption[];
    readonly selected: readonly string[];
    readonly onToggle: (value: string, selected: boolean) => void;
    /** Prefix for each row's handle — `meals-filter` yields `meals-filter-mealType-lunch`. */
    readonly testID: string;
    readonly groupKey: string;
}

export function FilterRows({ options, selected, onToggle, testID, groupKey }: FilterRowsProps) {
    if (options.length === 0) return null;

    // No group heading of its own: the accordion header above names the group, and repeating it
    // four pixels below would be the second of two identical labels.
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
                        accessibilityLabel={option.label}
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
                        className={`min-h-touch flex-row items-center justify-between gap-2 rounded-lg border px-3 ${
                            isSelected
                                ? 'border-stroke bg-surface-raised'
                                : 'border-transparent bg-transparent'
                        }`}
                    >
                        <RNText
                            numberOfLines={1}
                            className={`flex-1 text-sm text-start ${
                                isSelected
                                    ? 'font-medium text-content-primary'
                                    : 'text-content-secondary'
                            }`}
                        >
                            {option.label}
                        </RNText>
                        {isSelected ? (
                            <Icon name="check" size="sm" className="text-content-primary" />
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}
