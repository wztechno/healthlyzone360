import { Icon, IconButton, ListItem, Menu, Text } from '@healthy360/design-system';
import type { IconName, MenuItem } from '@healthy360/design-system';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The Catalogue row below `md` — handoff §4.1.
 *
 * Above `md` a record is a set of tracks and `CatalogueList` draws it through `DataList`. Below it
 * there is no room for tracks, so the same record renders two-line: title with its status badge,
 * then the meta run, the metric and the overflow. It is not a narrower grid — it is a different
 * shape, which is why the break is a JavaScript branch in `CatalogueList` rather than a class
 * variant. Rendering both trees and hiding one would put every row in the accessibility tree twice.
 *
 * The composition sits over `ListItem`, which already owns the two-line geometry, the density
 * ladder and the direction-aware chevron. What this file adds is the Catalogue's specific
 * furniture: the status badge beside the title, and the row's one control.
 *
 * ## One control, and it is a menu
 *
 * A narrow row has space for exactly one affordance, and §4.1 says which: the `⋯` overflow with
 * **View · Edit · Archive**. The row body keeps its current behaviour and opens the editor; View is
 * explicit and comes from the menu. Three separate icon buttons at this width would be three 28px
 * targets in the space of one and would push the metric off the row.
 *
 * ## The three icons
 *
 * §4.5 gives each item a leading icon — `eye` · `pen` · `archive` — and §10.0 recorded that the
 * last two were missing from `ICON_GLYPHS`. They are there now (`✎` and `▥`; the handoff's `▤` was
 * already `calendar`, and its next candidate `▣` was already `basket`), so {@link CATALOGUE_ROW_ICONS}
 * names them once and a spec supplies the labels and the handlers.
 */
/**
 * The row menu's three icons, in §4.1's order.
 *
 * Exported as a map so a spec builds its `MenuItem`s from names rather than repeating three string
 * literals per entity — the same reasoning that keeps the priority ladder in the column spec file.
 * The action *labels* stay with the caller: they are translated, and this file holds no copy.
 */
export const CATALOGUE_ROW_ICONS = {
    view: 'eye',
    edit: 'pen',
    archive: 'archive',
} as const satisfies Readonly<Record<string, IconName>>;

export interface CatalogueListItemProps {
    readonly title: string;
    /** Rendered beside the title. A `StatusBadge`, from the spec's `badge` column. */
    readonly status?: ReactNode | undefined;
    /**
     * The secondary values — category, unit, reference — as elements rather than one joined string,
     * so a right-to-left catalogue can reposition the separators. Same argument as the summary bar.
     */
    readonly meta?: readonly ReactNode[] | undefined;
    /** The entity's headline number. Mono, and the last thing dropped as the row narrows. */
    readonly metric?: ReactNode | undefined;
    /** View · Edit · Archive. Empty or omitted draws no overflow control. */
    readonly actions?: readonly MenuItem[] | undefined;
    /** Accessible name for the overflow trigger — "Row actions". */
    readonly actionsLabel: string;
    /** Opens the editor, matching the wide row's body press. */
    readonly onPress?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

export function CatalogueListItem({
    title,
    status,
    meta,
    metric,
    actions,
    actionsLabel,
    onPress,
    testID,
}: CatalogueListItemProps) {
    const overflow =
        actions === undefined || actions.length === 0 ? null : (
            <Menu
                label={actionsLabel}
                align="end"
                sections={[{ items: actions }]}
                trigger={({ triggerProps, toggle }) => (
                    <IconButton
                        {...triggerProps}
                        label={actionsLabel}
                        variant="ghost"
                        size="sm"
                        icon={<Icon name="more" size="sm" />}
                        onPress={toggle}
                        testID={testID === undefined ? undefined : `${testID}-actions-trigger`}
                    />
                )}
                testID={testID === undefined ? undefined : `${testID}-actions`}
            />
        );

    return (
        <ListItem
            title={title}
            onPress={onPress}
            testID={testID}
            trailing={
                <View className="flex-row items-center gap-tight">
                    {metric === undefined ? null : metric}
                    {overflow}
                </View>
            }
            leading={status}
            meta={
                meta === undefined || meta.length === 0 ? undefined : (
                    <View className="flex-row flex-wrap items-center gap-hair">
                        {meta.map((entry, index) => (
                            // Index keys: these are positional slots in one row's meta run, not a
                            // reorderable list, and the entries are frequently plain strings that
                            // repeat across rows.
                            <Fragment key={index}>
                                {index === 0 ? null : (
                                    <Text variant="caption" tone="disabled" aria-hidden>
                                        ·
                                    </Text>
                                )}
                                <Text variant="caption" tone="secondary">
                                    {entry}
                                </Text>
                            </Fragment>
                        ))}
                    </View>
                )
            }
        />
    );
}
