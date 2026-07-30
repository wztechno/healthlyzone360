import { useIsRtl } from '@healthy360/i18n';
import { Text as RNText, View } from 'react-native';
import { Pressable } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { KEYS, keyDownProps } from '../internal/web-props.ts';
import type { WebKeyEvent } from '../internal/web-props.ts';

export const TABS_VARIANTS = ['underline', 'segmented'] as const;
export type TabsVariant = (typeof TABS_VARIANTS)[number];

export interface TabItem<T extends string = string> {
    readonly value: T;
    readonly label: string;
    readonly icon?: IconName | undefined;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}

export interface TabsProps<T extends string = string> {
    /** Accessible name for the tab list. A tablist without one is an unnamed landmark to axe. */
    readonly label: string;
    readonly items: readonly TabItem<T>[];
    readonly value: T;
    readonly onChange: (value: T) => void;
    readonly variant?: TabsVariant | undefined;
    /** Stretch the tabs to fill the row — the usual choice for a two- or three-way segmented set. */
    readonly block?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const LIST_VARIANT: Readonly<Record<TabsVariant, string>> = {
    underline: 'flex-row flex-wrap items-end gap-1 border-b border-stroke-subtle',
    segmented: 'flex-row flex-wrap items-stretch gap-1 rounded-lg bg-surface-sunken p-1',
};

const TAB_VARIANT: Readonly<Record<TabsVariant, string>> = {
    underline: 'min-h-touch flex-row items-center justify-center gap-2 border-b-2 px-3 py-2',
    segmented: 'min-h-touch flex-row items-center justify-center gap-2 rounded-md px-3 py-2',
};

const TAB_SELECTED: Readonly<Record<TabsVariant, string>> = {
    underline: 'border-stroke-focus',
    segmented: 'bg-surface-base shadow-elevation-1',
};

const TAB_UNSELECTED: Readonly<Record<TabsVariant, string>> = {
    underline: 'border-transparent',
    segmented: 'bg-transparent',
};

/**
 * Tabs and segmented control — one component, because they are one behaviour.
 *
 * Two accessibility decisions carry the weight here.
 *
 * **Roving tab stop.** Only the selected tab is focusable, so a tab list of eleven diets costs a
 * keyboard user one Tab press rather than eleven. Movement inside the list is by arrow key, which
 * is what `role="tablist"` promises a screen reader user it will do.
 *
 * **Direction-aware arrows.** The browser does not remap arrow keys for a right-to-left document,
 * so the component does: in Arabic, ArrowLeft moves to the *next* tab, because the next tab is on
 * the left. The visual order needs no work at all — the tabs are a `flex-row` in source order, so
 * the row itself mirrors.
 */
export function Tabs<T extends string = string>({
    label,
    items,
    value,
    onChange,
    variant = 'underline',
    block = false,
    className,
    testID,
}: TabsProps<T>) {
    const isRtl = useIsRtl();

    const selectableIndexes = items
        .map((item, index) => (item.disabled === true ? -1 : index))
        .filter((index) => index >= 0);

    const move = (delta: number) => {
        if (selectableIndexes.length === 0) return;
        const currentIndex = items.findIndex((item) => item.value === value);
        const position = selectableIndexes.indexOf(currentIndex);
        const from = position === -1 ? 0 : position;
        const next = (from + delta + selectableIndexes.length) % selectableIndexes.length;
        const target = items[selectableIndexes[next]!];
        if (target !== undefined) onChange(target.value);
    };

    const jump = (position: 'first' | 'last') => {
        const index = position === 'first' ? selectableIndexes[0] : selectableIndexes.at(-1);
        if (index === undefined) return;
        const target = items[index];
        if (target !== undefined) onChange(target.value);
    };

    const onKeyDown = (event: WebKeyEvent) => {
        const forward = isRtl ? KEYS.arrowLeft : KEYS.arrowRight;
        const backward = isRtl ? KEYS.arrowRight : KEYS.arrowLeft;

        if (event.key === forward) {
            event.preventDefault();
            move(1);
        } else if (event.key === backward) {
            event.preventDefault();
            move(-1);
        } else if (event.key === KEYS.home) {
            event.preventDefault();
            jump('first');
        } else if (event.key === KEYS.end) {
            event.preventDefault();
            jump('last');
        }
    };

    return (
        <View
            testID={testID}
            role="tablist"
            accessibilityRole="tablist"
            aria-label={label}
            accessibilityLabel={label}
            aria-orientation="horizontal"
            className={cx(LIST_VARIANT[variant], className)}
        >
            {items.map((item) => {
                const selected = item.value === value;
                const disabled = item.disabled === true;
                return (
                    <Pressable
                        key={item.value}
                        testID={item.testID}
                        role="tab"
                        accessibilityRole="tab"
                        accessibilityLabel={item.label}
                        aria-selected={selected}
                        accessibilityState={{ selected, disabled }}
                        aria-disabled={disabled}
                        disabled={disabled}
                        // Roving tab stop: the list is one stop, arrows move within it.
                        focusable={selected && !disabled}
                        {...keyDownProps(onKeyDown)}
                        onPress={() => {
                            onChange(item.value);
                        }}
                        className={cx(
                            TAB_VARIANT[variant],
                            selected ? TAB_SELECTED[variant] : TAB_UNSELECTED[variant],
                            block ? 'flex-1' : null,
                            disabled ? 'opacity-50' : null,
                        )}
                    >
                        {item.icon === undefined ? null : (
                            <Icon
                                name={item.icon}
                                size="sm"
                                className={
                                    selected ? 'text-content-primary' : 'text-content-secondary'
                                }
                            />
                        )}
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'text-sm text-center',
                                selected
                                    ? 'font-semibold text-content-primary'
                                    : 'text-content-secondary',
                            )}
                        >
                            {item.label}
                        </RNText>
                    </Pressable>
                );
            })}
        </View>
    );
}

export type SegmentedControlProps<T extends string = string> = Omit<TabsProps<T>, 'variant'>;

/** The segmented presentation of {@link Tabs}: same semantics, denser chrome. */
export function SegmentedControl<T extends string = string>(props: SegmentedControlProps<T>) {
    return <Tabs {...props} variant="segmented" />;
}
