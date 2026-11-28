import { Platform, View } from 'react-native';

import { IconButton } from '../actions/icon-button.tsx';
import { Icon } from '../icons/icon.tsx';
import { Menu } from '../overlays/menu.tsx';
import type { MenuItem } from '../overlays/menu.tsx';

/** The action track: the word "Actions" over one `⋯`. */
export const ROW_ACTIONS_WIDTH = 72;

/**
 * A table row's `⋯` and the card it opens — the admin's one row menu (Orders canvas `.dots.more` +
 * `.vmenu.rmenu`; the only one since 2026-11-26).
 *
 * ```
 *                                         ( ⋯ )   <- quiet until hovered; soft green while open
 *                          ┌─────────────────────┐
 *                          │ 👁 View ingredient   │   the admin's card menu; picking an item
 *                          │ ✎ Edit ingredient    │   closes it
 *                          └─────────────────────┘
 * ```
 *
 * `DataTable` draws it for `rowActions`; a row drawn by hand uses it directly.
 *
 * ## It swallows its own click on the web
 *
 * The row is itself a `Pressable`. On the web a nested `<button>`'s click bubbles, so pressing an
 * item would run it *and* open the row. React Native's responder system hands the touch to the
 * innermost target and never bubbles, so the stop is web only, spread rather than declared because
 * `onClick` is a DOM prop React Native does not type.
 *
 * ## The open menu stays above the rows after it
 *
 * Every row is a stacking context, and a later one paints over an earlier one's panel. `global.css`
 * raises the row whose trigger is `aria-expanded`, so nothing here has to track which row is open.
 */
export function RowMenu({
    actions,
    label,
    testID,
}: {
    readonly actions: readonly MenuItem[];
    /** Translated — the `⋯`'s accessible name, also shown on hover. */
    readonly label: string;
    readonly testID: string;
}) {
    if (actions.length === 0) return null;
    return (
        <View
            className="z-auto flex-row items-center"
            {...(Platform.OS === 'web'
                ? {
                      onClick: (event: { stopPropagation: () => void }) => {
                          event.stopPropagation();
                      },
                  }
                : {})}
        >
            <Menu
                label={label}
                align="end"
                look="card"
                closeOnSelect
                sections={[{ items: actions }]}
                trigger={({ triggerProps, toggle, open }) => (
                    <IconButton
                        {...triggerProps}
                        label={label}
                        variant="ghost"
                        size="sm"
                        pressed={open}
                        icon={
                            <Icon
                                name="more"
                                size="md"
                                className={
                                    open ? 'text-content-on-brand-subtle' : 'text-content-secondary'
                                }
                            />
                        }
                        onPress={toggle}
                        testID={`${testID}-trigger`}
                    />
                )}
                testID={testID}
            />
        </View>
    );
}
