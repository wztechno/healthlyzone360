import { cx, useIsCoarsePointer } from '@healthy360/design-system';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

/**
 * The storefront's tab row — HealthZone `§isStorefront` `storeTabs`: bare labels 28px apart on a
 * hairline, the open one in the primary ink over a 2px brand underline, the rest secondary.
 *
 * Not the design system's `Tabs`: its underline variant spaces tabs 4px apart with their own
 * padding and underlines in the focus ink, which is the admin's tab row. This is the customer
 * page's, and it scrolls sideways rather than wrapping when five labels do not fit a phone — the
 * design's `overflow-x: auto`.
 */
export interface StorefrontTabItem<T extends string> {
    readonly value: T;
    readonly label: string;
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
    const coarse = useIsCoarsePointer();

    return (
        <View className="relative">
            {/* The row's hairline, under the tabs so the open tab's underline covers it. */}
            <View className="absolute bottom-0 end-0 start-0 h-px bg-stroke" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View
                    testID={testID}
                    role="tablist"
                    accessibilityRole="tablist"
                    aria-label={label}
                    className="flex-row gap-7"
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
                                    'shrink-0 justify-center border-b-2 py-3',
                                    coarse ? 'min-h-touch' : null,
                                    selected ? 'border-surface-brand' : 'border-transparent',
                                )}
                            >
                                <RNText
                                    numberOfLines={1}
                                    className={cx(
                                        'text-sm font-semibold text-start',
                                        selected
                                            ? 'text-content-primary'
                                            : 'text-content-secondary hover:text-content-primary',
                                    )}
                                >
                                    {item.label}
                                </RNText>
                            </Pressable>
                        );
                    })}
                </View>
            </ScrollView>
        </View>
    );
}
