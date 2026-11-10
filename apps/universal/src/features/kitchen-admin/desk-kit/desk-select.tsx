import { Icon, Menu } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * `.drop` + `.cpop` — the desk's dropdown (Orders canvas, 2026-11-10).
 *
 * ```
 * ( Slot  All ⌄ )        ( Delivery or pickup  Pickup ⌄ )   <- a value other than the first: soft green
 *  ┌──────────────────┐
 *  │ ✓ All            │   260px card, 36px rows, the chosen one bold;
 *  │   Breakfast      │   it closes on a pick and rises in as it opens
 *  │   Lunch          │
 *  └──────────────────┘
 * ```
 *
 * The trigger is a 34px pill on the toolbar's height: the label in ink, the value in bold, a chevron
 * that turns over while the menu is open. A scope set to anything but its first option ("All")
 * fills soft green, so a narrowed list is visible from the bar alone.
 *
 * The props are `LensScope`'s, so a page moves to it by changing the import.
 */

export interface DeskSelectOption<T extends string> {
    readonly value: T;
    readonly label: string;
    /** Shown beside the label in the menu. */
    readonly count?: number | undefined;
    readonly icon?: IconName | undefined;
    readonly testID?: string | undefined;
}

export function DeskSelect<T extends string>({
    label,
    value,
    options,
    onChange,
    icon,
    testID,
}: {
    /** Translated — "Slot". */
    readonly label: string;
    readonly value: T;
    readonly options: readonly DeskSelectOption<T>[];
    readonly onChange: (value: T) => void;
    /** A glyph before the label. */
    readonly icon?: ReactNode;
    readonly testID: string;
}) {
    const current = options.find((option) => option.value === value);
    const narrowed = options[0] !== undefined && value !== options[0].value;

    return (
        <Menu
            testID={testID}
            label={label}
            look="card"
            closeOnSelect
            maxHeight={MENU_MAX_HEIGHT}
            sections={[
                {
                    items: options.map((option) => ({
                        key: option.value,
                        label:
                            option.count === undefined
                                ? option.label
                                : `${option.label} · ${String(option.count)}`,
                        icon: option.icon,
                        selected: option.value === value,
                        testID: option.testID,
                        onSelect: () => {
                            onChange(option.value);
                        },
                    })),
                },
            ]}
            trigger={({ triggerProps, toggle, open }) => (
                <DropTrigger
                    triggerProps={triggerProps}
                    onPress={toggle}
                    open={open}
                    filled={narrowed}
                    icon={icon}
                    label={label}
                    value={current?.label ?? ''}
                    accessibilityLabel={`${label}: ${current?.label ?? ''}`}
                    testID={`${testID}-trigger`}
                />
            )}
        />
    );
}

/** Tall enough for the four slots and a kitchen's longer lists without leaving a laptop screen. */
const MENU_MAX_HEIGHT = 360;

/**
 * The pill itself — shared with the mini month's day button, which opens a calendar instead of a
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
