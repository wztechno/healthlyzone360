import { Icon, Menu, useBreakpoint } from '@healthy360/design-system';
import type { BreadcrumbItem, MenuItem } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { BackPill } from '../../../ui/back-pill.tsx';

/**
 * The kitchen's breadcrumb, from the Toasts / pop-ups / banners canvas's Breadcrumb boards
 * (2026-11-11):
 *
 * ```
 *  (⌂) / Buying ⌄ / Suppliers / ( E2E Grain Supplier )      a record, opened from its own list
 *  (⌂) / ┆↩ Stock gaps┆ / ( Basmati rice )                  opened from another page
 *  ‹ Stock gaps                                            phone: one pill, the step back
 * ```
 *
 * - **Home** is a round icon, the kitchen workspace.
 * - **The module** ("Buying ⌄") is the rail's group. Its menu lists the module's pages with the
 *   rail's counts, so a reader can move sideways with the rail folded away.
 * - **A page** is a plain link.
 * - **The return** — dashed, with the arrow — is the page the reader came from when that is not the
 *   route's own list. It *is* the back button: the trail is the only way back on a desk page.
 * - **Where you are** is the soft green pill, cut at 260px with the whole name as its label.
 *
 * Slashes, not chevrons. Below `md` there is no room for a trail, so it becomes one back pill naming
 * the step back — the return when there is one, else the crumb above the current one.
 */
export interface DeskCrumb extends BreadcrumbItem {
    readonly kind: 'home' | 'module' | 'page' | 'return' | 'current';
    /** The module's pages, for its menu — the current one `selected`. Module crumbs only. */
    readonly pages?: readonly MenuItem[] | undefined;
}

const PILL = 'h-8 flex-row items-center rounded-full';

export function DeskTrail({
    crumbs,
    testID,
}: {
    readonly crumbs: readonly DeskCrumb[];
    readonly testID: string;
}) {
    const { t, i18n } = useTranslation();
    const phone = useBreakpoint().isBelow('md');
    const slash = i18n.dir() === 'rtl' ? '\\' : '/';

    if (phone) {
        const back =
            crumbs.find((crumb) => crumb.kind === 'return') ??
            [...crumbs].reverse().find((crumb) => crumb.kind !== 'current' && crumb.onPress);
        if (back?.onPress === undefined) return null;
        return (
            <View testID={testID} className="min-w-0 shrink flex-row items-center">
                <BackPill testID={`${testID}-back`} label={back.label} onPress={back.onPress} />
            </View>
        );
    }

    return (
        <View
            testID={testID}
            role="navigation"
            aria-label={t('designSystem:breadcrumbs.label')}
            accessibilityLabel={t('designSystem:breadcrumbs.label')}
            className="min-w-0 shrink flex-row flex-nowrap items-center gap-0.5 overflow-hidden"
        >
            {crumbs.map((crumb, index) => (
                <View
                    key={crumb.key}
                    className={`flex-row items-center gap-0.5 ${
                        crumb.kind === 'current' ? 'min-w-16 shrink' : 'min-w-0 shrink-0'
                    }`}
                >
                    {index === 0 ? null : (
                        <RNText aria-hidden className="px-1 text-sm text-content-disabled">
                            {slash}
                        </RNText>
                    )}
                    <Crumb crumb={crumb} />
                </View>
            ))}
        </View>
    );
}

function Crumb({ crumb }: { readonly crumb: DeskCrumb }) {
    if (crumb.kind === 'home') {
        return (
            <Pressable
                testID={crumb.testID}
                role="link"
                accessibilityRole="link"
                accessibilityLabel={crumb.label}
                aria-label={crumb.label}
                onPress={crumb.onPress}
                className="h-8 w-8 items-center justify-center rounded-full bg-surface-sunken hover:bg-surface-brand-subtle web:transition-colors"
            >
                <Icon name="house" size="sm" className="text-content-primary" />
            </Pressable>
        );
    }

    if (crumb.kind === 'module') {
        return <ModuleCrumb crumb={crumb} />;
    }

    if (crumb.kind === 'return') {
        return (
            <Pressable
                testID={crumb.testID}
                role="link"
                accessibilityRole="link"
                accessibilityLabel={crumb.label}
                onPress={crumb.onPress}
                className={`${PILL} gap-1.5 border border-dashed border-success-border pe-3 ps-2 hover:bg-surface-brand-subtle web:transition-colors`}
            >
                <Icon name="cornerDownLeft" size="sm" className="text-content-on-brand-subtle" />
                <RNText
                    numberOfLines={1}
                    className="text-sm font-semibold text-content-on-brand-subtle"
                >
                    {crumb.label}
                </RNText>
            </Pressable>
        );
    }

    if (crumb.kind === 'current' || crumb.onPress === undefined) {
        return (
            <RNText
                testID={crumb.testID}
                aria-current="page"
                numberOfLines={1}
                accessibilityLabel={crumb.label}
                className={`${PILL} max-w-[260px] shrink bg-surface-brand-subtle px-3 text-sm font-bold leading-8 text-content-on-brand-subtle`}
            >
                {crumb.label}
            </RNText>
        );
    }

    return (
        <Pressable
            testID={crumb.testID}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={crumb.label}
            onPress={crumb.onPress}
            className={`${PILL} px-2.5 hover:bg-surface-sunken web:transition-colors`}
        >
            <RNText numberOfLines={1} className="text-sm font-medium text-content-secondary">
                {crumb.label}
            </RNText>
        </Pressable>
    );
}

function ModuleCrumb({ crumb }: { readonly crumb: DeskCrumb }) {
    const { t } = useTranslation();
    const pages = crumb.pages ?? [];
    const menuLabel = t('kitchen:trail.modulePages', { module: crumb.label });

    if (pages.length < 2) {
        return (
            <RNText
                testID={crumb.testID}
                numberOfLines={1}
                className="px-2.5 text-sm font-medium text-content-secondary"
            >
                {crumb.label}
            </RNText>
        );
    }

    return (
        <View className="z-auto">
            <Menu
                label={menuLabel}
                look="card"
                closeOnSelect
                sections={[{ items: pages }]}
                testID={crumb.testID === undefined ? undefined : `${crumb.testID}-menu`}
                trigger={({ triggerProps, toggle, open }) => (
                    <Pressable
                        {...triggerProps}
                        testID={crumb.testID}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={menuLabel}
                        aria-haspopup="menu"
                        aria-expanded={open}
                        onPress={toggle}
                        className={`${PILL} gap-1 border pe-2 ps-2.5 web:transition-colors ${
                            open
                                ? 'border-success-border bg-surface-brand-subtle'
                                : 'border-transparent hover:bg-surface-sunken'
                        }`}
                    >
                        <RNText
                            numberOfLines={1}
                            className={`text-sm ${
                                open
                                    ? 'font-semibold text-content-on-brand-subtle'
                                    : 'font-medium text-content-secondary'
                            }`}
                        >
                            {crumb.label}
                        </RNText>
                        <Icon
                            name="chevronDown"
                            size="sm"
                            className={
                                open ? 'text-content-on-brand-subtle' : 'text-content-secondary'
                            }
                        />
                    </Pressable>
                )}
            />
        </View>
    );
}
