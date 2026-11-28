import { View } from 'react-native';

import { FilterChip } from '../content/chip.tsx';

/**
 * A wrapping row of pill chips, exactly one of them chosen (the corporate canvas's Accept and
 * schedule dialog, 2026-11-10: the delivery day and the delivery window; moved from the kitchen
 * admin's desk kit 2026-11-26).
 *
 * ```
 *  ( Wed 11 )  ( Thu 12 )  [( Fri 13 )]  ( Sat 14 )      chosen: brand-subtle ground, brand edge
 * ```
 *
 * A chip rather than a `Select`: the choices are few and short, and the reader compares them by
 * looking. Each chip is a `FilterChip` — a toggle button with `aria-pressed` — and the group names
 * the question. A choice with a detail beside it is a `ChoiceRow`.
 */
export interface ChoiceChip {
    readonly key: string;
    /** Translated — the chip's text and its accessible name. */
    readonly label: string;
    readonly disabled?: boolean | undefined;
}

export function ChoiceChips({
    label,
    items,
    value,
    onChange,
    testID,
}: {
    /** Translated — the group's accessible name. */
    readonly label: string;
    readonly items: readonly ChoiceChip[];
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
            {items.map((item) => (
                <FilterChip
                    key={item.key}
                    {...(testID === undefined ? {} : { testID: `${testID}-${item.key}` })}
                    label={item.label}
                    selected={item.key === value}
                    disabled={item.disabled === true}
                    onChange={() => {
                        onChange(item.key);
                    }}
                />
            ))}
        </View>
    );
}
