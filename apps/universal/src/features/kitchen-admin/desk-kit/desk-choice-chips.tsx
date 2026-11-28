import { Pressable, Text as RNText, View } from 'react-native';

export interface DeskChoiceChip {
    readonly key: string;
    /** Translated — the chip's text and its accessible name. */
    readonly label: string;
    readonly disabled?: boolean | undefined;
}

/**
 * `.chipset` — a wrapping row of pill chips, exactly one of them chosen (the corporate canvas's
 * Accept and schedule dialog, 2026-11-10: the delivery day and the delivery window).
 *
 * ```
 *  ( Wed 11 )  ( Thu 12 )  [( Fri 13 )]  ( Sat 14 )      chosen: brand-subtle ground, brand edge
 * ```
 *
 * A chip rather than a `Select`: the choices are few and short, and the reader compares them by
 * looking. Each chip is a toggle button with `aria-pressed`, the group names the question. 32px
 * tall on the desk ladder.
 */
export function DeskChoiceChips({
    label,
    items,
    value,
    onChange,
    testID,
}: {
    /** Translated — the group's accessible name. */
    readonly label: string;
    readonly items: readonly DeskChoiceChip[];
    readonly value: string | null;
    readonly onChange: (key: string) => void;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            role="group"
            aria-label={label}
            accessibilityLabel={label}
            className="flex-row flex-wrap gap-1.5"
        >
            {items.map((item) => {
                const selected = item.key === value;
                const disabled = item.disabled === true;
                return (
                    <Pressable
                        key={item.key}
                        testID={testID === undefined ? undefined : `${testID}-${item.key}`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{ selected, disabled }}
                        aria-pressed={selected}
                        disabled={disabled}
                        onPress={() => {
                            onChange(item.key);
                        }}
                        className={`h-8 flex-row items-center rounded-full border px-3 web:transition-colors ${
                            selected
                                ? 'border-surface-brand bg-surface-brand-subtle'
                                : 'border-stroke-subtle bg-surface-raised'
                        } ${disabled ? 'opacity-50' : selected ? '' : 'hover:bg-surface-sunken'}`}
                    >
                        <RNText
                            numberOfLines={1}
                            className={`text-[13px] font-semibold tabular-nums ${
                                selected ? 'text-content-on-brand-subtle' : 'text-content-primary'
                            }`}
                        >
                            {item.label}
                        </RNText>
                    </Pressable>
                );
            })}
        </View>
    );
}
