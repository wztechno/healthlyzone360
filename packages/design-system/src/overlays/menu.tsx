import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { KEYS, keyDownProps, webRole } from '../internal/web-props.ts';
import type { WebKeyEvent } from '../internal/web-props.ts';
import { Dropdown } from './dropdown.tsx';
import type { DropdownRenderState } from './dropdown.tsx';
import type { AnchorAlign } from './anchored-surface.ts';

/**
 * Menu — a list of actions in a `Dropdown`.
 *
 * Two shapes, one component. A row's overflow menu is a short list of commands (View · Edit ·
 * Archive); a column header's filter menu is sort commands, then that column's distinct values as
 * toggleable rows with a `check` mark, then `Clear`. They differ only in whether an item reports a
 * `selected` state and whether there is a footer, so they are the same list rather than two.
 *
 * Everything hard — anchoring, dismissal, the `pointerdown` swallow, the edge flip against the
 * narrower of the port and the grid — belongs to `Dropdown` and is not re-implemented here.
 *
 * ## Items carry an icon name, never a glyph
 *
 * `ICON_GLYPHS` is itself glyph-based, so an inline `'✎'` at a call site is a second, unreviewed
 * icon set that no test asserts and that becomes a tofu box on any platform that cannot draw it
 * (§4.5). `icon` is an `IconName` and the lookup stays in one place.
 */

export interface MenuItem {
    readonly key: string;
    readonly label: string;
    readonly icon?: IconName | undefined;
    readonly onSelect: () => void;
    readonly disabled?: boolean | undefined;
    /**
     * Marks a *toggleable* item — a filter value. `undefined` (the default) is a command, which has
     * no selected state at all; `true` / `false` makes it a `menuitemcheckbox` and draws the check.
     * The distinction is not cosmetic: a command that reports `aria-checked="false"` tells a screen
     * reader user the action has been turned off rather than that it is available.
     */
    readonly selected?: boolean | undefined;
    /** `danger` for a destructive command. Paired with its own icon, never colour alone. */
    readonly tone?: 'default' | 'danger' | undefined;
    /**
     * Overrides the derived `{menu}-item-{key}` id.
     *
     * For the case where a row action *moved into* a menu and the id it carried outside one is a
     * contract with a suite: the Catalogue's `⋯` holds the Edit and Archive that used to be two
     * buttons on the row, and those ids are clicked by name in three specs. Stating the id here
     * lets the control change shape without the assertion changing meaning.
     */
    readonly testID?: string | undefined;
}

export interface MenuSection {
    /** Optional heading. Renders on the `micro` step, which is the uppercase column-label ramp. */
    readonly label?: string | undefined;
    readonly items: readonly MenuItem[];
}

export interface MenuProps {
    readonly trigger: (state: DropdownRenderState) => ReactNode;
    /** Accessible name of the panel — a `⋯` trigger gives it none. */
    readonly label: string;
    readonly sections: readonly MenuSection[];
    /** Shown under a hairline at the foot. The `Clear` link for an active column filter lives here. */
    readonly footer?: ReactNode | undefined;
    readonly align?: AnchorAlign | undefined;
    /**
     * Caps the panel's height and scrolls beyond it. The mock caps a column's value list at 12
     * (§4.3); this is the pixel expression of the same decision, so a 200-value column does not
     * produce a menu taller than the window.
     */
    readonly maxHeight?: number | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

const ITEM_TONE_CLASS = {
    default: 'text-content-primary',
    danger: 'text-danger-strong',
} as const;

function MenuRow({
    item,
    active,
    onHover,
    onClose,
    testID,
}: {
    readonly item: MenuItem;
    readonly active: boolean;
    readonly onHover: () => void;
    readonly onClose: () => void;
    readonly testID: string | undefined;
}) {
    const toggleable = item.selected !== undefined;
    const disabled = item.disabled === true;

    return (
        <Pressable
            testID={testID}
            // `menuitemcheckbox` is outside React Native's `Role` union, so it goes through
            // `webRole`; `accessibilityRole` below carries the native equivalent, which is why a
            // toggleable item reports as a checkbox there.
            {...webRole(toggleable ? 'menuitemcheckbox' : 'menuitem')}
            accessibilityRole={toggleable ? 'checkbox' : 'menuitem'}
            accessibilityLabel={item.label}
            {...(toggleable ? { 'aria-checked': item.selected === true } : {})}
            accessibilityState={{
                disabled,
                ...(toggleable ? { checked: item.selected === true } : {}),
            }}
            aria-disabled={disabled}
            disabled={disabled}
            focusable={!disabled}
            onHoverIn={onHover}
            onPress={() => {
                item.onSelect();
                // A command closes the menu; a filter value does not, because narrowing a column by
                // three values should be three presses rather than three round trips through the
                // trigger. The `selected` prop is what distinguishes them, so the behaviour follows
                // from the item's own shape and no call site has to remember to pass a flag.
                if (!toggleable) onClose();
            }}
            className={cx(
                'h-control-sm flex-row items-center gap-control-sm px-control-sm',
                active ? 'bg-surface-sunken' : 'bg-transparent',
                disabled ? 'opacity-60' : null,
            )}
        >
            {/*
             * The mark column is present on every row of a toggleable section, drawn or not, so the
             * labels line up instead of shifting sideways as values are ticked.
             */}
            {toggleable ? (
                <View className="w-4 items-center">
                    {item.selected === true ? (
                        <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                    ) : null}
                </View>
            ) : item.icon === undefined ? null : (
                <Icon
                    name={item.icon}
                    size="sm"
                    className={
                        item.tone === 'danger' ? 'text-danger-strong' : 'text-content-secondary'
                    }
                />
            )}

            <RNText
                className={cx(
                    'flex-1 text-role-body font-admin text-start',
                    disabled ? 'text-content-disabled' : ITEM_TONE_CLASS[item.tone ?? 'default'],
                )}
            >
                {item.label}
            </RNText>
        </Pressable>
    );
}

export function Menu({
    trigger,
    label,
    sections,
    footer,
    align = 'start',
    maxHeight,
    className,
    testID,
}: MenuProps) {
    const base = testID ?? 'menu';
    const flat = sections.flatMap((section) => section.items);
    const [active, setActive] = useState(-1);

    const move = (step: number) => {
        if (flat.length === 0) return;
        setActive((current) => {
            let next = current;
            // Skips disabled items rather than parking the highlight on one, which is what turns
            // "press down twice" into "press down twice and then wonder why Enter did nothing".
            for (let hop = 0; hop < flat.length; hop += 1) {
                next = (next + step + flat.length) % flat.length;
                if (flat[next]?.disabled !== true) return next;
            }
            return current;
        });
    };

    return (
        <Dropdown
            trigger={trigger}
            label={label}
            align={align}
            role="menu"
            className={className}
            {...(testID === undefined ? {} : { testID })}
            /*
             * No minimum width. A menu is as wide as its widest item and no wider — the check
             * column already keeps toggleable rows aligned, so a floor would only pad a two-word
             * command menu out to the width of a filter list. It would also be an arbitrary number
             * with no token behind it, which is the thing §2 bans.
             */
            // `w-max`: the panel is absolutely positioned, so without it it takes the trigger's
            // width and a two-word item wraps to three lines under a narrow column header.
            panelClassName="w-max max-w-xs py-1"
        >
            {(state: DropdownRenderState) => (
                <View
                    {...keyDownProps((event: WebKeyEvent) => {
                        if (event.key === KEYS.arrowDown) {
                            event.preventDefault();
                            move(1);
                            return;
                        }
                        if (event.key === KEYS.arrowUp) {
                            event.preventDefault();
                            move(-1);
                            return;
                        }
                        if (event.key === KEYS.enter || event.key === KEYS.space) {
                            const item = flat[active];
                            if (item === undefined || item.disabled === true) return;
                            event.preventDefault();
                            item.onSelect();
                            if (item.selected === undefined) state.close();
                        }
                    })}
                    style={maxHeight === undefined ? undefined : { maxHeight }}
                    className="flex-col"
                >
                    {sections.map((section, sectionIndex) => (
                        <View key={section.label ?? `section-${String(sectionIndex)}`}>
                            {sectionIndex > 0 ? (
                                <View className="my-1 border-b border-stroke-subtle" />
                            ) : null}
                            {section.label === undefined ? null : (
                                <RNText className="px-control-sm py-1 text-role-micro font-admin uppercase text-content-secondary text-start">
                                    {section.label}
                                </RNText>
                            )}
                            {section.items.map((item) => {
                                const index = flat.indexOf(item);
                                return (
                                    <MenuRow
                                        key={item.key}
                                        item={item}
                                        active={index === active}
                                        onHover={() => {
                                            setActive(index);
                                        }}
                                        onClose={state.close}
                                        testID={item.testID ?? `${base}-item-${item.key}`}
                                    />
                                );
                            })}
                        </View>
                    ))}

                    {footer === undefined ? null : (
                        <View className="mt-1 border-t border-stroke-subtle px-control-sm pt-1">
                            {footer}
                        </View>
                    )}
                </View>
            )}
        </Dropdown>
    );
}
