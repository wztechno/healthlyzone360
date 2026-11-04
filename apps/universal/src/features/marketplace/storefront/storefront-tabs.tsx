import { cx } from '@healthy360/design-system';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

/**
 * The storefront's tab row, as the accepted shop board draws it: one white bar with a soft shadow,
 * each tab a 48px rounded button, the open one in ink, and a small count beside a tab that has one
 * (the menu's dishes) — brand-filled on the open tab.
 *
 * Not the design system's `Tabs`, which is the admin's underline row. This is the customer page's,
 * and it scrolls sideways rather than wrapping when five labels do not fit a phone.
 */
export interface StorefrontTabItem<T extends string> {
    readonly value: T;
    readonly label: string;
    /** A count beside the label — the menu's dishes. */
    readonly count?: string | undefined;
    readonly testID?: string | undefined;
}

export interface StorefrontTabsProps<T extends string> {
    readonly label: string;
    readonly value: T;
    readonly items: readonly StorefrontTabItem<T>[];
    readonly onChange: (value: T) => void;
    readonly testID?: string | undefined;
}

export function StorefrontTabs<T extends string>({
    label,
    value,
    items,
    onChange,
    testID,
}: StorefrontTabsProps<T>) {
    return (
        <View className="rounded-[20px] border border-stroke-subtle bg-surface-raised p-1.5 shadow-elevation-2">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View
                    testID={testID}
                    role="tablist"
                    accessibilityRole="tablist"
                    aria-label={label}
                    className="flex-row gap-1.5"
                >
                    {items.map((item) => {
                        const selected = item.value === value;
                        return (
                            <Pressable
                                key={item.value}
                                testID={item.testID}
                                role="tab"
                                accessibilityRole="tab"
                                accessibilityState={{ selected }}
                                aria-selected={selected}
                                onPress={() => {
                                    onChange(item.value);
                                }}
                                className={cx(
                                    'h-12 shrink-0 flex-row items-center gap-2 rounded-[14px] px-[18px] transition duration-normal ease-standard',
                                    selected ? 'bg-content-primary' : 'hover:bg-surface-base',
                                )}
                            >
                                <RNText
                                    numberOfLines={1}
                                    className={cx(
                                        'text-sm font-semibold text-start',
                                        selected
                                            ? 'text-surface-base'
                                            : 'text-content-secondary hover:text-content-primary',
                                    )}
                                >
                                    {item.label}
                                </RNText>
                                {item.count === undefined ? null : (
                                    <View
                                        className={cx(
                                            'h-5 min-w-[22px] items-center justify-center rounded-full px-1.5',
                                            selected ? 'bg-surface-brand' : 'bg-surface-base',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'text-xs font-bold tabular-nums',
                                                selected
                                                    ? 'text-content-on-brand'
                                                    : 'text-content-primary',
                                            )}
                                        >
                                            {item.count}
                                        </RNText>
                                    </View>
                                )}
                            </Pressable>
                        );
                    })}
                </View>
            </ScrollView>
        </View>
    );
}
