import { Pressable, Text as RNText, View } from 'react-native';

/**
 * The desk's segmented tabs (Orders canvas, 2026-11-10).
 *
 * ```
 * size="lg"  `.otabs`   ⟦ Today (9) │ Calendar │ All orders (96) ⟧    a page's views, 38px
 * size="sm"  `.seg3`    ⟦ Month │ Week ⟧                              a toolbar's switch, 28px
 * ```
 *
 * A sunken tray; the chosen tab is a raised card with a soft shadow. A count rides in a soft-green
 * pill and is not spoken — put it in the label where it must be.
 */

export interface DeskTabItem<T extends string> {
    readonly value: T;
    /** Translated. */
    readonly label: string;
    readonly count?: number | undefined;
    readonly testID?: string | undefined;
}

export function DeskTabs<T extends string>({
    label,
    value,
    items,
    onChange,
    size = 'lg',
    radio = false,
    block = false,
    testID,
}: {
    /** Translated. The set's accessible name. */
    readonly label: string;
    readonly value: T;
    readonly items: readonly DeskTabItem<T>[];
    readonly onChange: (value: T) => void;
    readonly size?: 'sm' | 'lg' | undefined;
    /**
     * A choice rather than a view — the payment method in a dialog (`.seg3.big`): announced as
     * radios, and each item a 36px segment.
     */
    readonly radio?: boolean | undefined;
    /** Stretch across the row, the segments sharing it. */
    readonly block?: boolean | undefined;
    readonly testID?: string | undefined;
}) {
    const large = size === 'lg';
    return (
        <View
            testID={testID}
            role={radio ? 'radiogroup' : 'tablist'}
            aria-label={label}
            className={`flex-row bg-surface-sunken ${block ? 'self-stretch' : 'self-start'} ${
                large ? 'gap-0.5 rounded-[14px] p-1' : 'gap-0.5 rounded-lg p-[3px]'
            }`}
        >
            {items.map((item) => {
                const on = item.value === value;
                return (
                    <Pressable
                        key={item.value}
                        testID={item.testID}
                        role={radio ? 'radio' : 'tab'}
                        accessibilityRole={radio ? 'radio' : 'tab'}
                        accessibilityLabel={item.label}
                        accessibilityState={radio ? { checked: on } : { selected: on }}
                        {...(radio ? { 'aria-checked': on } : { 'aria-selected': on })}
                        onPress={() => {
                            if (!on) onChange(item.value);
                        }}
                        className={`flex-row items-center justify-center gap-2 ${
                            large
                                ? 'h-[38px] rounded-[10px] px-4'
                                : radio
                                  ? 'min-h-9 rounded-[9px] px-2 py-1'
                                  : 'h-7 rounded-[9px] px-[11px]'
                        } ${block ? 'flex-1' : ''} ${on ? 'bg-surface-raised shadow-elevation-1' : 'bg-transparent'}`}
                    >
                        <RNText
                            numberOfLines={radio ? 2 : 1}
                            className={`text-center ${large ? 'text-sm font-semibold' : radio ? 'text-[13px] font-semibold leading-4' : 'text-role-strong'} ${
                                on
                                    ? 'text-content-primary'
                                    : 'text-content-secondary hover:text-content-primary'
                            }`}
                        >
                            {item.label}
                        </RNText>
                        {item.count === undefined ? null : (
                            <View
                                aria-hidden
                                className="h-5 min-w-[22px] items-center justify-center rounded-full bg-surface-brand-subtle px-[7px]"
                            >
                                <RNText
                                    testID={
                                        item.testID === undefined
                                            ? undefined
                                            : `${item.testID}-count`
                                    }
                                    className="text-role-caption font-bold tabular-nums text-content-on-brand-subtle"
                                >
                                    {String(item.count)}
                                </RNText>
                            </View>
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}
