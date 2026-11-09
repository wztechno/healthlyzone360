import { Icon, IconButton, Menu } from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { Platform, View } from 'react-native';

/** The action track: the word "Actions" over one `⋯`. */
export const ROW_ACTIONS_WIDTH = 72;

/**
 * A table row's `⋯` and its menu. Every table that has row actions draws this one.
 *
 * ## It must swallow its own click on the web
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
export function RowActionsMenu({
    actions,
    label,
    testID,
}: {
    readonly actions: readonly MenuItem[];
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
                sections={[{ items: actions }]}
                trigger={({ triggerProps, toggle }) => (
                    <IconButton
                        {...triggerProps}
                        label={label}
                        variant="ghost"
                        size="sm"
                        icon={<Icon name="more" size="sm" className="text-content-secondary" />}
                        onPress={toggle}
                        testID={`${testID}-trigger`}
                    />
                )}
                testID={testID}
            />
        </View>
    );
}
