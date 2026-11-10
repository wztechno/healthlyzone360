import { Icon, Menu } from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { Platform, Pressable, View } from 'react-native';

/**
 * `.dots.more` + `.vmenu.rmenu` — a table row's `⋯` and the card it opens (Orders canvas,
 * 2026-11-10; built for Requirements 2026-11-11, for every desk list after it).
 *
 * ```
 *                                         ( ⋯ )   <- 28px, rounded 8px, quiet until the row is hovered
 *                          ┌─────────────────────┐
 *                          │ 👁 View ingredient   │   the desk's dropdown card, rising in;
 *                          │ ✎ Edit ingredient    │   the first item can be `primary` (brand ink)
 *                          └─────────────────────┘
 * ```
 *
 * The props are `RowActionsMenu`'s, so a list moves over by asking for `look="desk"` there. A click
 * on the trigger never reaches the row behind it, which would open the record instead.
 */
export function DeskRowMenu({
    actions,
    label,
    testID,
}: {
    readonly actions: readonly MenuItem[];
    /** Translated — the `⋯`'s accessible name. */
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
                    <Pressable
                        {...triggerProps}
                        testID={`${testID}-trigger`}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        onPress={toggle}
                        className={`h-7 w-7 items-center justify-center rounded-lg web:transition-colors ${
                            open
                                ? 'bg-surface-brand-subtle'
                                : 'bg-transparent hover:bg-surface-sunken'
                        }`}
                    >
                        <Icon
                            name="more"
                            size="md"
                            className={
                                open ? 'text-content-on-brand-subtle' : 'text-content-secondary'
                            }
                        />
                    </Pressable>
                )}
                testID={testID}
            />
        </View>
    );
}
