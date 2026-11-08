import {
    CommandPalette,
    Icon,
    commandShortcutLabel,
    cx,
    useBreakpoint,
    useCommandShortcut,
} from '@healthy360/design-system';
import type { CommandPaletteItem, NavigationItem } from '@healthy360/design-system';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText } from 'react-native';

import { ENTITY_FAMILIES } from './entity-registry.ts';

/**
 * The kitchen area's page search — the box in the top bar, Ctrl K anywhere, and the palette both
 * open.
 *
 * It searches exactly what the sidebar lists: the items are `useKitchenNavigation()`'s own, so a
 * page is offered here precisely when the reader's permissions put it in the rail, under the same
 * module heading and with the same Lucide mark. Nothing is maintained twice, and a module added to
 * the entity registry is searchable the day it appears in the sidebar. A family's `keywordsKey`
 * adds the words it answers to beyond its name, so "sauces" still finds the recipe book.
 *
 * The box is a button that looks like a field, not a field: typing happens in the palette, which
 * has the room to show the results. In the admin frame's bar it is a wide sunken pill after the
 * trail, up to 420px, with the shortcut in a chip at its end; below `md` it narrows to a round
 * glyph, because the bar there is holding the trail as well.
 */
export function KitchenPageSearch({
    navigation,
}: {
    readonly navigation: readonly NavigationItem[];
}) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const [open, setOpen] = useState(false);

    useCommandShortcut(() => {
        setOpen(true);
    });

    const items = useMemo<readonly CommandPaletteItem[]>(
        () =>
            navigation.map((item) => {
                const keywordsKey = ENTITY_FAMILIES.find(
                    (family) => family.key === item.key,
                )?.keywordsKey;
                return {
                    key: item.key,
                    label: item.label,
                    icon: item.icon ?? 'dot',
                    group: item.group,
                    ...(keywordsKey === undefined ? {} : { keywords: [t(keywordsKey)] }),
                    onSelect: item.onPress,
                    testID: `kitchen-page-search-item-${item.key}`,
                };
            }),
        [navigation, t],
    );

    const label = t('kitchen:search.label');
    const wide = atLeast('md');

    return (
        <>
            <Pressable
                testID="kitchen-page-search-trigger"
                role="button"
                accessibilityRole="button"
                accessibilityLabel={label}
                aria-label={label}
                aria-haspopup="dialog"
                aria-keyshortcuts="Control+K Meta+K"
                onPress={() => {
                    setOpen(true);
                }}
                className={cx(
                    'flex-row items-center rounded-full bg-surface-sunken transition-colors duration-fast ease-standard web:cursor-text',
                    wide
                        ? 'h-11 min-w-0 max-w-[420px] flex-1 gap-2.5 border border-transparent pe-2 ps-4 hover:border-stroke-default'
                        : 'h-10 w-10 justify-center',
                )}
            >
                <Icon name="searchLens" className="text-content-secondary" />
                {wide ? (
                    <>
                        <RNText
                            numberOfLines={1}
                            className="min-w-0 flex-1 text-sm font-medium text-content-secondary text-start"
                        >
                            {t('kitchen:search.trigger')}
                        </RNText>
                        <RNText
                            testID="kitchen-page-search-shortcut"
                            className="rounded-lg border border-stroke-subtle bg-surface-raised px-2 py-1 text-xs font-semibold text-content-secondary"
                        >
                            {commandShortcutLabel()}
                        </RNText>
                    </>
                ) : null}
            </Pressable>

            <CommandPalette
                testID="kitchen-page-search"
                open={open}
                onClose={() => {
                    setOpen(false);
                }}
                items={items}
                label={label}
                placeholder={t('kitchen:search.placeholder')}
                emptyText={(query) => t('kitchen:search.empty', { query })}
                ungroupedLabel={t('kitchen:search.general')}
                hints={{
                    move: t('kitchen:search.hintMove'),
                    open: t('kitchen:search.hintOpen'),
                    close: t('kitchen:search.hintClose'),
                }}
            />
        </>
    );
}
