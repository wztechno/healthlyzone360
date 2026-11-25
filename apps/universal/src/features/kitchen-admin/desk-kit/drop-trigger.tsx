import { Icon } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * Tall enough for the four slots and a kitchen's longer lists without leaving a laptop screen. A
 * longer list scrolls inside the menu. The table headers' filter menus share it.
 */
export const MENU_MAX_HEIGHT = 360;

/**
 * The toolbar's dropdown pill for a control that opens something other than a list of values —
 * the mini month's day button, Show columns and the kitchen pause. A list of values is `Select`
 * (`trigger="pill"`). Shared with the mini month's day button, which opens a calendar instead of a
 * list. `value` alone (no `label`) is the day button's "Today · Tue 10 Nov".
 */
export function DropTrigger({
    triggerProps,
    onPress,
    open,
    filled,
    icon,
    label,
    value,
    accessibilityLabel,
    testID,
}: {
    readonly triggerProps: object;
    readonly onPress: () => void;
    readonly open: boolean;
    readonly filled: boolean;
    readonly icon?: ReactNode;
    readonly label?: string | undefined;
    readonly value: string;
    readonly accessibilityLabel: string;
    readonly testID: string;
}) {
    const ink = filled || open ? 'text-content-on-brand-subtle' : 'text-content-primary';
    return (
        <Pressable
            {...triggerProps}
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            className={`h-desk-toolbar flex-row items-center gap-1.5 rounded-full border pe-2.5 ps-3 web:transition-colors ${
                filled || open
                    ? 'border-stroke bg-surface-brand-subtle'
                    : 'border-stroke-subtle bg-surface-raised hover:border-stroke hover:bg-surface-brand-subtle'
            }`}
        >
            {icon === undefined ? null : <View className={ink}>{icon}</View>}
            {label === undefined ? null : (
                <RNText numberOfLines={1} className={`text-role-strong ${ink}`}>
                    {label}
                </RNText>
            )}
            <RNText numberOfLines={1} className={`text-role-strong font-bold ${ink}`}>
                {value}
            </RNText>
            <View className={`web:transition-transform ${open ? 'rotate-180' : ''}`}>
                <Icon name="chevronDown" size="md" className="text-content-secondary" />
            </View>
        </Pressable>
    );
}
