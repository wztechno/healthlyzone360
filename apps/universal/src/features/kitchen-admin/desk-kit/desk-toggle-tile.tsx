import { Icon } from '@healthy360/design-system';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * `.dtl` — one tile of a set the reader ticks any number of (the plan editor's diet
 * classifications, Commercial canvas 2026-11-15).
 *
 * ```
 * ┌──────────────────────┐  ┌──────────────────────┐
 * │ [✓]  High protein    │  │ [ ]  Vegan           │   ticked: brand-subtle ground, brand edge,
 * └──────────────────────┘  └──────────────────────┘   a filled box; not: raised, the box empty
 * ```
 *
 * A tile rather than a `FilterChip`: the set is a record's answer, not a filter, and a box that
 * fills says "chosen" without the reader comparing two shades of pill. 44px tall and 184px wide,
 * so a row of them lines up as a grid however many wrap.
 *
 * `accessibilityState` carries `selected` beside `checked`: the plan editor's suites read the
 * chip's `selected`, and a screen reader is told `checked` by the role.
 */
export function DeskToggleTile({
    label,
    selected,
    onChange,
    disabled = false,
    testID,
}: {
    /** Translated — the tile's text and its accessible name. */
    readonly label: string;
    readonly selected: boolean;
    readonly onChange: (next: boolean) => void;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    return (
        <Pressable
            testID={testID}
            role="checkbox"
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected, selected, disabled }}
            aria-checked={selected}
            disabled={disabled}
            onPress={() => {
                onChange(!selected);
            }}
            className={`h-11 w-[184px] flex-row items-center gap-2.5 rounded-xl border px-3 web:transition-colors ${
                selected
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-stroke bg-surface-raised'
            } ${disabled ? 'opacity-50' : selected ? '' : 'hover:border-surface-brand hover:bg-surface-sunken'}`}
        >
            <View
                aria-hidden
                className={`h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] ${
                    selected ? 'border-surface-brand bg-surface-brand' : 'border-stroke bg-surface-raised'
                }`}
            >
                {selected ? <Icon name="check" size="sm" className="text-content-on-brand" /> : null}
            </View>
            <RNText
                numberOfLines={1}
                className={`min-w-0 shrink text-sm font-semibold ${
                    selected ? 'text-content-on-brand-subtle' : 'text-content-primary'
                }`}
            >
                {label}
            </RNText>
        </Pressable>
    );
}
