import {
    CommandPalette,
    Icon,
    commandShortcutLabel,
    useBreakpoint,
    useCommandShortcut,
} from '@healthy360/design-system';
import type { CommandPaletteItem, NavigationItem } from '@healthy360/design-system';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText } from 'react-native';

/**
 * The kitchen area's page search — the box in the top bar, Ctrl K anywhere, and the palette both
 * open.
 *
 * It searches exactly what the sidebar lists: the items are `useKitchenNavigation()`'s own, so a
 * page is offered here precisely when the reader's permissions put it in the rail, under the same
 * module heading and with the same Lucide mark. Nothing is maintained twice, and a module added to
 * the entity registry is searchable the day it appears in the sidebar.
 *
 * The box is a button that looks like a field, not a field: typing happens in the palette, which
 * has the room to show the results. Below `md` it narrows to its glyph, because the top bar there
 * is holding the breadcrumb trail as well.
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
            navigation.map((item) => ({
                key: item.key,
                label: item.label,
                icon: item.icon ?? 'dot',
                group: item.group,
                onSelect: item.onPress,
                testID: `kitchen-page-search-item-${item.key}`,
            })),
        [navigation],
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
                className="h-8 flex-row items-center gap-2 rounded-lg border border-stroke-subtle bg-surface-sunken px-2.5 web:cursor-text"
            >
                <Icon name="searchLens" size="sm" className="text-content-secondary" />
                {wide ? (
                    <>
                        <RNText
                            numberOfLines={1}
                            className="w-[152px] text-sm text-content-secondary text-start"
                        >
                            {t('kitchen:search.trigger')}
                        </RNText>
                        <RNText
                            testID="kitchen-page-search-shortcut"
                            className="rounded border border-stroke-subtle bg-surface-raised px-1.5 py-0.5 text-xs text-content-secondary"
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
