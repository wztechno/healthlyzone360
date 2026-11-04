import { Icon, cx } from '@healthy360/design-system';
import { useCallback, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useOutsideDismiss } from './use-outside-dismiss.ts';

/**
 * The shop design's sort control: an ink button naming the order in force, and under it a short
 * list of the orders, the chosen one ticked in the brand colour. The list hangs from the button's
 * end edge; Escape or a press outside closes it.
 */
export interface InkSortMenuProps<T extends string> {
    readonly testID: string;
    /** What the control is — "Sort" — for a screen reader. */
    readonly label: string;
    /** "{{label}}: {{value}}", composed by the screen. */
    readonly accessibilityLabel: string;
    readonly value: T;
    readonly options: readonly { readonly value: T; readonly label: string }[];
    readonly onChange: (next: T) => void;
}

export function InkSortMenu<T extends string>({
    testID,
    label,
    accessibilityLabel,
    value,
    options,
    onChange,
}: InkSortMenuProps<T>) {
    const [open, setOpen] = useState(false);
    const close = useCallback(() => {
        setOpen(false);
    }, []);
    const root = useOutsideDismiss(open, close);
    const current = options.find((option) => option.value === value)?.label ?? '';

    return (
        <View ref={root} className="relative z-auto">
            <Pressable
                testID={testID}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                aria-haspopup="menu"
                aria-expanded={open}
                accessibilityState={{ expanded: open }}
                onPress={() => {
                    setOpen((now) => !now);
                }}
                className="h-[52px] flex-row items-center gap-2.5 rounded-2xl bg-content-primary pe-4 ps-3.5"
            >
                <Icon name="listChecks" size="sm" className="text-surface-base" />
                <RNText numberOfLines={1} className="text-sm font-semibold text-surface-base">
                    {current}
                </RNText>
                <Icon name="chevronDown" size="sm" className="text-surface-base" />
            </Pressable>
            {open ? (
                <View
                    testID={`${testID}-panel`}
                    role="menu"
                    aria-label={label}
                    className="absolute end-0 top-full z-tooltip mt-2 w-[260px] rounded-2xl border border-stroke-subtle bg-surface-raised p-2 shadow-elevation-3"
                >
                    {options.map((option) => {
                        const on = option.value === value;
                        return (
                            <Pressable
                                key={option.value}
                                testID={`${testID}-${option.value}`}
                                role="menuitem"
                                aria-selected={on}
                                accessibilityState={{ selected: on }}
                                onPress={() => {
                                    onChange(option.value);
                                    close();
                                }}
                                className="h-11 flex-row items-center justify-between rounded-xl px-3 hover:bg-surface-base"
                            >
                                <RNText
                                    className={cx(
                                        'text-sm',
                                        on
                                            ? 'font-bold text-content-brand'
                                            : 'font-medium text-content-primary',
                                    )}
                                >
                                    {option.label}
                                </RNText>
                                {on ? (
                                    <Icon name="check" size="sm" className="text-content-brand" />
                                ) : null}
                            </Pressable>
                        );
                    })}
                </View>
            ) : null}
        </View>
    );
}
